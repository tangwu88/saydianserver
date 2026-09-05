import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AfterSaleStatus,
  BusinessType,
  CommerceOrderStatus,
  CreditLedgerType,
  MembershipStatus,
  OutboxStatus,
  PaymentChannel,
  PaymentStatus,
  Prisma,
  ReportEntitlementType,
  ReportStatus,
  RefundStatus,
} from "@prisma/client";
import type {
  BillingEntitlementContract,
  BillingOfferContract,
  BusinessType as BusinessTypeContract,
  PaymentChannel as PaymentChannelContract,
  PaymentIntentContract,
} from "@saydian/app-contracts";
import {
  isBusinessType,
  isPaymentChannel,
} from "@saydian/app-contracts";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject } from "../common/crypto";
import { markIntegrationVerified } from "../common/integration-health";
import {
  AppleIapService,
  AppleSignatureVerificationError,
  appleTransactionValidationError,
} from "./apple-iap.service";
import { PaymentProviderService } from "./payment-provider.service";

const businessTypeMap: Record<BusinessTypeContract, BusinessType> = {
  commerce_order: BusinessType.COMMERCE_ORDER,
  health_report: BusinessType.HEALTH_REPORT,
  health_membership: BusinessType.HEALTH_MEMBERSHIP,
};

const paymentChannelMap: Record<PaymentChannelContract, PaymentChannel> = {
  wechat_mini: PaymentChannel.WECHAT_MINI,
  wechat_jsapi: PaymentChannel.WECHAT_JSAPI,
  wechat_h5: PaymentChannel.WECHAT_H5,
  wechat_native: PaymentChannel.WECHAT_NATIVE,
  wechat_app: PaymentChannel.WECHAT_APP,
  alipay_wap: PaymentChannel.ALIPAY_WAP,
  alipay_page: PaymentChannel.ALIPAY_PAGE,
  alipay_app: PaymentChannel.ALIPAY_APP,
  apple_iap: PaymentChannel.APPLE_IAP,
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: PaymentProviderService,
    private readonly apple: AppleIapService,
  ) {}

  async offers(platformInput?: string): Promise<{ items: BillingOfferContract[] }> {
    const platform = normalizedPlatform(platformInput);
    const now = new Date();
    const offers = await this.prisma.healthReportOffer.findMany({
      where: {
        active: true,
        ...(platform ? { platforms: { has: platform } } : {}),
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      },
      orderBy: [{ entitlement: "asc" }, { priceCents: "asc" }],
    });
    return {
      items: offers.map((offer) => ({
        id: offer.id,
        code: offer.code,
        title: offer.title,
        description: offer.description,
        entitlement: offer.entitlement.toLowerCase() as BillingOfferContract["entitlement"],
        priceCents: offer.priceCents,
        currency: offer.currency,
        creditCount: offer.creditCount,
        durationDays: offer.durationDays,
        appleProductId: offer.appleProductId,
        version: offer.version,
      })),
    };
  }

  async entitlements(userId: string): Promise<BillingEntitlementContract> {
    const now = new Date();
    await this.expireMemberships(userId, now);
    const [memberships, standalone] = await Promise.all([
      this.prisma.healthMembership.findMany({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          startsAt: { lte: now },
          expiresAt: { gt: now },
        },
        orderBy: { expiresAt: "asc" },
      }),
      this.prisma.reportCreditLedger.aggregate({
        where: { userId, membershipId: null },
        _sum: { delta: true },
      }),
    ]);
    const membershipCredits = memberships.reduce(
      (total, membership) => total + membership.remainingCredits,
      0,
    );
    const availableReportCredits =
      membershipCredits + Math.max(0, standalone._sum.delta ?? 0);
    const membership = memberships[0];
    return {
      availableReportCredits,
      activeMembership: membership?.expiresAt
        ? {
            id: membership.id,
            expiresAt: membership.expiresAt.toISOString(),
            remainingCredits: membershipCredits,
          }
        : null,
    };
  }

  async createPayment(
    userId: string,
    input: unknown,
    context: { clientIp?: string },
  ): Promise<PaymentIntentContract> {
    const body = safeObject(input);
    const businessTypeInput = String(body.businessType ?? "").trim();
    const channelInput = String(body.channel ?? "").trim();
    const businessId = String(body.businessId ?? "").trim();
    const offerId = String(body.offerId ?? "").trim();
    const platform = normalizedPlatform(body.platform);
    const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    if (!isBusinessType(businessTypeInput)) {
      throw new BadRequestException("支付业务类型不正确");
    }
    if (!isPaymentChannel(channelInput)) {
      throw new BadRequestException("支付方式不正确");
    }
    if (!businessId && businessTypeInput !== "health_membership") {
      throw new BadRequestException("支付对象不正确");
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new BadRequestException("支付请求编号不正确");
    }
    const existing = await this.prisma.paymentIntent.findUnique({
      where: { idempotencyKey },
      include: { user: { select: { wechatOpenId: true } } },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictException("支付请求编号已被使用");
      }
      return serializePayment(existing);
    }

    const businessType = businessTypeMap[businessTypeInput];
    const channel = paymentChannelMap[channelInput];
    enforceDigitalPlatformPolicy(businessType, channel, platform);
    const resolved = await this.resolveBusiness(
      userId,
      businessType,
      businessId,
      offerId,
      platform,
    );
    const intent = await this.prisma.paymentIntent.create({
      data: {
        paymentNo: paymentNumber(),
        userId,
        businessType,
        businessId: resolved.businessId,
        commerceOrderId: resolved.commerceOrderId,
        healthReportId: resolved.healthReportId,
        healthMembershipId: resolved.healthMembershipId,
        channel,
        amountCents: resolved.amountCents,
        currency: resolved.currency,
        description: resolved.description,
        idempotencyKey,
      },
      include: { user: { select: { wechatOpenId: true } } },
    });
    try {
      const invoke = await this.providers.create(intent, {
        wechatOpenId: intent.user.wechatOpenId,
        ...(context.clientIp ? { clientIp: context.clientIp } : {}),
        appleProductId: resolved.appleProductId,
      });
      const updated = await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentStatus.PENDING,
          providerPayload: invoke as Prisma.InputJsonValue,
        },
      });
      return { ...serializePayment(updated), invoke };
    } catch (error) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentStatus.FAILED,
          providerPayload: {
            errorCode: "provider_unavailable",
          },
        },
      });
      throw error;
    }
  }

  async payment(userId: string, id: string): Promise<PaymentIntentContract> {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: { id, userId },
    });
    if (!intent) throw new NotFoundException("支付记录不存在");
    return serializePayment(intent);
  }

  async handleWechatNotification(
    headers: Record<string, string | undefined>,
    payload: unknown,
    rawBody: Buffer,
  ) {
    const body = safeObject(payload);
    const decrypted = await this.providers.decodeWechatNotification(
      headers,
      body,
      rawBody,
    );
    const eventKey = String(
      body.id ?? decrypted.transaction_id ?? decrypted.out_trade_no ?? "",
    );
    await this.processProviderEvent(
      "wechat_pay",
      eventKey,
      "PAYMENT_SUCCEEDED",
      body,
      async () => {
        const amount = safeObject(decrypted.amount);
        await this.markPaid(
          String(decrypted.out_trade_no ?? ""),
          String(decrypted.transaction_id ?? ""),
          Number(amount.payer_total ?? amount.total ?? 0),
          decrypted,
        );
      },
    );
    return { code: "SUCCESS", message: "成功" };
  }

  async handleAlipayNotification(payload: Record<string, string>) {
    await this.providers.verifyAlipayNotification(payload);
    const eventKey = `${payload.notify_id ?? payload.trade_no ?? payload.out_trade_no ?? ""}:${payload.trade_status ?? ""}`;
    await this.processProviderEvent(
      "alipay",
      eventKey,
      "PAYMENT_STATUS",
      payload,
      async () => {
        if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(payload.trade_status ?? "")) {
          await this.markPaid(
            payload.out_trade_no ?? "",
            payload.trade_no ?? "",
            Math.round(Number(payload.total_amount ?? 0) * 100),
            payload,
          );
        }
      },
    );
    return "success";
  }

  async handleWechatRefundNotification(
    headers: Record<string, string | undefined>,
    payload: unknown,
    rawBody: Buffer,
  ) {
    const body = safeObject(payload);
    const decrypted = await this.providers.decodeWechatNotification(
      headers,
      body,
      rawBody,
    );
    const eventKey = String(
      body.id ?? decrypted.refund_id ?? decrypted.out_refund_no ?? "",
    );
    await this.processProviderEvent(
      "wechat_pay",
      eventKey,
      "REFUND_STATUS",
      body,
      async () => this.applyWechatRefundResult(decrypted),
    );
    return { code: "SUCCESS", message: "成功" };
  }

  async refundAfterSale(afterSaleId: string, input: unknown) {
    const body = safeObject(input);
    const afterSale = await this.prisma.commerceAfterSale.findUnique({
      where: { id: afterSaleId },
      include: {
        order: {
          include: {
            paymentIntents: {
              where: {
                status: {
                  in: [
                    PaymentStatus.SUCCEEDED,
                    PaymentStatus.REFUNDING,
                    PaymentStatus.PARTIAL_REFUNDED,
                  ],
                },
              },
              orderBy: { paidAt: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    if (!afterSale) throw new NotFoundException("售后记录不存在");
    if (
      !([AfterSaleStatus.APPROVED, AfterSaleStatus.RETURNED] as AfterSaleStatus[]).includes(
        afterSale.status,
      )
    ) {
      throw new ConflictException("售后尚未通过，不能退款");
    }
    const payment = afterSale.order.paymentIntents[0];
    if (!payment) throw new ConflictException("没有可退款的成功支付记录");
    const reason = String(body.reason ?? afterSale.reason).trim();
    return this.createRefund(payment.id, {
      amountCents: afterSale.requestedCents,
      reason,
      afterSaleId,
      idempotencyKey: `after-sale-refund:${afterSaleId}`,
    });
  }

  async createRefund(paymentIntentId: string, input: unknown) {
    const body = safeObject(input);
    const reason = String(body.reason ?? "").trim();
    const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    const amountCents = Number(body.amountCents);
    const afterSaleId = String(body.afterSaleId ?? "").trim() || null;
    if (reason.length < 2 || reason.length > 256) {
      throw new BadRequestException("请填写退款原因");
    }
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new BadRequestException("退款请求编号不正确");
    }
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new BadRequestException("退款金额不正确");
    }
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      include: { refunds: true },
    });
    if (!intent) throw new NotFoundException("支付记录不存在");
    if (intent.channel === PaymentChannel.APPLE_IAP) {
      throw new BadRequestException("苹果购买退款请通过App Store申请");
    }
    if (
      !([PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDING, PaymentStatus.PARTIAL_REFUNDED] as PaymentStatus[]).includes(
        intent.status,
      )
    ) {
      throw new ConflictException("当前支付记录不可退款");
    }
    const committed = intent.refunds
      .filter((refund) =>
        ([RefundStatus.CREATED, RefundStatus.PROCESSING, RefundStatus.SUCCEEDED] as RefundStatus[]).includes(
          refund.status,
        ),
      )
      .reduce((total, refund) => total + refund.amountCents, 0);
    const existing = await this.prisma.paymentRefund.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.paymentIntentId !== intent.id) {
        throw new ConflictException("退款请求编号已被使用");
      }
      if (existing.status === RefundStatus.SUCCEEDED) return existing;
    } else if (committed + amountCents > intent.amountCents) {
      throw new BadRequestException("退款金额超过可退金额");
    }

    const refund = existing ?? await this.prisma.paymentRefund.create({
      data: {
        refundNo: refundNumber(),
        paymentIntentId: intent.id,
        afterSaleId,
        amountCents,
        reason,
        idempotencyKey,
      },
    });
    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentStatus.REFUNDING },
    });
    if (afterSaleId) {
      await this.prisma.commerceAfterSale.update({
        where: { id: afterSaleId },
        data: { status: AfterSaleStatus.REFUNDING },
      });
    }
    try {
      const result = await this.providers.refund({
        refundNo: refund.refundNo,
        paymentNo: intent.paymentNo,
        providerTransactionId: intent.providerTransactionId,
        amountCents: refund.amountCents,
        totalCents: intent.amountCents,
        currency: intent.currency,
        reason: refund.reason,
        channel: intent.channel,
      });
      await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: {
          // Keep the local row non-final until applyRefundSucceeded has updated
          // the payment, order and entitlement ledgers in one transaction.
          status: RefundStatus.PROCESSING,
          providerRefundId: result.providerRefundId,
          providerPayload: result.payload as Prisma.InputJsonValue,
          completedAt: null,
        },
      });
      if (result.completed) {
        await this.applyRefundSucceeded(
          refund.refundNo,
          result.providerRefundId,
          refund.amountCents,
          result.payload,
        );
      }
      return this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
    } catch (error) {
      await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.FAILED,
          providerPayload: { errorCode: "provider_unavailable" },
        },
      });
      await this.restorePaymentRefundStatus(intent.id);
      if (afterSaleId) {
        await this.prisma.commerceAfterSale.updateMany({
          where: { id: afterSaleId, status: AfterSaleStatus.REFUNDING },
          data: { status: AfterSaleStatus.APPROVED },
        });
      }
      throw error;
    }
  }

  async verifyAppleTransaction(userId: string, input: unknown) {
    const body = safeObject(input);
    const paymentIntentId = String(body.paymentIntentId ?? "").trim();
    const signedTransactionInfo = String(body.signedTransactionInfo ?? "").trim();
    if (!paymentIntentId || !signedTransactionInfo) {
      throw new BadRequestException("购买凭证不完整");
    }
    const intent = await this.prisma.paymentIntent.findFirst({
      where: {
        id: paymentIntentId,
        userId,
        channel: PaymentChannel.APPLE_IAP,
      },
    });
    if (!intent) throw new NotFoundException("购买记录不存在");
    try {
      const verified = await this.apple.verifyTransaction(signedTransactionInfo);
      await markIntegrationVerified(this.prisma, "apple_iap");
      return await this.applyVerifiedApplePurchase(
        verified.transaction,
        verified.environment,
        intent.id,
        userId,
      );
    } catch (error) {
      if (error instanceof AppleSignatureVerificationError) {
        throw new BadRequestException("苹果购买凭证验证失败，请恢复购买后重试");
      }
      throw error;
    }
  }

  async handleAppleNotification(input: unknown) {
    const signedPayload = String(safeObject(input).signedPayload ?? "").trim();
    if (!signedPayload) throw new BadRequestException("苹果通知内容不完整");
    let verified;
    try {
      verified = await this.apple.verifyNotification(signedPayload);
    } catch (error) {
      if (error instanceof AppleSignatureVerificationError) {
        throw new BadRequestException("苹果通知验证失败");
      }
      throw error;
    }
    const notification = verified.notification;
    await markIntegrationVerified(this.prisma, "apple_iap");
    const eventKey = String(notification.notificationUUID ?? "").trim();
    const eventType = String(notification.notificationType ?? "UNKNOWN").toUpperCase();
    const transaction = verified.transaction;
    await this.processProviderEvent(
      "apple_iap_notification",
      eventKey,
      eventType,
      appleNotificationPayload(notification, transaction, verified.environment),
      async () => {
        if (!transaction) return;
        if (["REFUND", "REVOKE"].includes(eventType) || transaction.revocationDate) {
          await this.applyAppleRefund(transaction, verified.environment);
          return;
        }
        if (eventType === "REFUND_REVERSED") {
          // A reversal is retained for finance review. Automatically restoring
          // consumed report credits could create duplicate paid content.
          return;
        }
        if (!isUuid(String(transaction.appAccountToken ?? ""))) return;
        const intent = await this.prisma.paymentIntent.findUnique({
          where: { id: String(transaction.appAccountToken) },
          select: { id: true, userId: true },
        });
        if (!intent) return;
        await this.applyVerifiedApplePurchase(
          transaction,
          verified.environment,
          intent.id,
          intent.userId,
        );
      },
    );
    return { received: true };
  }

  private async applyVerifiedApplePurchase(
    transaction: import("@apple/app-store-server-library").JWSTransactionDecodedPayload,
    environment: import("@apple/app-store-server-library").Environment,
    paymentIntentId: string,
    userId: string,
  ) {
    const intent = await this.prisma.paymentIntent.findFirst({
      where: {
        id: paymentIntentId,
        userId,
        channel: PaymentChannel.APPLE_IAP,
      },
    });
    if (!intent) throw new NotFoundException("购买记录不存在");
    const expectedProductId = String(safeObject(intent.providerPayload).productId ?? "");
    if (!expectedProductId) {
      throw new ServiceUnavailableException("苹果购买记录不完整，请联系客服");
    }
    const validationError = appleTransactionValidationError(transaction, {
      accountToken: intent.id,
      productId: expectedProductId,
      amountCents: intent.amountCents,
      currency: intent.currency,
    });
    if (validationError) {
      throw new BadRequestException("苹果购买内容与当前订单不匹配");
    }
    const transactionId = String(transaction.transactionId);
    if (
      intent.providerTransactionId &&
      intent.providerTransactionId !== transactionId
    ) {
      throw new ConflictException("该购买记录已绑定另一笔苹果交易");
    }
    const used = await this.prisma.paymentIntent.findUnique({
      where: { providerTransactionId: transactionId },
      select: { id: true },
    });
    if (used && used.id !== intent.id) {
      throw new ConflictException("该苹果交易已用于其他购买");
    }
    const payload = appleTransactionPayload(transaction, environment);
    await this.processProviderEvent(
      "apple_iap",
      transactionId,
      "PAYMENT_SUCCEEDED",
      payload,
      async () => this.markPaid(
        intent.paymentNo,
        transactionId,
        intent.amountCents,
        payload,
      ),
    );
    return this.payment(userId, intent.id);
  }

  private async applyAppleRefund(
    transaction: import("@apple/app-store-server-library").JWSTransactionDecodedPayload,
    environment: import("@apple/app-store-server-library").Environment,
  ) {
    const transactionId = String(transaction.transactionId ?? "").trim();
    const accountToken = String(transaction.appAccountToken ?? "").trim();
    if (!transactionId) return;
    const intent = await this.prisma.paymentIntent.findFirst({
      where: {
        channel: PaymentChannel.APPLE_IAP,
        OR: [
          { providerTransactionId: transactionId },
          ...(isUuid(accountToken) ? [{ id: accountToken }] : []),
        ],
      },
    });
    if (!intent) return;
    const expectedProductId = String(safeObject(intent.providerPayload).productId ?? "");
    const validationError = appleTransactionValidationError(transaction, {
      accountToken: intent.id,
      productId: expectedProductId,
      amountCents: intent.amountCents,
      currency: intent.currency,
      allowRevoked: true,
    });
    if (validationError) throw new BadRequestException("苹果退款内容与原购买不匹配");
    const refundNo = `APPLE-${transactionId}`;
    const payload = appleTransactionPayload(transaction, environment);
    const refund = await this.prisma.paymentRefund.upsert({
      where: { refundNo },
      create: {
        refundNo,
        paymentIntentId: intent.id,
        amountCents: intent.amountCents,
        reason: "App Store退款或撤销",
        idempotencyKey: `apple-refund:${transactionId}`,
        status: RefundStatus.PROCESSING,
        providerRefundId: transactionId,
        providerPayload: payload as Prisma.InputJsonValue,
      },
      update: {
        providerPayload: payload as Prisma.InputJsonValue,
      },
    });
    await this.applyRefundSucceeded(
      refund.refundNo,
      transactionId,
      refund.amountCents,
      payload,
    );
  }

  async markPaid(
    paymentNo: string,
    transactionId: string,
    paidCents: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const intent = await this.prisma.paymentIntent.findUnique({
      where: { paymentNo },
    });
    if (!intent) throw new NotFoundException("支付记录不存在");
    if (intent.status === PaymentStatus.SUCCEEDED) return;
    if (paidCents !== intent.amountCents) {
      throw new BadRequestException("支付金额不一致");
    }
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.paymentIntent.updateMany({
        where: {
          id: intent.id,
          status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.FAILED] },
        },
        data: {
          status: PaymentStatus.SUCCEEDED,
          providerTransactionId: transactionId,
          providerPayload: payload as Prisma.InputJsonValue,
          paidAt: new Date(),
        },
      });
      if (!changed.count) return;
      if (intent.businessType === BusinessType.COMMERCE_ORDER && intent.commerceOrderId) {
        await tx.commerceOrder.updateMany({
          where: {
            id: intent.commerceOrderId,
            status: CommerceOrderStatus.PENDING_PAYMENT,
          },
          data: { status: CommerceOrderStatus.PAID, paidAt: new Date() },
        });
        await tx.commerceIntegrationJob.upsert({
          where: { idempotencyKey: `jushuitan-order:${intent.commerceOrderId}` },
          create: {
            type: "JUSHUITAN_ORDER_PUSH",
            idempotencyKey: `jushuitan-order:${intent.commerceOrderId}`,
            aggregateType: "commerce_order",
            aggregateId: intent.commerceOrderId,
            payload: { orderId: intent.commerceOrderId },
          },
          update: {},
        });
      }
      if (intent.businessType === BusinessType.HEALTH_REPORT && intent.healthReportId) {
        await this.grantAndConsumeSingleReport(
          tx,
          intent.userId,
          intent.id,
          intent.healthReportId,
        );
      }
      if (
        intent.businessType === BusinessType.HEALTH_MEMBERSHIP &&
        intent.healthMembershipId
      ) {
        await this.activateMembership(tx, intent.userId, intent.healthMembershipId, intent.id);
      }
    });
  }

  private async resolveBusiness(
    userId: string,
    type: BusinessType,
    businessId: string,
    offerId: string,
    platform: string | null,
  ) {
    if (type === BusinessType.COMMERCE_ORDER) {
      const order = await this.prisma.commerceOrder.findFirst({
        where: { id: businessId, userId },
      });
      if (!order) throw new NotFoundException("订单不存在");
      if (order.status !== CommerceOrderStatus.PENDING_PAYMENT) {
        throw new ConflictException("当前订单不可支付");
      }
      return {
        businessId: order.id,
        commerceOrderId: order.id,
        healthReportId: null,
        healthMembershipId: null,
        amountCents: order.payableCents,
        currency: order.currency,
        description: `赛电商城订单 ${order.orderNo}`,
        appleProductId: null,
      };
    }
    const offer = await this.activeOffer(
      offerId,
      type === BusinessType.HEALTH_REPORT
        ? ReportEntitlementType.SINGLE_REPORT
        : ReportEntitlementType.MEMBERSHIP,
      platform,
    );
    if (type === BusinessType.HEALTH_REPORT) {
      const report = await this.prisma.healthReport.findFirst({
        where: { id: businessId, userId },
      });
      if (!report) throw new NotFoundException("健康报告不存在");
      if (report.status !== ReportStatus.AWAITING_PAYMENT) {
        throw new ConflictException("当前报告不需要购买");
      }
      return {
        businessId: report.id,
        commerceOrderId: null,
        healthReportId: report.id,
        healthMembershipId: null,
        amountCents: offer.priceCents,
        currency: offer.currency,
        description: `${offer.title}（AI生成的健康管理参考）`,
        appleProductId: offer.appleProductId,
      };
    }
    const membership = await this.prisma.healthMembership.create({
      data: {
        userId,
        offerId: offer.id,
        creditsGranted: offer.creditCount,
        remainingCredits: 0,
      },
    });
    return {
      businessId: membership.id,
      commerceOrderId: null,
      healthReportId: null,
      healthMembershipId: membership.id,
      amountCents: offer.priceCents,
      currency: offer.currency,
      description: offer.title,
      appleProductId: offer.appleProductId,
    };
  }

  private async applyWechatRefundResult(payload: Record<string, unknown>) {
    const refundNo = String(payload.out_refund_no ?? "");
    const status = String(payload.refund_status ?? "").toUpperCase();
    const amount = safeObject(payload.amount);
    const amountCents = Number(amount.refund ?? amount.payer_refund ?? 0);
    if (status === "SUCCESS") {
      await this.applyRefundSucceeded(
        refundNo,
        String(payload.refund_id ?? "") || null,
        amountCents,
        payload,
      );
      return;
    }
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { refundNo },
    });
    if (!refund) throw new NotFoundException("退款记录不存在");
    await this.prisma.paymentRefund.update({
      where: { id: refund.id },
      data: {
        status: status === "CLOSED" ? RefundStatus.CLOSED : RefundStatus.FAILED,
        providerPayload: payload as Prisma.InputJsonValue,
      },
    });
    await this.restorePaymentRefundStatus(refund.paymentIntentId);
  }

  private async applyRefundSucceeded(
    refundNo: string,
    providerRefundId: string | null,
    amountCents: number,
    payload: Record<string, unknown>,
  ) {
    const refund = await this.prisma.paymentRefund.findUnique({
      where: { refundNo },
      include: { paymentIntent: true },
    });
    if (!refund) throw new NotFoundException("退款记录不存在");
    if (amountCents > 0 && amountCents !== refund.amountCents) {
      throw new BadRequestException("退款金额不一致");
    }
    if (refund.status === RefundStatus.SUCCEEDED && refund.completedAt) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentRefund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.SUCCEEDED,
          providerRefundId,
          providerPayload: payload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      const totals = await tx.paymentRefund.aggregate({
        where: {
          paymentIntentId: refund.paymentIntentId,
          status: RefundStatus.SUCCEEDED,
        },
        _sum: { amountCents: true },
      });
      const fullyRefunded = (totals._sum.amountCents ?? 0) >= refund.paymentIntent.amountCents;
      await tx.paymentIntent.update({
        where: { id: refund.paymentIntentId },
        data: {
          status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PARTIAL_REFUNDED,
        },
      });
      if (refund.afterSaleId) {
        await tx.commerceAfterSale.update({
          where: { id: refund.afterSaleId },
          data: { status: AfterSaleStatus.COMPLETED },
        });
      }
      if (refund.paymentIntent.commerceOrderId) {
        await tx.commerceOrder.update({
          where: { id: refund.paymentIntent.commerceOrderId },
          data: {
            status: fullyRefunded
              ? CommerceOrderStatus.REFUNDED
              : CommerceOrderStatus.AFTER_SALE,
          },
        });
      }
      if (refund.paymentIntent.healthReportId) {
        const balance = await tx.reportCreditLedger.aggregate({
          where: { userId: refund.paymentIntent.userId, membershipId: null },
          _sum: { delta: true },
        });
        const available = Math.max(0, balance._sum.delta ?? 0);
        await tx.reportCreditLedger.upsert({
          where: { idempotencyKey: `refund-revoke:${refund.id}` },
          create: {
            userId: refund.paymentIntent.userId,
            type: CreditLedgerType.REFUND_REVOKE,
            delta: available > 0 ? -1 : 0,
            balanceAfter: Math.max(0, available - 1),
            sourceType: "payment_refund",
            sourceId: refund.id,
            healthReportId: refund.paymentIntent.healthReportId,
            idempotencyKey: `refund-revoke:${refund.id}`,
          },
          update: {},
        });
        await tx.healthReport.update({
          where: { id: refund.paymentIntent.healthReportId },
          data: { status: ReportStatus.REVOKED, revokedAt: new Date() },
        });
      }
      if (refund.paymentIntent.healthMembershipId) {
        const membership = await tx.healthMembership.findUnique({
          where: { id: refund.paymentIntent.healthMembershipId },
        });
        if (membership) {
          const consumed = await tx.reportCreditLedger.findMany({
            where: {
              membershipId: membership.id,
              type: CreditLedgerType.CONSUME,
              healthReportId: { not: null },
            },
            select: { healthReportId: true },
          });
          await tx.healthReport.updateMany({
            where: {
              id: { in: consumed.flatMap((item) => item.healthReportId ? [item.healthReportId] : []) },
            },
            data: { status: ReportStatus.REVOKED, revokedAt: new Date() },
          });
          await tx.reportCreditLedger.upsert({
            where: { idempotencyKey: `refund-revoke:${refund.id}` },
            create: {
              userId: refund.paymentIntent.userId,
              type: CreditLedgerType.REFUND_REVOKE,
              delta: -membership.remainingCredits,
              balanceAfter: 0,
              sourceType: "payment_refund",
              sourceId: refund.id,
              membershipId: membership.id,
              idempotencyKey: `refund-revoke:${refund.id}`,
            },
            update: {},
          });
          await tx.healthMembership.update({
            where: { id: membership.id },
            data: {
              status: MembershipStatus.REFUNDED,
              remainingCredits: 0,
              refundedAt: new Date(),
            },
          });
        }
      }
    });
  }

  private async restorePaymentRefundStatus(paymentIntentId: string) {
    const totals = await this.prisma.paymentRefund.aggregate({
      where: { paymentIntentId, status: RefundStatus.SUCCEEDED },
      _sum: { amountCents: true },
    });
    const intent = await this.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: paymentIntentId },
    });
    const refunded = totals._sum.amountCents ?? 0;
    await this.prisma.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: refunded === 0
          ? PaymentStatus.SUCCEEDED
          : refunded >= intent.amountCents
            ? PaymentStatus.REFUNDED
            : PaymentStatus.PARTIAL_REFUNDED,
      },
    });
  }

  private async activeOffer(
    offerId: string,
    entitlement: ReportEntitlementType,
    platform: string | null,
  ) {
    if (!offerId) throw new BadRequestException("请选择购买方案");
    const now = new Date();
    const offer = await this.prisma.healthReportOffer.findFirst({
      where: {
        id: offerId,
        entitlement,
        active: true,
        ...(platform ? { platforms: { has: platform } } : {}),
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
        AND: [{ OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] }],
      },
    });
    if (!offer) throw new BadRequestException("购买方案已失效，请刷新后重试");
    return offer;
  }

  private async grantAndConsumeSingleReport(
    tx: Prisma.TransactionClient,
    userId: string,
    paymentIntentId: string,
    reportId: string,
  ) {
    const grantKey = `payment-grant:${paymentIntentId}`;
    const grant = await tx.reportCreditLedger.findUnique({
      where: { idempotencyKey: grantKey },
    });
    const current = await tx.reportCreditLedger.aggregate({
      where: { userId, membershipId: null },
      _sum: { delta: true },
    });
    if (!grant) {
      await tx.reportCreditLedger.create({
        data: {
          userId,
          type: CreditLedgerType.GRANT,
          delta: 1,
          balanceAfter: Math.max(0, current._sum.delta ?? 0) + 1,
          sourceType: "payment_intent",
          sourceId: paymentIntentId,
          idempotencyKey: grantKey,
        },
      });
    }
    const consumeKey = `report-consume:${reportId}`;
    const consumed = await tx.reportCreditLedger.findUnique({
      where: { idempotencyKey: consumeKey },
    });
    if (!consumed) {
      await tx.reportCreditLedger.create({
        data: {
          userId,
          type: CreditLedgerType.CONSUME,
          delta: -1,
          balanceAfter: Math.max(0, current._sum.delta ?? 0),
          sourceType: "payment_intent",
          sourceId: paymentIntentId,
          healthReportId: reportId,
          idempotencyKey: consumeKey,
        },
      });
    }
    await tx.healthReport.update({
      where: { id: reportId },
      data: { status: ReportStatus.QUEUED, failureReason: null },
    });
    await queueReport(tx, userId, reportId);
  }

  private async activateMembership(
    tx: Prisma.TransactionClient,
    userId: string,
    membershipId: string,
    paymentIntentId: string,
  ) {
    const membership = await tx.healthMembership.findUnique({
      where: { id: membershipId },
      include: { offer: true },
    });
    if (!membership || membership.status === MembershipStatus.ACTIVE) return;
    const startsAt = new Date();
    const expiresAt = new Date(
      startsAt.valueOf() + (membership.offer.durationDays ?? 30) * 86_400_000,
    );
    const existingCredits = await tx.healthMembership.aggregate({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        expiresAt: { gt: startsAt },
      },
      _sum: { remainingCredits: true },
    });
    const standalone = await tx.reportCreditLedger.aggregate({
      where: { userId, membershipId: null },
      _sum: { delta: true },
    });
    await tx.healthMembership.update({
      where: { id: membership.id },
      data: {
        status: MembershipStatus.ACTIVE,
        startsAt,
        expiresAt,
        remainingCredits: membership.creditsGranted,
      },
    });
    await tx.reportCreditLedger.create({
      data: {
        userId,
        type: CreditLedgerType.GRANT,
        delta: membership.creditsGranted,
        balanceAfter:
          Math.max(0, standalone._sum.delta ?? 0) +
          (existingCredits._sum.remainingCredits ?? 0) +
          membership.creditsGranted,
        sourceType: "health_membership",
        sourceId: membership.id,
        membershipId: membership.id,
        expiresAt,
        idempotencyKey: `payment-grant:${paymentIntentId}`,
      },
    });
  }

  private async processProviderEvent(
    provider: string,
    eventKey: string,
    eventType: string,
    payload: Record<string, unknown>,
    process: () => Promise<void>,
  ) {
    if (!eventKey) throw new BadRequestException("支付通知缺少唯一编号");
    const existing = await this.prisma.providerEvent.findUnique({
      where: { provider_eventKey: { provider, eventKey } },
    });
    if (existing?.processedAt) return;
    if (!existing) {
      try {
        await this.prisma.providerEvent.create({
          data: {
            provider,
            eventKey,
            eventType,
            payload: payload as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }
    try {
      await process();
      await this.prisma.providerEvent.update({
        where: { provider_eventKey: { provider, eventKey } },
        data: { processedAt: new Date(), processError: null },
      });
    } catch (error) {
      await this.prisma.providerEvent.update({
        where: { provider_eventKey: { provider, eventKey } },
        data: { processError: sanitizeError(error) },
      });
      throw error;
    }
  }

  private async expireMemberships(userId: string, now: Date): Promise<void> {
    const expired = await this.prisma.healthMembership.findMany({
      where: {
        userId,
        status: MembershipStatus.ACTIVE,
        expiresAt: { lte: now },
      },
    });
    for (const membership of expired) {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.healthMembership.updateMany({
          where: { id: membership.id, status: MembershipStatus.ACTIVE },
          data: { status: MembershipStatus.EXPIRED, remainingCredits: 0 },
        });
        if (changed.count && membership.remainingCredits > 0) {
          await tx.reportCreditLedger.upsert({
            where: { idempotencyKey: `membership-expire:${membership.id}` },
            create: {
              userId,
              type: CreditLedgerType.EXPIRE,
              delta: -membership.remainingCredits,
              balanceAfter: 0,
              sourceType: "health_membership",
              sourceId: membership.id,
              membershipId: membership.id,
              idempotencyKey: `membership-expire:${membership.id}`,
            },
            update: {},
          });
        }
      });
    }
  }
}

async function queueReport(
  tx: Prisma.TransactionClient,
  userId: string,
  reportId: string,
) {
  await tx.outboxEvent.upsert({
    where: { eventId: `health-report-generate:${reportId}` },
    create: {
      eventId: `health-report-generate:${reportId}`,
      eventType: "health_report_generate",
      aggregateType: "health_report",
      aggregateId: reportId,
      payload: { userId, reportId },
    },
    update: {
      status: OutboxStatus.PENDING,
      nextAttemptAt: new Date(),
      lockedAt: null,
      lastError: null,
    },
  });
}

function normalizedPlatform(value: unknown): string | null {
  const platform = String(value ?? "").trim().toLowerCase();
  if (!platform) return null;
  if (!["android", "ios", "h5", "mini_program", "web"].includes(platform)) {
    throw new BadRequestException("客户端平台不正确");
  }
  return platform;
}

export function enforceDigitalPlatformPolicy(
  businessType: BusinessType,
  channel: PaymentChannel,
  platform: string | null,
) {
  if (businessType === BusinessType.COMMERCE_ORDER) return;
  if (platform === "ios" && channel !== PaymentChannel.APPLE_IAP) {
    throw new BadRequestException("iPhone内的数字健康内容请使用苹果应用内购买");
  }
  if (platform !== "ios" && channel === PaymentChannel.APPLE_IAP) {
    throw new BadRequestException("当前设备不支持苹果应用内购买");
  }
}

function paymentNumber(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `PAY${stamp}${randomBytes(5).toString("hex").toUpperCase()}`;
}

function refundNumber(): string {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `REF${stamp}${randomBytes(5).toString("hex").toUpperCase()}`;
}

function appleTransactionPayload(
  transaction: import("@apple/app-store-server-library").JWSTransactionDecodedPayload,
  environment: import("@apple/app-store-server-library").Environment,
): Record<string, unknown> {
  return withoutUndefined({
    environment,
    transactionId: transaction.transactionId,
    originalTransactionId: transaction.originalTransactionId,
    productId: transaction.productId,
    appAccountToken: transaction.appAccountToken,
    purchaseDate: transaction.purchaseDate,
    signedDate: transaction.signedDate,
    revocationDate: transaction.revocationDate,
    revocationReason: transaction.revocationReason,
    currency: transaction.currency,
    price: transaction.price,
    quantity: transaction.quantity,
  });
}

function appleNotificationPayload(
  notification: import("@apple/app-store-server-library").ResponseBodyV2DecodedPayload,
  transaction: import("@apple/app-store-server-library").JWSTransactionDecodedPayload | null,
  environment: import("@apple/app-store-server-library").Environment,
): Record<string, unknown> {
  return withoutUndefined({
    environment,
    notificationUUID: notification.notificationUUID,
    notificationType: notification.notificationType,
    subtype: notification.subtype,
    version: notification.version,
    signedDate: notification.signedDate,
    transaction: transaction ? appleTransactionPayload(transaction, environment) : undefined,
  });
}

function withoutUndefined(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function serializePayment(intent: {
  id: string;
  paymentNo: string;
  businessType: BusinessType;
  businessId: string;
  channel: PaymentChannel;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  providerPayload: unknown;
  createdAt: Date;
}): PaymentIntentContract {
  return {
    id: intent.id,
    paymentNo: intent.paymentNo,
    businessType: intent.businessType.toLowerCase() as PaymentIntentContract["businessType"],
    businessId: intent.businessId,
    channel: intent.channel.toLowerCase() as PaymentIntentContract["channel"],
    status: intent.status.toLowerCase() as PaymentIntentContract["status"],
    amountCents: intent.amountCents,
    currency: intent.currency,
    invoke:
      intent.status === PaymentStatus.PENDING
        ? safeObject(intent.providerPayload)
        : null,
    createdAt: intent.createdAt.toISOString(),
  };
}

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : "payment processing failed")
    .replace(/[\r\n]/g, " ")
    .slice(0, 500);
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
