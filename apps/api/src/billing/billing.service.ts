import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import { PaymentProviderService, assertGlobalPaymentScope, assertGlobalPaymentSupported } from "./payment-provider.service";
import { onCommerceOrderPaid, onCommerceRefundSucceeded, onCommercePointsRefundSucceeded, afterSaleSettlementSnapshot, settlePointOnlyAfterSale, allItemsReturned } from "../commerce/commerce-finance";
import { orderFulfillmentState } from "../commerce/commerce-finance";
import { shouldDeferCallbacks, shouldPauseWorkers } from "@saydian/app-contracts";

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
  private readonly logger = new Logger(BillingService.name);

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
      if (existing.userId !== userId || existing.businessType !== businessTypeMap[businessTypeInput] ||
        existing.channel !== paymentChannelMap[channelInput] || (businessId && existing.businessId !== businessId)) {
        throw new ConflictException("支付请求编号已被使用");
      }
      return serializePayment(existing);
    }

    const businessType = businessTypeMap[businessTypeInput];
    const channel = paymentChannelMap[channelInput];
    assertPaymentOutboundEnabled();
    enforceDigitalPlatformPolicy(businessType, channel, platform);
    // Membership resolution can create a row: reject unsupported global scopes first.
    assertGlobalPaymentScope({ channel, businessType });
    const resolved = await this.resolveBusiness(
      userId,
      businessType,
      businessId,
      offerId,
      platform,
    );
    assertGlobalPaymentSupported({ channel, businessType, currency: resolved.currency });
    const identity = await this.providers.identity(channel);
    if (channel === PaymentChannel.WECHAT_JSAPI) {
      if (!identity.appId) throw new ServiceUnavailableException("微信公众号支付应用尚未配置");
      // Fail before reserving a pending payment relationship; the provider rechecks at dispatch.
      await this.providers.resolveOfficialPayer(userId, identity.appId);
    }
    const reserved = await this.prisma.$transaction(async tx => {
      if (resolved.commerceOrderId) {
        await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${resolved.commerceOrderId}::uuid FOR UPDATE`;
        const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: resolved.commerceOrderId } });
        assertNewExecutionOwner(order);
        if (order.status !== CommerceOrderStatus.PENDING_PAYMENT) throw new ConflictException("订单状态已变化，请刷新");
        const active = await tx.paymentIntent.findFirst({
          where: { commerceOrderId: order.id, status: { notIn: [PaymentStatus.CLOSED] } },
          include: { user: { select: { wechatOpenId: true } } }, orderBy: { createdAt: "desc" },
        });
        if (active) {
          assertNewExecutionOwner(active);
          if (active.channel !== channel) throw new ConflictException("原支付关系未关闭，请先确认原渠道状态");
          return { intent: active, dispatch: false };
        }
      }
      const intent = await tx.paymentIntent.create({
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
        providerMerchantId: identity.merchantId,
        providerAppId: identity.appId,
        description: resolved.description,
        idempotencyKey,
      },
      include: { user: { select: { wechatOpenId: true } } },
    });
      return { intent, dispatch: true };
    });
    const { intent } = reserved;
    if (!reserved.dispatch) return serializePayment(intent);
    try {
      assertPaymentOutboundEnabled();
      const invoke = await this.providers.create(intent, {
        wechatOpenId: intent.user.wechatOpenId,
        ...(context.clientIp ? { clientIp: context.clientIp } : {}),
        appleProductId: resolved.appleProductId,
      });
      await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: PaymentStatus.CREATED },
        data: {
          status: PaymentStatus.PENDING,
          providerPayload: invoke as Prisma.InputJsonValue,
        },
      });
      const updated = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      return serializePayment(updated);
    } catch (error) {
      await this.prisma.paymentIntent.updateMany({
        where: { id: intent.id, status: PaymentStatus.CREATED },
        data: {
          status: PaymentStatus.PENDING,
          providerPayload: {
            errorCode: "provider_result_unknown", reconciliationRequired: true,
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
    if (
      ([PaymentStatus.CREATED, PaymentStatus.PENDING] as PaymentStatus[]).includes(intent.status) &&
      intent.channel.startsWith("WECHAT") &&
      intent.providerMerchantId &&
      intent.providerAppId
    ) {
      try {
        assertPaymentOutboundEnabled();
        const payload = await this.providers.queryWechatPayment(intent);
        if (payload.trade_state === "SUCCESS") {
          const amount = safeObject(payload.amount);
          const transactionId = String(payload.transaction_id ?? "");
          const paidCents = amount.total;
          if (
            String(payload.out_trade_no ?? "") !== intent.paymentNo ||
            String(payload.mchid ?? "") !== intent.providerMerchantId ||
            String(payload.appid ?? "") !== intent.providerAppId ||
            amount.currency !== intent.currency ||
            typeof paidCents !== "number" ||
            !Number.isSafeInteger(paidCents) ||
            paidCents !== intent.amountCents ||
            !transactionId ||
            transactionId.length > 256 ||
            /\s/.test(transactionId)
          ) {
            throw new BadRequestException("微信查单结果与原支付记录不匹配");
          }
          await this.markPaid(intent.paymentNo, transactionId, paidCents, payload);
          const refreshed = await this.prisma.paymentIntent.findFirst({
            where: { id, userId },
          });
          if (refreshed) return serializePayment(refreshed);
        }
      } catch (error) {
        this.logger.warn(
          `Wechat payment reconciliation failed for ${intent.id}: ${sanitizeError(error)}`,
        );
      }
    }
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
      decrypted,
      async () => {
        if (decrypted.trade_state !== "SUCCESS") throw new BadRequestException("微信支付通知不是成功状态");
        const amount = safeObject(decrypted.amount);
        await this.markPaid(
          String(decrypted.out_trade_no ?? ""),
          String(decrypted.transaction_id ?? ""),
          Number(amount.total),
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
      decrypted,
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
    assertNewExecutionOwner(afterSale);
    assertNewExecutionOwner(afterSale.order);
    if (afterSale.requestedCents === 0) {
      return this.prisma.$transaction(tx => settlePointOnlyAfterSale(tx, afterSaleId));
    }
    if (afterSale.type === "RETURN_REFUND" && afterSale.status !== AfterSaleStatus.RETURNED) {
      throw new ConflictException("退货退款必须先确认退回商品");
    }
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
    assertPaymentOutboundEnabled();
    const reservation = await this.prisma.$transaction(async (tx) => {
    const target = await tx.paymentIntent.findUnique({ where: { id: paymentIntentId }, select: { commerceOrderId: true } });
    if (target?.commerceOrderId) await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${target.commerceOrderId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "PaymentIntent" WHERE id = ${paymentIntentId}::uuid FOR UPDATE`;
    const intent = await tx.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      include: { refunds: true, commerceOrder: true },
    });
    if (!intent) throw new NotFoundException("支付记录不存在");
    assertNewExecutionOwner(intent);
    if (intent.commerceOrder) assertNewExecutionOwner(intent.commerceOrder);
    const existing = await tx.paymentRefund.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.paymentIntentId !== intent.id || existing.amountCents !== amountCents || existing.afterSaleId !== afterSaleId) {
        throw new ConflictException("退款请求编号已被不同参数使用");
      }
      // Includes migrated and uncertain requests: never send an existing money
      // request again. Reconcile its original provider reference first.
      return { intent, refund: existing, dispatch: false };
    }
    let refundAllocation: { merchandiseRefundCents: number; shippingRefundCents: number } | undefined;
    if (afterSaleId) {
      const afterSale = await tx.commerceAfterSale.findUnique({ where: { id: afterSaleId } });
      if (!afterSale || afterSale.orderId !== intent.commerceOrderId || amountCents > afterSale.requestedCents ||
        !([AfterSaleStatus.APPROVED, AfterSaleStatus.RETURNED] as AfterSaleStatus[]).includes(afterSale.status)) {
        throw new ConflictException("售后归属、审核状态或退款额度不匹配");
      }
      assertNewExecutionOwner(afterSale);
      if (afterSale.type === "RETURN_REFUND" && afterSale.status !== AfterSaleStatus.RETURNED) throw new ConflictException("退货尚未确认收货");
      const allocation = await afterSaleSettlementSnapshot(tx, afterSaleId);
      if (!allocation.legacyCash && amountCents !== allocation.sale.requestedCents) throw new ConflictException("必须按已审核的现金与积分分摊整体结算");
      if (allocation.sale.refunds.some(refund => ["CREATED", "PROCESSING", "SUCCEEDED"].includes(refund.status))) throw new ConflictException("此售后已有退款占用，请核对原退款");
      // Original cash-only pre-snapshot refunds keep their legacy policy.
      if (!allocation.legacyCash) refundAllocation = allocation;
    } else if (intent.commerceOrder && (intent.commerceOrder.pricingVersion === 1 || intent.commerceOrder.pointDiscountCents > 0 || intent.commerceOrder.sourceSystem !== "canonical")) {
      throw new ConflictException("请先建立并核验商品级售后，不能绕过积分或运费分摊");
    }
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
    if (committed + amountCents > intent.amountCents) {
      throw new BadRequestException("退款金额超过可退金额");
    }

    const refund = await tx.paymentRefund.create({
      data: {
        refundNo: refundNumber(),
        paymentIntentId: intent.id,
        afterSaleId,
        amountCents,
        ...(refundAllocation ? { merchandiseRefundCents: refundAllocation.merchandiseRefundCents, shippingRefundCents: refundAllocation.shippingRefundCents } : {}),
        reason,
        idempotencyKey,
        status: RefundStatus.PROCESSING,
      },
    });
    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentStatus.REFUNDING },
    });
    if (afterSaleId) {
      await tx.commerceAfterSale.update({
        where: { id: afterSaleId },
        data: { status: AfterSaleStatus.REFUNDING, version: { increment: 1 } },
      });
    }
    return { intent, refund, dispatch: true };
    });
    const { intent, refund } = reservation;
    if (!reservation.dispatch) return refund;
    try {
      assertPaymentOutboundEnabled();
      await this.providers.assertIdentity(intent);
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
      await this.prisma.paymentRefund.updateMany({
        where: { id: refund.id, status: { not: RefundStatus.SUCCEEDED } },
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
          result.amountCents,
          result.payload,
        );
      }
      return this.prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
    } catch (error) {
      await this.prisma.paymentRefund.updateMany({
        where: { id: refund.id, status: { not: RefundStatus.SUCCEEDED } },
        data: {
          status: RefundStatus.PROCESSING,
          providerPayload: { errorCode: "provider_result_unknown", reconciliationRequired: true },
        },
      });
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
    assertNewExecutionOwner(intent);
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
    assertNewExecutionOwner(intent);
    assertProviderResultIdentity(intent, payload);
    if (!transactionId || !Number.isSafeInteger(paidCents) || paidCents !== intent.amountCents) {
      throw new BadRequestException("支付金额不一致");
    }
    if (intent.providerTransactionId && intent.providerTransactionId !== transactionId) throw new ConflictException("支付记录已绑定其他渠道交易");
    if (intent.status === PaymentStatus.SUCCEEDED) return;
    await this.prisma.$transaction(async (tx) => {
      // Consistent lock order with order cancellation and payment creation.
      if (intent.commerceOrderId) {
        await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${intent.commerceOrderId}::uuid FOR UPDATE`;
        assertNewExecutionOwner(await tx.commerceOrder.findUniqueOrThrow({ where: { id: intent.commerceOrderId } }));
      }
      const changed = await tx.paymentIntent.updateMany({
        where: {
          id: intent.id,
          status: { in: [PaymentStatus.CREATED, PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.CLOSED] },
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
        const paidOrder = await tx.commerceOrder.updateMany({
          where: {
            id: intent.commerceOrderId,
            status: CommerceOrderStatus.PENDING_PAYMENT,
          },
          data: { status: CommerceOrderStatus.PAID, paidAt: new Date(), version: { increment: 1 } },
        });
        if (!paidOrder.count) {
          await tx.auditLog.create({ data: { actorType: "provider", actorId: transactionId, action: "PAYMENT_ORDER_STATE_CONFLICT", entityType: "commerce_order", entityId: intent.commerceOrderId,
            afterJson: { paymentNo, paidCents, reconciliationRequired: true, message: "款项已确认，订单状态不允许自动履约；未重新预占库存或推送ERP" } } });
          return;
        }
        await onCommerceOrderPaid(tx, intent.commerceOrderId);
        const erpItems = await tx.commerceOrderItem.count({ where: { orderId: intent.commerceOrderId, product: { source: "ERP" } } });
        if (erpItems) {
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
      assertNewExecutionOwner(order);
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
    const amountCents = Number(amount.refund);
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
      include: { paymentIntent: true },
    });
    if (!refund) throw new NotFoundException("退款记录不存在");
    await this.prisma.$transaction(async tx => {
      if (refund.paymentIntent.commerceOrderId) {
        await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${refund.paymentIntent.commerceOrderId}::uuid FOR UPDATE`;
        assertNewExecutionOwner(await tx.commerceOrder.findUniqueOrThrow({ where: { id: refund.paymentIntent.commerceOrderId } }));
      }
      await tx.$queryRaw`SELECT id FROM "PaymentIntent" WHERE id = ${refund.paymentIntentId}::uuid FOR UPDATE`;
      const current = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refund.id }, include: { paymentIntent: true } });
      assertRefundResultBinding(current, payload, amountCents, String(payload.refund_id ?? "") || null);
      if (current.paymentIntent.providerMerchantId && payload.mchid !== current.paymentIntent.providerMerchantId) throw new BadRequestException("微信退款回执商户不匹配");
      if (current.status === RefundStatus.SUCCEEDED) return;
      await tx.paymentRefund.updateMany({
        where: { id: current.id, status: { not: RefundStatus.SUCCEEDED } },
        data: {
          status: status === "CLOSED" ? RefundStatus.CLOSED : RefundStatus.PROCESSING,
          providerPayload: payload as Prisma.InputJsonValue,
        },
      });
      await this.restorePaymentRefundStatus(tx, current.paymentIntentId);
    });
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
    assertRefundResultBinding(refund, payload, amountCents, providerRefundId);
    if (refund.status === RefundStatus.SUCCEEDED && refund.completedAt) return;
    await this.prisma.$transaction(async (tx) => {
      if (refund.paymentIntent.commerceOrderId) {
        await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${refund.paymentIntent.commerceOrderId}::uuid FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT id FROM "PaymentIntent" WHERE id = ${refund.paymentIntentId}::uuid FOR UPDATE`;
      const current = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refund.id }, include: { paymentIntent: true } });
      assertRefundResultBinding(current, payload, amountCents, providerRefundId);
      const completed = await tx.paymentRefund.updateMany({
        where: { id: refund.id, completedAt: null },
        data: {
          status: RefundStatus.SUCCEEDED,
          providerRefundId,
          providerPayload: payload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      if (!completed.count) return;
      const totals = await tx.paymentRefund.aggregate({
        where: {
          paymentIntentId: refund.paymentIntentId,
          status: RefundStatus.SUCCEEDED,
        },
        _sum: { amountCents: true },
      });
      const fullyRefunded = (totals._sum.amountCents ?? 0) >= refund.paymentIntent.amountCents;
      await this.restorePaymentRefundStatus(tx, refund.paymentIntentId);
      if (refund.afterSaleId) {
        await tx.commerceAfterSale.update({
          where: { id: refund.afterSaleId },
          data: { status: AfterSaleStatus.COMPLETED, version: { increment: 1 } },
        });
      }
      if (refund.paymentIntent.commerceOrderId) {
        const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: refund.paymentIntent.commerceOrderId }, include: { items: true, shipments: { include: { items: true } }, afterSales: { include: { items: true } } } });
        assertNewExecutionOwner(order);
        const openAfterSale = order.afterSales.some(item => item.id !== refund.afterSaleId && !["REJECTED", "CANCELLED", "COMPLETED"].includes(item.status));
        await tx.commerceOrder.update({
          where: { id: refund.paymentIntent.commerceOrderId },
          data: {
            ...(fullyRefunded && (order.pricingVersion !== 1 || allItemsReturned(order))
              ? { status: CommerceOrderStatus.REFUNDED }
              : openAfterSale ? { status: CommerceOrderStatus.AFTER_SALE }
              : orderFulfillmentState(order)),
            version: { increment: 1 },
          },
        });
        await onCommerceRefundSucceeded(tx, refund.id);
        await onCommercePointsRefundSucceeded(tx, refund.id);
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

  // Caller holds the order -> payment locks; never recompute outside this transaction.
  private async restorePaymentRefundStatus(tx: Prisma.TransactionClient, paymentIntentId: string) {
    const totals = await tx.paymentRefund.aggregate({
      where: { paymentIntentId, status: RefundStatus.SUCCEEDED },
      _sum: { amountCents: true },
    });
    const intent = await tx.paymentIntent.findUniqueOrThrow({
      where: { id: paymentIntentId },
    });
    const refunded = totals._sum.amountCents ?? 0;
    const pending = await tx.paymentRefund.count({ where: { paymentIntentId, status: { in: [RefundStatus.CREATED, RefundStatus.PROCESSING] } } });
    await tx.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: pending > 0 ? PaymentStatus.REFUNDING : refunded === 0
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
    handle: () => Promise<void>,
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
            verifiedAt: new Date(),
            processingState: shouldDeferCallbacks(process.env) ? "DEFERRED" : "VERIFIED",
          },
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }
    // Older inbox rows contain encrypted provider bodies and have no verification
    // marker. Only a freshly signature-verified delivery can upgrade them.
    if (existing && !existing.verifiedAt) {
      await this.prisma.providerEvent.update({ where: { id: existing.id }, data: {
        payload: payload as Prisma.InputJsonValue, verifiedAt: new Date(), processingState: "VERIFIED",
      } });
    }
    if (shouldDeferCallbacks(process.env)) {
      await this.prisma.providerEvent.updateMany({ where: { provider, eventKey, processedAt: null }, data: { processingState: "DEFERRED" } });
      return;
    }
    try {
      await handle();
      await this.prisma.providerEvent.update({
        where: { provider_eventKey: { provider, eventKey } },
        data: { processedAt: new Date(), processError: null, processingState: "COMPLETED" },
      });
    } catch (error) {
      await this.prisma.providerEvent.update({
        where: { provider_eventKey: { provider, eventKey } },
        data: { processError: sanitizeError(error), processingState: "FAILED" },
      });
      throw error;
    }
  }

  async replayVerifiedProviderEvents(input: unknown) {
    if (shouldDeferCallbacks(process.env)) throw new ConflictException("回调业务处理仍暂停，不能回放");
    const limit = Math.max(1, Math.min(100, Math.trunc(Number(safeObject(input).limit) || 20)));
    const events = await this.prisma.providerEvent.findMany({ where: { processedAt: null, verifiedAt: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit });
    const results: Array<{ id: string; processed: boolean; error?: string }> = [];
    for (const event of events) {
      if (shouldDeferCallbacks(process.env)) break;
      try {
        const payload = safeObject(event.payload);
        await this.processProviderEvent(event.provider, event.eventKey, event.eventType, payload, async () => {
          if (event.provider === "wechat_pay") {
            if (event.eventType === "REFUND_STATUS") return this.applyWechatRefundResult(payload);
            if (payload.trade_state !== "SUCCESS") throw new ConflictException("微信支付事件不是成功状态");
            const amount = safeObject(payload.amount);
            return this.markPaid(String(payload.out_trade_no ?? ""), String(payload.transaction_id ?? ""), Number(amount.total), payload);
          }
          if (event.provider === "alipay") {
            if (["TRADE_SUCCESS", "TRADE_FINISHED"].includes(String(payload.trade_status))) {
              await this.markPaid(String(payload.out_trade_no ?? ""), String(payload.trade_no ?? ""), Math.round(Number(payload.total_amount) * 100), payload);
            }
            return;
          }
          if (event.provider === "apple_iap" || event.provider === "apple_iap_notification") {
            const transaction = (event.provider === "apple_iap" ? payload : safeObject(payload.transaction)) as import("@apple/app-store-server-library").JWSTransactionDecodedPayload;
            const environment = String(payload.environment) as import("@apple/app-store-server-library").Environment;
            if (!transaction.transactionId || !transaction.appAccountToken) throw new ConflictException("历史苹果回调内容不足，需原签名回执复核");
            if (event.eventType === "REFUND_REVERSED") throw new ConflictException("苹果退款撤销需财务复核，不自动重发权益");
            if (["REFUND", "REVOKE"].includes(event.eventType) || transaction.revocationDate) return this.applyAppleRefund(transaction, environment);
            const intent = await this.prisma.paymentIntent.findUniqueOrThrow({ where: { id: String(transaction.appAccountToken) } });
            const error = appleTransactionValidationError(transaction, { accountToken: intent.id, productId: String(safeObject(intent.providerPayload).productId ?? ""), amountCents: intent.amountCents, currency: intent.currency });
            if (error) throw new ConflictException("苹果回调与原支付不匹配");
            return this.markPaid(intent.paymentNo, String(transaction.transactionId), intent.amountCents, payload);
          }
          throw new ConflictException("未知供应商事件，不能自动回放");
        });
        results.push({ id: event.id, processed: true });
      } catch (error) { results.push({ id: event.id, processed: false, error: sanitizeError(error) }); }
    }
    return { items: results, remaining: await this.prisma.providerEvent.count({ where: { processedAt: null, verifiedAt: { not: null } } }) };
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

export function assertNewExecutionOwner(record: { executionOwner: string }) {
  if (record.executionOwner !== "NEW_SYSTEM") throw new ConflictException("该交易尚未完成新系统接管核验，禁止资金或履约出站");
}

export function assertPaymentOutboundEnabled(environment: Record<string, string | undefined> = process.env) {
  if (shouldPauseWorkers(environment)) throw new ServiceUnavailableException("交易出站已暂停，原支付及退款关系保留，待恢复后核对");
}

export function assertProviderResultIdentity(intent: { channel: PaymentChannel; currency: string; providerMerchantId: string | null; providerAppId: string | null }, payload: Record<string, unknown>, refund = false) {
  if (intent.channel === PaymentChannel.APPLE_IAP) return;
  const amount = safeObject(payload.amount);
  if (amount.currency && amount.currency !== intent.currency) throw new BadRequestException("渠道回执币种不匹配");
  if (intent.channel.startsWith("WECHAT")) {
    if ((!refund || payload.mchid !== undefined) && intent.providerMerchantId && String(payload.mchid ?? "") !== intent.providerMerchantId) throw new BadRequestException("微信回执商户不匹配");
    if (!refund && intent.providerAppId && String(payload.appid ?? "") !== intent.providerAppId) throw new BadRequestException("微信回执应用不匹配");
  } else if (!refund && intent.providerAppId && String(payload.app_id ?? "") !== intent.providerAppId) {
    throw new BadRequestException("支付宝回执应用不匹配");
  }
}

export function assertRefundResultBinding(refund: {
  executionOwner: string; refundNo: string; amountCents: number; providerRefundId: string | null;
  paymentIntent: { executionOwner: string; channel: PaymentChannel; currency: string; providerMerchantId: string | null; providerAppId: string | null; paymentNo: string; providerTransactionId: string | null };
}, payload: Record<string, unknown>, amountCents: number, providerRefundId: string | null) {
  assertNewExecutionOwner(refund);
  const intent = refund.paymentIntent;
  assertNewExecutionOwner(intent);
  assertProviderResultIdentity(intent, payload, true);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents !== refund.amountCents) throw new BadRequestException("退款金额不一致");
  if (!providerRefundId || (refund.providerRefundId && refund.providerRefundId !== providerRefundId)) throw new BadRequestException("渠道退款编号不匹配");
  if (intent.channel === PaymentChannel.APPLE_IAP) return; // Verified signed Apple transaction is checked before this method.
  if (String(payload.out_trade_no ?? "") !== intent.paymentNo) throw new BadRequestException("退款原支付编号不匹配");
  const transactionId = String(intent.channel.startsWith("WECHAT") ? payload.transaction_id ?? "" : payload.trade_no ?? "");
  if (!transactionId || !intent.providerTransactionId || transactionId !== intent.providerTransactionId) throw new BadRequestException("退款原渠道交易不匹配");
  if (intent.channel.startsWith("WECHAT") && String(payload.out_refund_no ?? "") !== refund.refundNo) throw new BadRequestException("渠道退款请求编号不匹配");
  if (intent.channel.startsWith("WECHAT") && payload.refund_status !== undefined && intent.providerMerchantId && payload.mchid !== intent.providerMerchantId) throw new BadRequestException("微信退款回执商户不匹配");
  if (payload.out_request_no !== undefined && String(payload.out_request_no) !== refund.refundNo) throw new BadRequestException("渠道退款请求编号不匹配");
  if (payload.refund_currency && payload.refund_currency !== intent.currency) throw new BadRequestException("渠道退款币种不匹配");
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
