import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, PaymentChannel } from "@prisma/client";
import QRCode from "qrcode";
import { PrismaService } from "../common/prisma.service";
import { safeObject, isUuid } from "../common/crypto";
import { env, envBoolean } from "../common/environment";
import { BillingService } from "../billing/billing.service";
import {
  partnerPage,
  partnerNumber,
  partnerRequestKey,
} from "./partner-commerce.service";
import { PARTNER_MAX_CENTS } from "./partner-ledger";
import { canReadPartnerHealth } from "./partner-health-policy";
import { normalizedPartnerCode } from "./partner-registration";

@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  async me(partnerId: string) {
    const partner = await this.prisma.brandPartner.findFirst({
      where: { id: partnerId, active: true },
      select: {
        id: true,
        partnerNo: true,
        username: true,
        name: true,
        mobile: true,
        active: true,
        level: { select: { id: true, name: true, code: true, active: true } },
        wallet: true,
      },
    });
    if (!partner) throw new NotFoundException("品牌伙伴账户不存在");
    return {
      ...partner,
      canViewMemberHealth: canReadPartnerHealth(partner),
      preview:
        env("NODE_ENV", "development") !== "production" &&
        envBoolean("LOCAL_PARTNER_PREVIEW", false),
    };
  }

  async overview(partnerId: string) {
    const [profile, members, orders, spent] = await Promise.all([
      this.me(partnerId),
      this.prisma.user.count({
        where: { partnerId, status: { not: "DELETED" } },
      }),
      this.prisma.commerceOrder.count({ where: { partnerId } }),
      this.prisma.partnerLedger.aggregate({
        where: { partnerId, account: "BALANCE", type: "PURCHASE" },
        _sum: { deltaCents: true },
      }),
    ]);
    return {
      ...profile,
      memberCount: members,
      orderCount: orders,
      purchaseCents: -(spent._sum.deltaCents ?? 0),
    };
  }

  async publicPromotion(codeInput: unknown) {
    const promotionCode = normalizedPartnerCode(codeInput);
    if (!promotionCode) throw new NotFoundException("推广链接不存在");
    const partner = await this.prisma.brandPartner.findFirst({
      where: { promotionCode, active: true },
      select: { name: true, promotionCode: true },
    });
    if (!partner) throw new NotFoundException("品牌伙伴推广链接已失效");
    return {
      name: partner.name,
      partnerCode: partner.promotionCode,
      noticeVersion: "partner-service-v1",
      notice: `通过此链接注册后，所属品牌伙伴「${partner.name}」可查看您的会员资料、设备及连接记录，用于提供服务；仅战略合作伙伴可查看健康档案、测量记录及健康报告。`,
    };
  }

  async promotion(partnerId: string) {
    const partner = await this.prisma.brandPartner.findUnique({
      where: { id: partnerId },
      select: {
        name: true,
        partnerNo: true,
        promotionCode: true,
        active: true,
      },
    });
    if (!partner) throw new NotFoundException("品牌伙伴不存在");
    const storefront = env(
      "COMMERCE_STOREFRONT_URL",
      env(
        "STOREFRONT_URL",
        `${env("PUBLIC_BASE_URL", "http://localhost:3301")}/saidian-mall/`,
      ),
    );
    const link = new URL(storefront);
    link.searchParams.set("partner", partner.promotionCode);
    link.hash = "/pages/login/index";
    return {
      ...partner,
      linkUrl: link.toString(),
      qrDataUrl: await QRCode.toDataURL(link.toString(), {
        width: 360,
        margin: 2,
      }),
    };
  }

  private certificateData(partner: {
    name: string;
    partnerNo: string;
    active: boolean;
    createdAt: Date;
    level: { name: string; active: boolean };
  }) {
    return {
      issuer: "赛电",
      partnerName: partner.name,
      certificateNo: partner.partnerNo,
      level: partner.level.name,
      active: partner.active && partner.level.active,
      registeredAt: partner.createdAt,
      generatedAt: new Date(),
      scope: "赛电品牌产品推广与采购",
      validity: "随合作账户启用状态有效",
    };
  }

  async certificate(partnerId: string) {
    const partner = await this.prisma.brandPartner.findFirst({
      where: { id: partnerId, active: true },
      select: {
        name: true,
        partnerNo: true,
        active: true,
        createdAt: true,
        promotionCode: true,
        level: { select: { name: true, active: true } },
      },
    });
    if (!partner) throw new NotFoundException("品牌伙伴账户不存在");
    const base = new URL(env("PUBLIC_BASE_URL", "http://localhost:3301"));
    const verifyUrl = new URL(
      `/vip/certificate/verify/${encodeURIComponent(partner.promotionCode)}`,
      base,
    ).toString();
    return {
      ...this.certificateData(partner),
      verifyUrl,
      qrDataUrl: await QRCode.toDataURL(verifyUrl, { width: 180, margin: 1 }),
    };
  }

  async publicCertificate(codeInput: unknown) {
    const promotionCode = normalizedPartnerCode(codeInput);
    if (!promotionCode) throw new NotFoundException("授权证书不存在");
    const partner = await this.prisma.brandPartner.findUnique({
      where: { promotionCode },
      select: {
        name: true,
        partnerNo: true,
        active: true,
        createdAt: true,
        level: { select: { name: true, active: true } },
      },
    });
    if (!partner) throw new NotFoundException("授权证书不存在");
    return this.certificateData(partner);
  }

  paymentCapabilities(partnerId?: string) {
    return this.billing.partnerPaymentCapabilities(partnerId);
  }

  async wallet(partnerId: string) {
    const wallet = await this.prisma.partnerWallet.findUnique({
      where: { partnerId },
    });
    if (!wallet) throw new NotFoundException("资金账户不存在");
    return { ...wallet, currency: "CNY" };
  }

  async ledger(partnerId: string, accountInput: string, pageInput: unknown) {
    if (accountInput && !["BALANCE", "DEPOSIT"].includes(accountInput))
      throw new BadRequestException("资金账户类型不正确");
    const { page, pageSize, skip } = partnerPage(pageInput),
      where = { partnerId, ...(accountInput ? { account: accountInput } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.partnerLedger.findMany({
        where,
        select: {
          id: true,
          account: true,
          type: true,
          deltaCents: true,
          balanceAfterCents: true,
          referenceId: true,
          reason: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.partnerLedger.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async recharges(partnerId: string, pageInput: unknown) {
    const { page, pageSize, skip } = partnerPage(pageInput),
      where = { partnerId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.partnerRecharge.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
      }),
      this.prisma.partnerRecharge.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async recharge(partnerId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException("充值记录不存在");
    const recharge = await this.prisma.partnerRecharge.findFirst({
      where: { id, partnerId },
    });
    if (!recharge) throw new NotFoundException("充值记录不存在");
    const payment = await this.prisma.paymentIntent.findFirst({
      where: { partnerRechargeId: id, partnerId },
      select: { id: true },
    });
    const result = payment
      ? await this.billing.partnerPayment(partnerId, payment.id)
      : null;
    return {
      ...(await this.prisma.partnerRecharge.findFirstOrThrow({
        where: { id, partnerId },
      })),
      payment: result,
    };
  }

  async createRecharge(partnerId: string, input: unknown, clientIp?: string, userAgent?: string) {
    const body = safeObject(input),
      amountCents = Number(body.amountCents),
      channel = String(body.channel ?? "").toUpperCase() as PaymentChannel;
    const key = `partner-recharge-request:${partnerId}:${partnerRequestKey(body.idempotencyKey)}`;
    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > PARTNER_MAX_CENTS ||
      !(
        [
          PaymentChannel.WECHAT_NATIVE,
          PaymentChannel.WECHAT_JSAPI,
          PaymentChannel.WECHAT_H5,
          PaymentChannel.ALIPAY_PAGE,
          PaymentChannel.ALIPAY_WAP,
        ] as PaymentChannel[]
      ).includes(channel)
    )
      throw new BadRequestException("充值金额或支付方式不正确");
    const recharge = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const existing = await tx.partnerRecharge.findUnique({
        where: { idempotencyKey: key },
      });
      if (existing) {
        if (
          existing.partnerId !== partnerId ||
          existing.amountCents !== amountCents ||
          existing.channel !== channel
        )
          throw new ConflictException("充值请求编号已被不同参数使用");
        return existing;
      }
      if (userAgent) {
        const allowed = /micromessenger/i.test(userAgent) ? ["WECHAT_JSAPI"] : /Android|iPhone|iPad|iPod/i.test(userAgent) ? ["WECHAT_H5", "ALIPAY_WAP"] : ["WECHAT_NATIVE", "ALIPAY_PAGE", "ALIPAY_WAP"];
        if (!allowed.includes(channel)) throw new BadRequestException("此支付方式不适合当前浏览器，请重新选择");
      }
      const partner = await tx.brandPartner.findFirst({
        where: { id: partnerId, active: true },
      });
      if (!partner) throw new NotFoundException("品牌伙伴账户不可用");
      return tx.partnerRecharge.create({
        data: {
          partnerId,
          rechargeNo: partnerNumber("RC"),
          amountCents,
          channel,
          idempotencyKey: key,
        },
      });
    });
    return {
      ...recharge,
      payment: await this.billing.createPartnerRechargePayment(
        partnerId,
        recharge.id,
        clientIp ? { clientIp } : {},
      ),
    };
  }

  rechargePayment(partnerId: string, id: string, clientIp?: string) {
    if (!isUuid(id)) throw new NotFoundException("充值记录不存在");
    return this.billing.createPartnerRechargePayment(
      partnerId,
      id,
      clientIp ? { clientIp } : {},
    );
  }
}
