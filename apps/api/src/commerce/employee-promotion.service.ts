import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  CouponGiftStatus,
  CouponStatus,
  IntegrationState,
  Prisma,
  RefundStatus,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { sign } from "jsonwebtoken";
import QRCode from "qrcode";
import { env } from "../common/environment";
import { randomToken, safeObject, sha256 } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";
import {
  isOwnPromoter,
  memberPromoterExternalId,
} from "../common/member-promoter-identity";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";
import { employeeDashboardQuery, type EmployeeDashboardQuery } from "./employee-dashboard-query";

type WeComSettings = {
  corpId: string;
  agentId: string;
  secret: string;
  storefrontUrl: string;
  allowedRedirectHosts: Set<string>;
};

@Injectable()
export class EmployeePromotionService {
  private cachedWeComToken?: { value: string; expiresAt: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
    private readonly withdrawals: CommerceWithdrawalService,
  ) {}

  async authorizeUrl(redirectUriInput: string) {
    const settings = await this.wecomSettings();
    const redirectUri = validateEmployeeRedirectUri(
      redirectUriInput,
      settings.allowedRedirectHosts,
      env("NODE_ENV", "development") === "production",
    );
    const state = randomBytes(12).toString("hex");
    return {
      url:
        "https://open.weixin.qq.com/connect/oauth2/authorize" +
        `?appid=${encodeURIComponent(settings.corpId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        "&response_type=code&scope=snsapi_base" +
        `&state=${state}#wechat_redirect`,
    };
  }

  async oauth(codeInput: string) {
    const code = codeInput.trim();
    if (!code) throw new BadRequestException("企业微信登录信息缺失，请重新进入");
    const token = await this.wecomAccessToken();
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${encodeURIComponent(token)}&code=${encodeURIComponent(code)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const result = safeObject(await response.json().catch(() => ({})));
    const wecomUserId = String(result.userid ?? result.UserId ?? "").trim();
    if (!response.ok || Number(result.errcode ?? -1) !== 0 || !wecomUserId) {
      throw new UnauthorizedException("企业微信身份识别失败，请重新进入");
    }
    const employee = await this.ensureEmployee(wecomUserId, token);
    await markIntegrationVerified(this.prisma, "wecom");
    const expiresIn = 12 * 60 * 60;
    const sessionToken = sign(
      { sub: employee.id, typ: "employee" },
      env("EMPLOYEE_TOKEN_SECRET", env("ACCESS_TOKEN_SECRET")),
      {
        algorithm: "HS256",
        expiresIn,
        issuer: "saydianapp-server",
        audience: "saydian-commerce-employee",
      },
    );
    return {
      token: sessionToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      employee: {
        id: employee.id,
        name: employee.name,
        avatarUrl: employee.avatarUrl,
        referralCode: employee.referralCode,
      },
    };
  }

  async dashboard(employeeId: string, query: EmployeeDashboardQuery = {}) {
    const filter = employeeDashboardQuery(query);
    const period = { gte: filter.start, lt: filter.end };
    const orderWhere = { referralEmployeeId: employeeId, createdAt: period };
    const [employee, paid, refunded, orders, total, plan, withdrawal, recentAccruals] = await Promise.all([
      this.prisma.commerceEmployee.findFirstOrThrow({
        where: { id: employeeId, active: true },
        select: { id: true, name: true, avatarUrl: true, referralCode: true, departmentNames: true },
      }),
      this.prisma.commerceOrder.aggregate({
        where: { referralEmployeeId: employeeId, paidAt: period },
        _count: true, _sum: { payableCents: true },
      }),
      this.prisma.paymentRefund.aggregate({
        where: { status: RefundStatus.SUCCEEDED, completedAt: period,
          paymentIntent: { commerceOrder: { is: { referralEmployeeId: employeeId } } } },
        _sum: { amountCents: true },
      }),
      this.prisma.commerceOrder.findMany({
        where: orderWhere,
        select: { id: true, orderNo: true, status: true, payableCents: true, paidAt: true, createdAt: true,
          user: { select: { nickname: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: filter.skip, take: filter.pageSize,
      }),
      this.prisma.commerceOrder.count({ where: orderWhere }),
      this.prisma.commerceCommissionPlan.findUnique({ where: { id: "default" } }),
      this.withdrawals.employeeSummary(employeeId),
      this.prisma.commerceCommissionAccrual.findMany({
        where: { employeeId, createdAt: period }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10,
      }),
    ]);
    let promotion: Awaited<ReturnType<EmployeePromotionService["promotion"]>> | null = null;
    try { promotion = await this.promotion(employeeId); }
    catch (error) { if (!(error instanceof ServiceUnavailableException)) throw error; }
    // Aggregate null means a verified empty result set, not missing imported balances.
    const salesCents = paid._sum.payableCents ?? 0;
    const refundCents = refunded._sum.amountCents ?? 0;
    return {
      employee, range: { key: filter.range, start: filter.start, end: filter.end, endExclusive: true, timezone: filter.timezone },
      paidOrders: paid._count, salesCents, refundCents, netSalesCents: salesCents - refundCents,
      metricBasis: { sales: "paidAt", refunds: "completedAt", orders: "createdAt" },
      trend: null, trendStatus: "UNAVAILABLE", trendReason: "当前接口尚未提供逐日汇总，不以空数组或随机趋势代替",
      orders, pagination: { page: filter.page, pageSize: filter.pageSize, total, hasMore: filter.skip + orders.length < total },
      promotion, promotionStatus: promotion ? "AVAILABLE" : "UNCONFIGURED",
      bonus: {
        plan: plan ? { enabled: plan.enabled, rateBps: plan.rateBps, settlementDays: plan.settlementDays,
          withdrawalEnabled: withdrawal.plan.enabled, minimumWithdrawCents: withdrawal.plan.minimumWithdrawCents,
          dailyWithdrawLimitCents: withdrawal.plan.dailyWithdrawLimitCents, reviewRequired: true } : null,
        wallet: withdrawal.wallet, walletStatus: withdrawal.wallet ? "AVAILABLE" : "UNAVAILABLE",
        recentAccruals, recentWithdrawals: withdrawal.withdrawals.slice(0, 20),
        withdrawal: { canApply: withdrawal.canApply, identity: withdrawal.identity, pendingCount: withdrawal.pendingCount,
          availableAmountCents: withdrawal.availableAmountCents, dailyUsedCents: withdrawal.dailyUsedCents,
          dailyRemainingCents: withdrawal.dailyRemainingCents, payoutMode: withdrawal.payoutMode },
      },
    };
  }

  async memberPromoter(userId: string) {
    const member = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        nickname: true,
        avatarUrl: true,
        mobile: true,
        mobileVerifiedAt: true,
      },
    });
    if (!member) throw new UnauthorizedException("会员登录已失效，请重新登录");

    const wecomUserId = memberPromoterExternalId(member.id);
    const name = member.nickname.trim() || "赛电会员";
    const mobile = member.mobileVerifiedAt ? member.mobile : null;
    const existing = await this.prisma.commerceEmployee.findUnique({
      where: { wecomUserId },
    });
    if (existing) {
      if (!existing.active) throw new UnauthorizedException("推广账户已停用");
      if (
        existing.name === name &&
        existing.mobile === mobile &&
        existing.avatarUrl === member.avatarUrl
      ) {
        return existing;
      }
      return this.prisma.commerceEmployee.update({
        where: { id: existing.id },
        data: {
          name,
          mobile,
          avatarUrl: member.avatarUrl,
        },
      });
    }

    const created = await this.prisma.commerceEmployee.upsert({
      where: { wecomUserId },
      create: {
        wecomUserId,
        name,
        mobile,
        avatarUrl: member.avatarUrl,
        departmentNames: [],
        referralCode: await this.uniqueReferralCode(),
      },
      update: {
        name,
        mobile,
        avatarUrl: member.avatarUrl,
      },
    });
    if (!created.active) throw new UnauthorizedException("推广账户已停用");
    return created;
  }

  async promotion(employeeId: string, productId?: string) {
    const [employee, storefrontUrl] = await Promise.all([
      this.prisma.commerceEmployee.findFirstOrThrow({
        where: { id: employeeId, active: true },
        select: { name: true, referralCode: true },
      }),
      this.storefrontBase(),
    ]);
    const base = storefrontUrl.replace(/\/+$/, "");
    const route = productId
      ? `/pages/product/index?id=${encodeURIComponent(productId)}`
      : "/pages/home/index";
    const linkUrl = `${base}/?ref=${encodeURIComponent(employee.referralCode)}#${route}`;
    const qrDataUrl = await QRCode.toDataURL(linkUrl, {
      width: 600,
      margin: 2,
      errorCorrectionLevel: "H",
    });
    return {
      referralCode: employee.referralCode,
      linkUrl,
      qrDataUrl,
      posterDataUrl: promotionPoster(employee.name, employee.referralCode, qrDataUrl),
      qrType: "H5" as const,
    };
  }

  async employeeCoupons(employeeId: string) {
    await this.expireGifts();
    const now = new Date();
    const coupons = await this.prisma.commerceCoupon.findMany({
      where: {
        employeeDistributable: true,
        status: CouponStatus.ACTIVE,
        validFrom: { lte: now },
        validUntil: { gte: now },
        OR: [{ employeeClaimUntil: null }, { employeeClaimUntil: { gte: now } }],
      },
      include: {
        employeeGrants: { where: { employeeId } },
        gifts: {
          where: { employeeId },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return coupons.map((coupon) => ({
      ...coupon,
      remainingEmployeeQuota: Math.max(
        0,
        coupon.perEmployeeLimit - (coupon.employeeGrants[0]?.allocatedQuantity ?? 0),
      ),
      gifts: coupon.gifts.map((gift) => ({
        id: gift.id,
        code: gift.code,
        status: gift.status,
        expiresAt: gift.expiresAt,
        linkUrl: null,
        qrDataUrl: null,
      })),
    }));
  }

  async claimCoupons(employeeId: string, couponId: string, quantityInput: unknown) {
    await this.expireGifts();
    const requestedInput = Number(quantityInput);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const [employee, coupon] = await Promise.all([
          tx.commerceEmployee.findFirst({ where: { id: employeeId, active: true } }),
          tx.commerceCoupon.findUnique({ where: { id: couponId } }),
        ]);
        const now = new Date();
        if (!employee) throw new UnauthorizedException("推广账户已停用");
        if (
          !coupon ||
          !coupon.employeeDistributable ||
          coupon.status !== CouponStatus.ACTIVE ||
          coupon.validFrom > now ||
          coupon.validUntil < now ||
          (coupon.employeeClaimUntil && coupon.employeeClaimUntil < now)
        ) {
          throw new BadRequestException("该优惠券暂不可领取");
        }
        const quantity = employeeCouponQuantity(
          requestedInput,
          coupon.employeeClaimBatchSize,
        );
        const grant = await tx.commerceEmployeeCouponGrant.upsert({
          where: { employeeId_couponId: { employeeId, couponId } },
          create: { employeeId, couponId },
          update: {},
        });
        if (grant.allocatedQuantity + quantity > coupon.perEmployeeLimit) {
          throw new BadRequestException("已达到推广领券上限");
        }
        if (
          coupon.totalQuantity !== null &&
          coupon.claimedQuantity + coupon.reservedGiftQuantity + quantity >
            coupon.totalQuantity
        ) {
          throw new BadRequestException("优惠券已领完");
        }
        await tx.commerceCoupon.update({
          where: { id: couponId },
          data: { reservedGiftQuantity: { increment: quantity } },
        });
        await tx.commerceEmployeeCouponGrant.update({
          where: { id: grant.id },
          data: { allocatedQuantity: { increment: quantity } },
        });
        const rows: Array<{ gift: { id: string; code: string; status: CouponGiftStatus; expiresAt: Date }; token: string }> = [];
        for (let index = 0; index < quantity; index += 1) {
          const token = randomToken();
          const gift = await tx.commerceCouponGift.create({
            data: {
              tokenHash: sha256(token),
              code: randomBytes(8).toString("hex").toUpperCase(),
              couponId,
              employeeId,
              grantId: grant.id,
              expiresAt: coupon.validUntil,
            },
          });
          rows.push({ gift, token });
        }
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return Promise.all(
      created.map(({ gift, token }) => this.presentNewGift(gift, token)),
    );
  }

  async gift(tokenInput: string) {
    await this.expireGifts();
    const token = tokenInput.trim();
    if (!token) throw new NotFoundException("优惠券不存在");
    const gift = await this.prisma.commerceCouponGift.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        coupon: true,
        employee: { select: { name: true, referralCode: true } },
      },
    });
    if (!gift) throw new NotFoundException("优惠券不存在");
    return {
      id: gift.id,
      status: gift.status,
      expiresAt: gift.expiresAt,
      coupon: gift.coupon,
      employee: gift.employee,
    };
  }

  async redeemGift(userId: string, tokenInput: string) {
    await this.expireGifts();
    const token = tokenInput.trim();
    if (!token) throw new BadRequestException("优惠券链接无效");
    return this.prisma.$transaction(
      async (tx) => {
        const gift = await tx.commerceCouponGift.findUnique({
          where: { tokenHash: sha256(token) },
          include: {
            coupon: true,
            employee: { select: { wecomUserId: true, mobile: true } },
          },
        });
        const now = new Date();
        if (
          !gift ||
          gift.status !== CouponGiftStatus.RESERVED ||
          gift.expiresAt < now ||
          gift.coupon.status !== CouponStatus.ACTIVE ||
          gift.coupon.validFrom > now ||
          gift.coupon.validUntil < now
        ) {
          throw new BadRequestException("优惠券已领取或已失效");
        }
        const existing = await tx.commerceCouponClaim.findUnique({
          where: { couponId_userId: { couponId: gift.couponId, userId } },
        });
        if (existing) throw new BadRequestException("您已领取过该优惠券");
        const changed = await tx.commerceCouponGift.updateMany({
          where: {
            id: gift.id,
            status: CouponGiftStatus.RESERVED,
            expiresAt: { gte: now },
          },
          data: {
            status: CouponGiftStatus.CLAIMED,
            redeemedByUserId: userId,
            redeemedAt: now,
          },
        });
        if (changed.count !== 1) throw new BadRequestException("优惠券已被领取");
        const claim = await tx.commerceCouponClaim.create({
          data: {
            couponId: gift.couponId,
            userId,
            sourceEmployeeId: gift.employeeId,
            sourceGiftId: gift.id,
          },
        });
        const member = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, mobile: true, mobileVerifiedAt: true },
        });
        await Promise.all([
          tx.commerceCoupon.update({
            where: { id: gift.couponId },
            data: {
              reservedGiftQuantity: { decrement: 1 },
              claimedQuantity: { increment: 1 },
            },
          }),
          tx.commerceEmployeeCouponGrant.update({
            where: { id: gift.grantId },
            data: { redeemedQuantity: { increment: 1 } },
          }),
          ...(member && !isOwnPromoter(member, gift.employee)
            ? [
                tx.user.updateMany({
                  where: { id: userId, referralEmployeeId: null },
                  data: { referralEmployeeId: gift.employeeId },
                }),
              ]
            : []),
        ]);
        return claim;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async presentNewGift(
    gift: { id: string; code: string; status: CouponGiftStatus; expiresAt: Date },
    token: string,
  ) {
    const base = (await this.storefrontBase()).replace(/\/+$/, "");
    const linkUrl = `${base}/#/pages/coupon-gift/index?token=${encodeURIComponent(token)}`;
    return {
      id: gift.id,
      code: gift.code,
      status: gift.status,
      expiresAt: gift.expiresAt,
      linkUrl,
      qrDataUrl: await QRCode.toDataURL(linkUrl, { width: 500, margin: 2 }),
    };
  }

  private async expireGifts() {
    const rows = await this.prisma.commerceCouponGift.findMany({
      where: { status: CouponGiftStatus.RESERVED, expiresAt: { lt: new Date() } },
      select: { id: true, couponId: true, grantId: true },
      take: 500,
    });
    for (const gift of rows) {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.commerceCouponGift.updateMany({
          where: { id: gift.id, status: CouponGiftStatus.RESERVED },
          data: { status: CouponGiftStatus.EXPIRED },
        });
        if (!changed.count) return;
        await Promise.all([
          tx.commerceCoupon.update({
            where: { id: gift.couponId },
            data: { reservedGiftQuantity: { decrement: 1 } },
          }),
          tx.commerceEmployeeCouponGrant.update({
            where: { id: gift.grantId },
            data: { allocatedQuantity: { decrement: 1 } },
          }),
        ]);
      });
    }
  }

  private async ensureEmployee(wecomUserId: string, token: string) {
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(wecomUserId)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const result = safeObject(await response.json().catch(() => ({})));
    if (!response.ok || Number(result.errcode ?? -1) !== 0) {
      throw new UnauthorizedException("未找到可用的企业微信员工账号");
    }
    const existing = await this.prisma.commerceEmployee.findUnique({
      where: { wecomUserId },
    });
    const mobile = optionalString(result.mobile);
    return this.prisma.commerceEmployee.upsert({
      where: { wecomUserId },
      create: {
        wecomUserId,
        name: String(result.name ?? wecomUserId),
        mobile,
        avatarUrl: optionalString(result.avatar),
        departmentNames: Array.isArray(result.department)
          ? result.department.map(String)
          : [],
        referralCode: await this.uniqueReferralCode(),
      },
      update: {
        name: String(result.name ?? existing?.name ?? wecomUserId),
        mobile,
        avatarUrl: optionalString(result.avatar),
        departmentNames: Array.isArray(result.department)
          ? result.department.map(String)
          : existing?.departmentNames ?? [],
        active: true,
      },
    });
  }

  private async uniqueReferralCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const referralCode = randomBytes(5).toString("hex").toUpperCase();
      const exists = await this.prisma.commerceEmployee.findUnique({
        where: { referralCode },
        select: { id: true },
      });
      if (!exists) return referralCode;
    }
    throw new ServiceUnavailableException("暂时无法生成推荐号，请稍后重试");
  }

  private async wecomAccessToken() {
    if (
      this.cachedWeComToken &&
      this.cachedWeComToken.expiresAt > Date.now() + 60_000
    ) {
      return this.cachedWeComToken.value;
    }
    const settings = await this.wecomSettings();
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(settings.corpId)}&corpsecret=${encodeURIComponent(settings.secret)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const result = safeObject(await response.json().catch(() => ({})));
    const value = String(result.access_token ?? "").trim();
    if (!response.ok || Number(result.errcode ?? -1) !== 0 || !value) {
      await this.prisma.integrationConfig.updateMany({
        where: { key: "wecom" },
        data: {
          state: IntegrationState.ERROR,
          lastCheckedAt: new Date(),
          lastError: `token:${String(result.errcode ?? response.status)}`.slice(0, 300),
        },
      });
      throw new ServiceUnavailableException("企业微信登录暂时无法使用，请稍后再试");
    }
    this.cachedWeComToken = {
      value,
      expiresAt: Date.now() + Math.max(60, Number(result.expires_in ?? 7200) - 300) * 1000,
    };
    await this.prisma.integrationConfig.updateMany({
      where: { key: "wecom" },
      data: { lastCheckedAt: new Date(), lastError: null },
    });
    return value;
  }

  // Generating a local share link is not an enterprise-WeChat provider call.
  // OAuth itself still uses wecomSettings and remains unavailable without credentials.
  private async storefrontBase() {
    const config = await this.prisma.integrationConfig.findUnique({ where: { key: "wecom" } });
    const configured = env("COMMERCE_STOREFRONT_URL", String(safeObject(config?.publicConfig).storefrontUrl ?? "")).replace(/#.*$/, "");
    try {
      const url = new URL(configured);
      const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
      if (url.username || url.password || url.search || (url.protocol !== "https:" && !(env("NODE_ENV", "development") !== "production" && local && url.protocol === "http:"))) throw new Error();
      return url.toString().replace(/\/+$/, "");
    } catch { throw new ServiceUnavailableException("商城推广地址尚未配置"); }
  }

  private async wecomSettings(): Promise<WeComSettings> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "wecom" },
    });
    if (!integration || integration.state !== IntegrationState.CONFIGURED) {
      throw new ServiceUnavailableException("企业微信登录暂时无法使用，请稍后再试");
    }
    const publicConfig = safeObject(integration.publicConfig);
    const secrets = await this.integrationSecrets.resolve("wecom", {
      corpId: "WECOM_CORP_ID",
      agentId: "WECOM_AGENT_ID",
      secret: "WECOM_SECRET",
    });
    const corpId = secrets.corpId ?? String(publicConfig.corpId ?? "");
    const agentId = secrets.agentId ?? String(publicConfig.agentId ?? "");
    const secret = secrets.secret ?? "";
    const storefrontUrl = env(
      "COMMERCE_STOREFRONT_URL",
      String(publicConfig.storefrontUrl ?? ""),
    ).replace(/#.*$/, "");
    if (!corpId || !agentId || !secret || !storefrontUrl) {
      throw new ServiceUnavailableException("企业微信登录暂时无法使用，请稍后再试");
    }
    let storefrontHost: string;
    try {
      storefrontHost = new URL(storefrontUrl).hostname.toLowerCase();
    } catch {
      throw new ServiceUnavailableException("企业微信登录暂时无法使用，请稍后再试");
    }
    const configuredHosts = Array.isArray(publicConfig.allowedRedirectHosts)
      ? publicConfig.allowedRedirectHosts.map(String)
      : [];
    const allowedRedirectHosts = new Set(
      [
        storefrontHost,
        ...configuredHosts,
        ...env("WECOM_ALLOWED_REDIRECT_HOSTS", "").split(","),
        ...(env("NODE_ENV", "development") === "production"
          ? []
          : ["localhost", "127.0.0.1"]),
      ]
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    return { corpId, agentId, secret, storefrontUrl, allowedRedirectHosts };
  }

}

export function validateEmployeeRedirectUri(
  input: string,
  allowedHosts: Set<string>,
  production: boolean,
) {
  let uri: URL;
  try {
    uri = new URL(input);
  } catch {
    throw new BadRequestException("企业微信回调地址不正确");
  }
  if (
    (production && uri.protocol !== "https:") ||
    (!production && !["http:", "https:"].includes(uri.protocol))
  ) {
    throw new BadRequestException("企业微信回调地址不正确");
  }
  if (!allowedHosts.has(uri.hostname.toLowerCase())) {
    throw new BadRequestException("企业微信回调地址不在允许范围内");
  }
  return uri.toString();
}

export function employeeCouponQuantity(input: unknown, batchSize: number) {
  const requested = Number(input);
  return Math.max(
    1,
    Math.min(
      Math.max(1, batchSize),
      Number.isFinite(requested) ? Math.floor(requested) : 1,
    ),
  );
}

function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function promotionPoster(name: string, referralCode: string, qrDataUrl: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="1120" viewBox="0 0 750 1120"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#153f39"/><stop offset="1" stop-color="#287d6c"/></linearGradient></defs><rect width="750" height="1120" rx="36" fill="url(#b)"/><text x="72" y="130" fill="#fff" font-size="50" font-weight="700">赛电智能健康生活</text><text x="72" y="190" fill="#d8eee8" font-size="28">官方商城 · 正品服务 · 售后可查</text><rect x="72" y="280" width="606" height="690" rx="34" fill="#fff"/><text x="375" y="370" text-anchor="middle" fill="#183f38" font-size="30" font-weight="700">${escapeXml(name)} 为您推荐</text><image href="${qrDataUrl}" x="145" y="430" width="460" height="460"/><text x="375" y="930" text-anchor="middle" fill="#6e7e7a" font-size="24">微信扫码进入赛电商城</text><text x="375" y="1035" text-anchor="middle" fill="#d6ece6" font-size="24">推荐号 ${escapeXml(referralCode)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}
