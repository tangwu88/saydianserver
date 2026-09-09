import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { hash } from "bcryptjs";
import { IntegrationState, PaymentChannel } from "@prisma/client";
import { sha256 } from "../common/crypto";
import { AuthService } from "./auth.service";
import { WechatH5AuthService, officialRedirectUri, safeH5ReturnTo } from "./wechat-h5-auth.service";
import { CommerceCapabilitiesService } from "../commerce/commerce-capabilities.service";
import { PaymentProviderService, trustedPaymentUrl, commercePaymentReturnUrl } from "../billing/payment-provider.service";

const verifier = "v".repeat(64);
const stateText = "a".repeat(64);
const bindTicket = "b".repeat(64);
const mobile = "19900001234";
const config = { appId: "wx1234567890abcdef", appSecret: "synthetic-test-only-secret", redirectUri: "https://demo.invalid/login" };
const future = () => new Date(Date.now() + 60_000);
function harness() {
  const state = { stateHash: sha256(stateText), codeChallenge: sha256(verifier), appId: config.appId,
    returnTo: "/checkout", referralCode: null, expiresAt: future(), consumedAt: null as Date | null };
  const ticket = { tokenHash: sha256(bindTicket), appId: config.appId, openId: "official-openid-1",
    unionId: null, returnTo: "/checkout", referralCode: null, expiresAt: future(), consumedAt: null as Date | null };
  const user = { id: "user-1", mobile, status: "ACTIVE", mobileVerifiedAt: new Date(), referralEmployeeId: null };
  const db = {
    commerceOAuthState: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(state), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commerceWechatBindTicket: { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(ticket), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    wechatOfficialIdentity: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue(user), update: vi.fn().mockResolvedValue(user), updateMany: vi.fn(), create: vi.fn().mockResolvedValue(user) },
    consentRecord: { upsert: vi.fn() }, commerceEmployee: { findFirst: vi.fn() },
    integrationConfig: { updateMany: vi.fn(), findUnique: vi.fn().mockResolvedValue({ state: IntegrationState.UNCONFIGURED }) },
    $queryRaw: vi.fn(),
  };
  const prisma = { ...db, $transaction: vi.fn(async (work: (tx: typeof db) => unknown) => work(db)) };
  const session = { token: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: future().toISOString(), user: { id: user.id, mobile } };
  const auth = { issueMallSession: vi.fn().mockResolvedValue(session), consumeMobileBindingCode: vi.fn(), bindReferral: vi.fn() };
  const service = new WechatH5AuthService(prisma as any, auth as any, { resolve: vi.fn() } as any);
  vi.spyOn(service, "configured").mockResolvedValue(config);
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    openid: ticket.openId, access_token: "synthetic-provider-token", scope: "snsapi_base",
  })));
  vi.stubGlobal("fetch", fetchMock);
  return { service, db, prisma, auth, state, ticket, user, session, fetchMock };
}
const loginInput = () => ({ code: "synthetic-code", state: stateText, codeVerifier: verifier, consentVersion: "commerce-legal-v1" });
const bindInput = () => ({ bindTicket, mobile, code: "123456", consentVersion: "commerce-legal-v1" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("official-account H5 contract", () => {
  it("password login reuses Auth and returns the unchanged raw mall shape", async () => {
    const lookup = vi.fn().mockResolvedValue({ id: "existing-user-id", mobile, status: "ACTIVE", mobileVerifiedAt: new Date(), passwordHash: await hash("synthetic-password", 12) });
    const service = new AuthService({ user: { findUnique: lookup } } as any,
      {} as any, {} as any, {} as any);
    const session = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: future().toISOString(),
      member: { id: "existing-user-id", nickname: "客户", gender: "unspecified" as const, mobileMasked: "199****1234" } };
    const issuance = vi.spyOn(service as any, "issueSession").mockResolvedValue(session);
    const result = await service.loginForMall(mobile, "synthetic-password");
    expect(lookup).toHaveBeenCalledWith({ where: { mobile } });
    expect(issuance).toHaveBeenCalledWith("existing-user-id");
    expect(result).toEqual({ token: session.accessToken, refreshToken: session.refreshToken, expiresAt: session.expiresAt,
      user: { id: session.member.id, mobile, nickname: "客户", avatarUrl: null } });
    expect(result).not.toHaveProperty("data");
  });
  it("uses a server-minted state hash and a fixed configured callback", async () => {
    const h = harness();
    const result = await h.service.authorize({ returnTo: "/orders?status=paid", codeChallenge: sha256(verifier) });
    const url = new URL(result.authorizeUrl);
    expect(url.origin).toBe("https://open.weixin.qq.com");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe(result.state);
    expect(h.db.commerceOAuthState.create.mock.calls[0]![0].data.stateHash).toBe(sha256(result.state));
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a verifier copied from a different browser before provider access", async () => {
    const h = harness();
    await expect(h.service.login({ ...loginInput(), codeVerifier: "x".repeat(64) })).rejects.toThrow("已失效");
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.db.commerceOAuthState.updateMany).not.toHaveBeenCalled();
  });
  it("rejects consumed and expired states without requesting the provider", async () => {
    const h = harness(); h.state.consumedAt = new Date();
    await expect(h.service.login(loginInput())).rejects.toThrow("已失效");
    h.state.consumedAt = null; h.state.expiresAt = new Date(0);
    await expect(h.service.login(loginInput())).rejects.toThrow("已失效");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("only the CAS winner may exchange a code", async () => {
    const h = harness(); h.db.commerceOAuthState.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.service.login(loginInput())).rejects.toThrow("已失效");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
  it("returns a binding ticket, not a consumer token or anonymous User", async () => {
    const h = harness(); const result = await h.service.login(loginInput());
    expect(result.requiresMobileBinding).toBe(true);
    expect(result).not.toHaveProperty("token");
    expect(h.auth.issueMallSession).not.toHaveBeenCalled();
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.commerceWechatBindTicket.create.mock.calls[0]![0].data).not.toHaveProperty("accessToken");
  });
  it("known verified scoped identity returns the original stable user id and raw mall session", async () => {
    const h = harness();
    h.db.wechatOfficialIdentity.findUnique.mockResolvedValue({ userId: h.user.id, user: h.user });
    const result = await h.service.login(loginInput());
    expect(result).toMatchObject({ requiresMobileBinding: false, token: h.session.token, user: { id: h.user.id } });
    expect(h.db.wechatOfficialIdentity.findUnique).toHaveBeenCalledWith({
      where: { appId_openId: { appId: config.appId, openId: h.ticket.openId } }, include: { user: true },
    });
  });
  it("phone verification links an existing mobile User without replacing it", async () => {
    const h = harness(); const result = await h.service.bindMobile(bindInput());
    expect(result).toMatchObject({ user: { id: "user-1" }, requiresMobileBinding: false });
    expect(h.auth.consumeMobileBindingCode).toHaveBeenCalledWith(mobile, "123456");
    expect(h.db.user.create).not.toHaveBeenCalled();
    expect(h.db.wechatOfficialIdentity.create.mock.calls[0]![0].data).toMatchObject({
      userId: "user-1", appId: config.appId, openId: h.ticket.openId,
    });
  });
  it("does not move an existing identity across two mobile accounts", async () => {
    const h = harness();
    h.db.wechatOfficialIdentity.findUnique.mockResolvedValue({
      userId: "other-user", user: { ...h.user, id: "other-user", mobile: "19900009999" },
    });
    await expect(h.service.bindMobile(bindInput())).rejects.toThrow("不会自动合并");
    expect(h.db.user.update).not.toHaveBeenCalled();
    expect(h.db.wechatOfficialIdentity.create).not.toHaveBeenCalled();
    expect(h.auth.issueMallSession).not.toHaveBeenCalled();
  });
  it("does not replace another openId already bound to the same phone/appId", async () => {
    const h = harness();
    h.db.wechatOfficialIdentity.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ openId: "another-openid" });
    await expect(h.service.bindMobile(bindInput())).rejects.toThrow("另一个公众号身份");
    expect(h.db.user.update).not.toHaveBeenCalled();
  });
  it("rejects a replayed binding ticket before SMS consumption", async () => {
    const h = harness(); h.ticket.consumedAt = new Date();
    await expect(h.service.bindMobile(bindInput())).rejects.toThrow("已失效");
    expect(h.auth.consumeMobileBindingCode).not.toHaveBeenCalled();
  });
  it("will not bind or issue sessions when SMS verification fails", async () => {
    const h = harness(); h.auth.consumeMobileBindingCode.mockRejectedValue(new Error("bad OTP"));
    await expect(h.service.bindMobile(bindInput())).rejects.toThrow("bad OTP");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.auth.issueMallSession).not.toHaveBeenCalled();
  });
  it.each(["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%2f%2fevil.invalid", "/%255cevil.invalid", "/../..//evil.invalid", "/?token=bad", "/%0aevil"])("rejects unsafe return target %s", value => {
    expect(() => safeH5ReturnTo(value)).toThrow();
  });
  it("allows local relative routes but rejects external callback origins", () => {
    expect(safeH5ReturnTo("/products?id=123")).toBe("/products?id=123");
    expect(() => officialRedirectUri("https://evil.invalid/login", "https://demo.invalid/")).toThrow();
    expect(() => officialRedirectUri("https://demo.invalid/login#hash", "https://demo.invalid/")).toThrow();
  });
  it("keeps missing official integration unavailable without networking", async () => {
    const h = harness(); vi.mocked(h.service.configured).mockRestore();
    await expect(h.service.authorize({ returnTo: "/", codeChallenge: sha256(verifier) })).rejects.toThrow("未配置");
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});

describe("H5 public capabilities", () => {
  it("does not expose keys or advertise unconfigured real channels in demo", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("H5_DEMO_ENABLED", "true"); vi.stubEnv("ALLOW_TEST_OTP", "true");
    vi.stubEnv("MAINTENANCE_READ_ONLY", "false"); vi.stubEnv("BUSINESS_WRITES_PAUSED", "false"); vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
    const secrets = { resolve: vi.fn() };
    const service = new CommerceCapabilitiesService({ integrationConfig: { findMany: vi.fn().mockResolvedValue([]) } } as any,
      secrets as any, { configured: vi.fn().mockRejectedValue(new Error("not configured")) } as any);
    const result = await service.publicCapabilities();
    expect(result).toMatchObject({ demo: true, maintenance: { readOnly: false }, login: { password: { enabled: true }, sms: { enabled: true }, wechatH5: { enabled: false } } });
    expect(result.payments.every(item => !item.enabled)).toBe(true);
    expect(secrets.resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/appSecret|privateKey|merchantId/);
    vi.stubEnv("MAINTENANCE_READ_ONLY", "true");
    expect((await service.publicCapabilities()).login.sms.enabled).toBe(false);
  });
});

describe("scoped JSAPI payer", () => {
  it("returns a real PNG DataURL for a validated WeChat native URI", async () => {
    const service = new PaymentProviderService({ integrationConfig: { findUnique: vi.fn().mockResolvedValue({
      state: IntegrationState.CONFIGURED, publicConfig: { notifyUrl: "https://demo.invalid/notify" },
    }) } } as any, { resolve: vi.fn().mockResolvedValue({
      merchantId: "synthetic-merchant", serialNo: "synthetic-serial", privateKeyPem: "unused-test-key", appIdOfficial: config.appId,
    }) } as any);
    const outbound = vi.spyOn(service as any, "wechatRequest").mockResolvedValue({ code_url: "weixin://wxpay/bizpayurl?pr=synthetic" });
    const input = { id: "intent-1", paymentNo: "synthetic-payment", amountCents: 100, currency: "CNY",
      description: "synthetic", businessId: "order-1", channel: PaymentChannel.WECHAT_NATIVE };
    const result = await service.create(input, {});
    expect(result.codeUrl).toBe("weixin://wxpay/bizpayurl?pr=synthetic");
    expect(result.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    outbound.mockResolvedValue({ code_url: "https://evil.invalid" });
    await expect(service.create(input, {})).rejects.toThrow("二维码");
  });
  it("rejects arbitrary payment redirects and fixes the commerce return route", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("COMMERCE_STOREFRONT_URL", "http://127.0.0.1:5174/saidian-mall");
    expect(trustedPaymentUrl("https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=fake", "wechat").hostname).toBe("wx.tenpay.com");
    expect(() => trustedPaymentUrl("https://evil.invalid/gateway.do", "alipay")).toThrow();
    expect(() => trustedPaymentUrl("https://openapi.alipay.com@evil.invalid/gateway.do", "alipay")).toThrow();
    expect(commercePaymentReturnUrl("order-1")).toBe("http://127.0.0.1:5174/saidian-mall/#/pages/order-detail/index?id=order-1");
  });
  it("looks up the current user plus official appId, never an unscoped legacy field", async () => {
    const lookup = vi.fn().mockResolvedValue({ openId: "official-openid", user: { status: "ACTIVE", mobileVerifiedAt: new Date() } });
    const service = new PaymentProviderService({ wechatOfficialIdentity: { findUnique: lookup } } as any, {} as any);
    expect(await service.resolveOfficialPayer("member-1", config.appId)).toBe("official-openid");
    expect(lookup.mock.calls[0]![0].where).toEqual({ userId_appId: { userId: "member-1", appId: config.appId } });
    lookup.mockResolvedValue(null);
    await expect(service.resolveOfficialPayer("member-1", config.appId)).rejects.toThrow("验证手机号");
  });
  it("JSAPI body uses the scoped payer even when billing still supplies a mini openId", async () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const db = { integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: IntegrationState.CONFIGURED, publicConfig: { notifyUrl: "https://demo.invalid/notify" } }) },
      wechatOfficialIdentity: { findUnique: vi.fn().mockResolvedValue({ openId: "official-payer", user: { status: "ACTIVE", mobileVerifiedAt: new Date() } }) } };
    const service = new PaymentProviderService(db as any, { resolve: vi.fn().mockResolvedValue({
      merchantId: "synthetic-merchant", serialNo: "synthetic-serial", privateKeyPem: keys.privateKey, appIdOfficial: config.appId,
    }) } as any);
    const outbound = vi.spyOn(service as any, "wechatRequest").mockResolvedValue({ prepay_id: "synthetic-prepay" });
    await service.create({ id: "intent-1", userId: "member-1", paymentNo: "synthetic-payment", amountCents: 100,
      currency: "CNY", description: "synthetic", businessId: "order-1", channel: PaymentChannel.WECHAT_JSAPI }, { wechatOpenId: "wrong-mini-openid" });
    expect(outbound.mock.calls[0]![2]).toMatchObject({ appid: config.appId, payer: { openid: "official-payer" } });
  });
});
