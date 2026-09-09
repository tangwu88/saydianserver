import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { IntegrationState, Prisma, UserStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { AuthService } from "./auth.service";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { normalizedMobile, safeObject, secureEqual, sha256 } from "../common/crypto";
import { env } from "../common/environment";
import { markIntegrationVerified } from "../common/integration-health";

const lifetimeSeconds = 5 * 60;
type OfficialConfig = { appId: string; appSecret: string; redirectUri: string };

// Scoped official-account identity. Never reads/writes the mini-program openId.
@Injectable()
export class WechatH5AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly secrets: IntegrationSecretsService,
  ) {}

  async configured(): Promise<OfficialConfig> {
    const config = await this.prisma.integrationConfig.findUnique({ where: { key: "wechat_official" } });
    if (config?.state !== IntegrationState.CONFIGURED) throw unavailable();
    const secret = await this.secrets.resolve("wechat_official", {
      appId: "WECHAT_OFFICIAL_APP_ID", appSecret: "WECHAT_OFFICIAL_APP_SECRET",
    });
    const publicConfig = safeObject(config.publicConfig);
    const appId = (secret.appId ?? String(publicConfig.appId ?? "")).trim();
    const appSecret = (secret.appSecret ?? "").trim();
    if (!/^wx[A-Za-z0-9]{8,64}$/.test(appId) || appSecret.length < 16) throw unavailable();
    const redirectUri = officialRedirectUri(
      String(publicConfig.redirectUri ?? env("WECHAT_OFFICIAL_REDIRECT_URI", "")),
      env("COMMERCE_STOREFRONT_URL", ""),
    );
    return { appId, appSecret, redirectUri };
  }

  async authorize(input: { returnTo: string; codeChallenge: string; referralCode?: string }) {
    const returnTo = safeH5ReturnTo(input.returnTo);
    if (!/^[a-f0-9]{64}$/.test(input.codeChallenge)) throw new BadRequestException("授权校验参数不正确");
    const config = await this.configured();
    const state = randomBytes(32).toString("hex");
    await this.prisma.commerceOAuthState.create({ data: {
      stateHash: sha256(state), codeChallenge: input.codeChallenge, appId: config.appId,
      returnTo, referralCode: boundedReferral(input.referralCode),
      expiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
    } });
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.search = new URLSearchParams({
      appid: config.appId, redirect_uri: config.redirectUri, response_type: "code",
      scope: "snsapi_base", state,
    }).toString();
    url.hash = "wechat_redirect";
    return { authorizeUrl: url.toString(), state, expiresIn: lifetimeSeconds };
  }

  async login(input: { code: string; state: string; codeVerifier: string; consentVersion: string }) {
    assertConsent(input.consentVersion);
    if (!/^[a-f0-9]{64}$/.test(input.state) || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier) ||
        !input.code || input.code.length > 1024 || /\s/.test(input.code)) throw expired();
    const state = await this.prisma.commerceOAuthState.findUnique({ where: { stateHash: sha256(input.state) } });
    if (!state || state.consumedAt || state.expiresAt <= new Date() ||
        !secureEqual(state.codeChallenge, sha256(input.codeVerifier))) throw expired();
    const config = await this.configured();
    if (state.appId !== config.appId) throw expired();
    // Claim before outbound: a network timeout requires a fresh authorization.
    const claimed = await this.prisma.commerceOAuthState.updateMany({
      where: { stateHash: state.stateHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (claimed.count !== 1) throw expired();
    const identity = await this.exchange(config, input.code);
    const linked = await this.prisma.wechatOfficialIdentity.findUnique({
      where: { appId_openId: { appId: config.appId, openId: identity.openId } }, include: { user: true },
    });
    if (linked && linked.user.status !== UserStatus.ACTIVE) {
      throw new ConflictException("该账号不可登录，请联系客服处理");
    }
    if (linked?.user.mobile && linked.user.mobileVerifiedAt) {
      await this.prisma.$transaction(tx => consent(tx, linked.userId, input.consentVersion));
      if (state.referralCode) await this.auth.bindReferral(linked.userId, state.referralCode);
      return { ...(await this.auth.issueMallSession(linked.userId)), requiresMobileBinding: false as const, returnTo: state.returnTo };
    }
    // No consumer session exists until a phone has actually been verified.
    const bindTicket = randomBytes(32).toString("hex");
    await this.prisma.commerceWechatBindTicket.create({ data: {
      tokenHash: sha256(bindTicket), appId: config.appId, openId: identity.openId, unionId: identity.unionId,
      returnTo: state.returnTo, referralCode: state.referralCode,
      expiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
    } });
    return { requiresMobileBinding: true as const, bindTicket, expiresIn: lifetimeSeconds, returnTo: state.returnTo };
  }

  async bindMobile(input: { bindTicket: string; mobile: string; code: string; consentVersion: string }) {
    assertConsent(input.consentVersion);
    const mobile = normalizedMobile(input.mobile);
    if (!mobile || !/^[a-f0-9]{64}$/.test(input.bindTicket)) throw new BadRequestException("绑定参数不正确");
    const ticket = await this.prisma.commerceWechatBindTicket.findUnique({ where: { tokenHash: sha256(input.bindTicket) } });
    if (!ticket || ticket.consumedAt || ticket.expiresAt <= new Date()) throw expired();
    const config = await this.configured();
    if (ticket.appId !== config.appId) throw expired();
    // This code has a distinct usage and cannot reuse an SMS-login code.
    // Failure below consumes the OTP but does not change either identity.
    await this.auth.consumeMobileBindingCode(mobile, input.code);
    const user = await this.prisma.$transaction(async tx => {
      for (const key of [`h5-phone:${mobile}`, `h5-openid:${ticket.appId}:${ticket.openId}`].sort()) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      }
      const linked = await tx.wechatOfficialIdentity.findUnique({
        where: { appId_openId: { appId: ticket.appId, openId: ticket.openId } }, include: { user: true },
      });
      const existing = await tx.user.findUnique({ where: { mobile } });
      if ((linked && linked.user.status !== UserStatus.ACTIVE) || (existing && existing.status !== UserStatus.ACTIVE)) {
        throw new ConflictException("该账号不可绑定，请联系客服处理");
      }
      if (linked && ((existing && existing.id !== linked.userId) || (linked.user.mobile && linked.user.mobile !== mobile))) {
        throw new ConflictException("该微信与手机号属于不同账号，不会自动合并，请联系客服处理");
      }
      const userId = linked?.userId ?? existing?.id;
      if (userId) {
        const other = await tx.wechatOfficialIdentity.findUnique({ where: { userId_appId: { userId, appId: ticket.appId } } });
        if (other && other.openId !== ticket.openId) throw new ConflictException("该手机号已关联另一个公众号身份，请先核验");
      }
      const claimed = await tx.commerceWechatBindTicket.updateMany({
        where: { tokenHash: ticket.tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) throw expired();
      const saved = userId
        ? await tx.user.update({ where: { id: userId }, data: { mobile, mobileVerifiedAt: new Date() } })
        : await tx.user.create({ data: { mobile, mobileVerifiedAt: new Date(), nickname: `用户${mobile.slice(-4)}` } });
      if (!linked) {
        await tx.wechatOfficialIdentity.create({ data: {
          userId: saved.id, appId: ticket.appId, openId: ticket.openId, unionId: ticket.unionId, verifiedAt: new Date(),
        } });
      }
      await consent(tx, saved.id, input.consentVersion);
      if (ticket.referralCode && !saved.referralEmployeeId) {
        const employee = await tx.commerceEmployee.findFirst({ where: { referralCode: ticket.referralCode, active: true } });
        if (employee) await tx.user.updateMany({ where: { id: saved.id, referralEmployeeId: null }, data: { referralEmployeeId: employee.id } });
      }
      return saved;
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("账号关联发生并发冲突，请重新验证手机号，不会自动覆盖账号");
      }
      throw error;
    });
    return { ...(await this.auth.issueMallSession(user.id)), requiresMobileBinding: false as const, returnTo: ticket.returnTo };
  }

  private async exchange(config: OfficialConfig, code: string) {
    const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
    url.search = new URLSearchParams({ appid: config.appId, secret: config.appSecret, code, grant_type: "authorization_code" }).toString();
    let payload: Record<string, unknown>;
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
      if (!response.ok) throw unavailable();
      payload = safeObject(await response.json());
    } catch { throw unavailable(); }
    if ([40029, 40163, 42001].includes(Number(payload.errcode))) throw expired();
    const openId = providerIdentifier(payload.openid);
    if (Number(payload.errcode ?? 0) || !openId || typeof payload.access_token !== "string" || !payload.access_token ||
        typeof payload.scope !== "string" || !payload.scope.split(",").includes("snsapi_base")) throw unavailable();
    await markIntegrationVerified(this.prisma, "wechat_official");
    // Token and secret deliberately never persisted or returned. unionId is
    // metadata only: an unscoped legacy unionId must not silently merge Users.
    return { openId, unionId: providerIdentifier(payload.unionid) };
  }
}

async function consent(tx: Prisma.TransactionClient, userId: string, version: string) {
  for (const documentType of ["user_agreement", "privacy_policy"]) {
    await tx.consentRecord.upsert({
      where: { userId_documentType_version: { userId, documentType, version } },
      create: { userId, documentType, version, source: "commerce_wechat_h5" },
      update: { withdrawnAt: null, source: "commerce_wechat_h5" },
    });
  }
}

function assertConsent(version: string) {
  if (!version.trim() || version.length > 80) throw new BadRequestException("请先阅读并同意用户协议与隐私政策");
}
function boundedReferral(value?: string) {
  const text = value?.trim() ?? "";
  if (text.length > 128 || /[\s\u0000-\u001f]/.test(text)) throw new BadRequestException("推广码格式不正确");
  return text || null;
}
function providerIdentifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,128}$/.test(value) ? value : null;
}
function expired() { return new UnauthorizedException("微信授权已失效，请重新授权"); }
function unavailable() { return new ServiceUnavailableException("微信公众号登录未配置或暂时不可用"); }

export function safeH5ReturnTo(value: string): string {
  const path = value.trim() || "/";
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { throw new BadRequestException("返回地址不正确"); }
  if (path.length > 1024 || !decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded) ||
      /%(?:2f|5c|0[0-9a-f]|1[0-9a-f])/i.test(decoded)) throw new BadRequestException("返回地址不正确");
  const url = new URL(path, "https://h5.invalid");
  if (url.origin !== "https://h5.invalid" || url.pathname.startsWith("//") || url.hash || ["code", "state", "token", "access_token", "refreshToken"].some(key => url.searchParams.has(key))) {
    throw new BadRequestException("返回地址不正确");
  }
  return `${url.pathname}${url.search}`;
}

export function officialRedirectUri(value: string, storefront: string): string {
  try {
    const url = new URL(value);
    const expected = new URL(storefront);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== expected.origin || url.username || url.password || url.hash || url.search ||
        (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:"))) throw unavailable();
    return url.toString();
  } catch { throw unavailable(); }
}
