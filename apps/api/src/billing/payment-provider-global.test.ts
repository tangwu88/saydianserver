import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentChannel } from "@prisma/client";
import {
  PaymentProviderService,
  paymentIntegrationKeyForNewIntent,
  paymentIntegrationKeyForStoredIntent,
} from "./payment-provider.service";
import { BillingService } from "./billing.service";
import { generateKeyPairSync } from "node:crypto";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

beforeEach(() => {
  for (const [key, value] of Object.entries({ APP_REALM: "global", NODE_ENV: "production", WORKER_OUTBOUND_PAUSED: "false", BUSINESS_WRITES_PAUSED: "false", MAINTENANCE_READ_ONLY: "false", GLOBAL_WECHAT_H5_ENABLED: "true", H5_DEMO_ENABLED: "false", PUBLIC_BASE_URL: "https://demo.invalid/global", COMMERCE_STOREFRONT_URL: "https://demo.invalid/global/saidian-mall/" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No provider network in tests")));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const intent = (channel: PaymentChannel = PaymentChannel.WECHAT_H5) => ({ id: "intent", userId: "user", businessType: "COMMERCE_ORDER", businessId: "order", paymentNo: "SYNTHETIC", amountCents: 100, currency: "CNY", description: "Synthetic", channel });
function providerFixture(ready = false) {
  const appId = "wxSyntheticOfficial1";
  const credentials: Record<string, any> = {
    wechat_pay: { merchantId: "synthetic-merchant", serialNo: "synthetic-serial", platformSerialNo: "synthetic-platform", apiV3Key: "x".repeat(32), privateKeyPem: keys.privateKey, platformPublicKeyPem: keys.publicKey, appIdOfficial: appId },
    wechat_pay_app: { merchantId: "synthetic-app-merchant", serialNo: "synthetic-app-serial", platformSerialNo: "synthetic-app-platform", apiV3Key: "y".repeat(32), privateKeyPem: keys.privateKey, platformPublicKeyPem: keys.publicKey, appIdApp: "wxSyntheticMobile12" },
    alipay: { appId: "synthetic-alipay", privateKeyPem: keys.privateKey, publicKeyPem: keys.publicKey },
    alipay_app: { appId: "synthetic-alipay-app", privateKeyPem: keys.privateKey, publicKeyPem: keys.publicKey },
    wechat_official: { appId, appSecret: "synthetic-official-secret" },
  };
  const config = { state: "CONFIGURED", publicConfig: { notifyUrl: "https://demo.invalid/global/notify", redirectUri: "https://demo.invalid/global/saidian-mall/oauth/callback" } };
  const db = { integrationConfig: { findUnique: vi.fn().mockResolvedValue(ready ? config : null) }, wechatOfficialIdentity: { findUnique: vi.fn().mockResolvedValue(null) } };
  const secrets = { resolve: vi.fn(async (key: string) => ready ? credentials[key] : {}) };
  return { db, secrets, config, credentials, service: new PaymentProviderService(db as any, secrets as any) };
}
describe("global payment adapter boundary", () => {
  it("signs Alipay browser payments with a fragment-free same-site return landing", async () => {
    const invoke = await providerFixture(true).service.create(intent(PaymentChannel.ALIPAY_WAP), {}) as any;
    expect(invoke.type).toBe("FORM");
    expect(invoke.fields.return_url).toBe("https://demo.invalid/global/api/saydian-app/v2/billing/payments/alipay/return/order");
    expect(new URL(invoke.fields.return_url).hash).toBe("");
  });
  it.each([PaymentChannel.WECHAT_JSAPI, PaymentChannel.ALIPAY_WAP, PaymentChannel.ALIPAY_PAGE, PaymentChannel.WECHAT_APP, PaymentChannel.ALIPAY_APP])("dispatches an allowed CNY commerce %s only to its bound adapter", async channel => {
    const h = providerFixture(true), wechat = vi.spyOn(h.service as any, "createWechat").mockResolvedValue({ type: "SYNTHETIC_WECHAT" }), alipay = vi.spyOn(h.service as any, "createAlipay").mockResolvedValue({ type: "SYNTHETIC_ALIPAY" });
    await h.service.create(intent(channel), {});
    expect(channel.startsWith("WECHAT") ? wechat : alipay).toHaveBeenCalledOnce();
    expect(channel.startsWith("WECHAT") ? alipay : wechat).not.toHaveBeenCalled();
  });
  it.each([{ currency: "USD" }, { currency: "JPY" }, { businessType: "HEALTH_REPORT" }, { businessType: "HEALTH_MEMBERSHIP" }, { businessType: undefined }, { channel: PaymentChannel.WECHAT_MINI }, { channel: PaymentChannel.WECHAT_H5 }, { channel: PaymentChannel.WECHAT_NATIVE }])("rejects unsupported dispatch %j before provider access", async patch => {
    const h = providerFixture();
    await expect(h.service.create({ ...intent(), ...patch } as any, {})).rejects.toMatchObject({ status: 503, response: { errorKey: "payment_unavailable" } });
    expect(h.db.integrationConfig.findUnique).not.toHaveBeenCalled(); expect(h.secrets.resolve).not.toHaveBeenCalled();
  });
  it("never dispatches the admin-only offline channel to a payment or refund provider", async () => {
    const h = providerFixture(true);
    await expect(h.service.create(intent(PaymentChannel.OFFLINE_MANUAL), {})).rejects.toThrow("只能由超级管理员");
    await expect(h.service.refund({
      refundNo: "OFFLINE-REFUND", paymentNo: "OFFLINE-PAYMENT", providerTransactionId: "OFFLINE-TRANSACTION",
      amountCents: 100, totalCents: 100, currency: "CNY", reason: "合成测试", channel: PaymentChannel.OFFLINE_MANUAL,
    })).rejects.toThrow("不会调用线上退款渠道");
    expect(h.db.integrationConfig.findUnique).not.toHaveBeenCalled();
    expect(h.secrets.resolve).not.toHaveBeenCalled();
  });
  it.each([PaymentChannel.WECHAT_JSAPI, PaymentChannel.ALIPAY_WAP, PaymentChannel.ALIPAY_PAGE])("retains unconfigured failure for supported %s", async channel => {
    await expect(providerFixture().service.create(intent(channel), {})).rejects.toMatchObject({ status: 503 });
  });
  it.each(["platform-key", "api-v3-key", "alipay-public-key", "notify-http", "untrusted-gateway", "official-app", "official-secret", "official-callback"])("blocks incomplete configuration before identity/reservation and direct dispatch: %s", async kind => {
    const h = providerFixture(true);
    const channel = kind.startsWith("alipay") || kind === "untrusted-gateway" ? PaymentChannel.ALIPAY_WAP : kind.startsWith("official") ? PaymentChannel.WECHAT_JSAPI : PaymentChannel.WECHAT_JSAPI;
    if (kind === "platform-key") h.credentials.wechat_pay.platformPublicKeyPem = "";
    if (kind === "api-v3-key") h.credentials.wechat_pay.apiV3Key = "中".repeat(32);
    if (kind === "alipay-public-key") h.credentials.alipay.publicKeyPem = "";
    if (kind === "notify-http") h.config.publicConfig.notifyUrl = "http://demo.invalid/notify";
    if (kind === "untrusted-gateway") Object.assign(h.config.publicConfig, { gateway: "https://untrusted.invalid/gateway.do" });
    if (kind === "official-app") h.credentials.wechat_official.appId = "wxAnotherOfficial1";
    if (kind === "official-secret") h.credentials.wechat_official.appSecret = "";
    if (kind === "official-callback") h.config.publicConfig.redirectUri = "https://demo.invalid/saidian-mall/oauth/callback";
    const adapter = vi.spyOn(h.service as any, channel.startsWith("WECHAT") ? "createWechat" : "createAlipay").mockResolvedValue({});
    await expect(h.service.identity(channel)).rejects.toThrow();
    await expect(h.service.create(intent(channel), {})).rejects.toThrow();
    expect(adapter).not.toHaveBeenCalled();
  });
  it("keeps existing APPLE behavior and domestic rails unchanged", async () => {
    const h = providerFixture(), apple = vi.spyOn(h.service as any, "appleInvoke").mockResolvedValue({ type: "STOREKIT" });
    await h.service.create({ ...intent(PaymentChannel.APPLE_IAP), businessType: "HEALTH_REPORT", currency: "USD" }, { appleProductId: "synthetic" });
    expect(apple).toHaveBeenCalledOnce();
    vi.stubEnv("APP_REALM", "domestic"); const wechat = vi.spyOn(h.service as any, "createWechat").mockResolvedValue({});
    await h.service.create({ ...intent(PaymentChannel.WECHAT_MINI), businessType: "HEALTH_REPORT" }, {}); expect(wechat).toHaveBeenCalledOnce();
  });
  it("binds new App payments to App credentials while null historical rows stay on legacy credentials", () => {
    expect(paymentIntegrationKeyForNewIntent(PaymentChannel.WECHAT_APP)).toBe("wechat_pay_app");
    expect(paymentIntegrationKeyForNewIntent(PaymentChannel.ALIPAY_APP)).toBe("alipay_app");
    expect(paymentIntegrationKeyForStoredIntent({ channel: PaymentChannel.WECHAT_APP, integrationKey: null })).toBe("wechat_pay");
    expect(paymentIntegrationKeyForStoredIntent({ channel: PaymentChannel.ALIPAY_APP, integrationKey: null })).toBe("alipay");
    expect(() => paymentIntegrationKeyForStoredIntent({ channel: PaymentChannel.WECHAT_APP, integrationKey: "wechat_pay" })).toThrow("不匹配");
  });
  it.each(["email", "phone"])("requires ACTIVE current-app official identity with true %s verification", async channel => {
    const h = providerFixture(); h.db.wechatOfficialIdentity.findUnique.mockResolvedValue({ openId: "current-official-openid", user: { status: "ACTIVE", emailVerifiedAt: channel === "email" ? new Date() : null, mobileVerifiedAt: channel === "phone" ? new Date() : null } } as any);
    expect(await h.service.resolveOfficialPayer("user", "official-app")).toBe("current-official-openid");
    expect(h.db.wechatOfficialIdentity.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_appId: { userId: "user", appId: "official-app" } } }));
    if (channel === "email") { vi.stubEnv("APP_REALM", "domestic"); await expect(h.service.resolveOfficialPayer("user", "official-app")).rejects.toMatchObject({ status: 400 }); }
  });
  it.each([null, { openId: "unverified", user: { status: "ACTIVE", emailVerifiedAt: null, mobileVerifiedAt: null } }, { openId: "frozen", user: { status: "FROZEN", emailVerifiedAt: new Date(), mobileVerifiedAt: new Date() } }])("rejects missing, unverified/test or disabled payer %j", async identity => {
    const h = providerFixture(); h.db.wechatOfficialIdentity.findUnique.mockResolvedValue(identity as any);
    await expect(h.service.resolveOfficialPayer("user", "official-app")).rejects.toMatchObject({ status: 400 });
  });
});

function billingFixture(currency = "CNY") {
  const db = { paymentIntent: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn() };
  const providers = { identity: vi.fn().mockRejectedValue(new Error("synthetic unconfigured")), create: vi.fn() };
  const service = new BillingService(db as any, providers as any, {} as any);
  const resolve = vi.spyOn(service as any, "resolveBusiness").mockResolvedValue({ currency, amountCents: 100, businessId: "order", commerceOrderId: "order" });
  const input = { businessType: "commerce_order", businessId: "order", channel: "alipay_wap", idempotencyKey: "global-payment-key" };
  return { service, db, providers, resolve, input };
}
describe("global payment reservation preflight", () => {
  it("rejects foreign currency before identity or pending intent reservation", async () => {
    const h = billingFixture("USD"); await expect(h.service.createPayment("user", h.input, {})).rejects.toMatchObject({ status: 503, response: { errorKey: "payment_unavailable" } });
    expect(h.providers.identity).not.toHaveBeenCalled(); expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it.each([{ businessType: "health_membership" }, { businessType: "health_report" }, { channel: "wechat_mini" }, { channel: "wechat_h5" }, { channel: "wechat_native" }])("rejects unsupported scope before business resolution or assets %j", async patch => {
    const h = billingFixture(); await expect(h.service.createPayment("user", { ...h.input, ...patch }, {})).rejects.toMatchObject({ status: 503, response: { errorKey: "payment_unavailable" } });
    expect(h.resolve).not.toHaveBeenCalled(); expect(h.providers.identity).not.toHaveBeenCalled(); expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it.each([{ channel: "wechat_app", platform: "android", expected: PaymentChannel.WECHAT_APP }, { channel: "alipay_app", platform: "ios", expected: PaymentChannel.ALIPAY_APP }])("allows native App commerce scope but still requires its separate provider: %j", async patch => {
    const h = billingFixture();
    await expect(h.service.createPayment("user", { ...h.input, channel: patch.channel, platform: patch.platform }, {})).rejects.toThrow("synthetic unconfigured");
    expect(h.resolve).toHaveBeenCalledOnce();
    expect(h.providers.identity).toHaveBeenCalledWith(patch.expected);
  });
  it.each([
    { channel: "wechat_app", platform: "android", storedChannel: PaymentChannel.WECHAT_APP, integrationKey: "wechat_pay_app" },
    { channel: "alipay_app", platform: "ios", storedChannel: PaymentChannel.ALIPAY_APP, integrationKey: "alipay_app" },
  ])("stores the exact App integration on a new payment intent: %j", async sample => {
    const h = billingFixture();
    h.providers.identity.mockResolvedValue({ merchantId: "merchant", appId: "app" });
    h.providers.create.mockResolvedValue({ signed: "provider-payload" });
    const createdAt = new Date("2026-09-13T00:00:00Z");
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      commerceOrder: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "order",
          status: "PENDING_PAYMENT",
          executionOwner: "NEW_SYSTEM",
        }),
      },
      paymentIntent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => ({
          id: "intent",
          paymentNo: "SYNTHETIC",
          status: "CREATED",
          providerPayload: null,
          createdAt,
          user: { wechatOpenId: null },
          ...data,
        })),
      },
    };
    h.db.$transaction.mockImplementation(async work => work(tx as any));
    Object.assign(h.db.paymentIntent, {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "intent",
        paymentNo: "SYNTHETIC",
        userId: "user",
        businessType: "COMMERCE_ORDER",
        businessId: "order",
        channel: sample.storedChannel,
        integrationKey: sample.integrationKey,
        status: "PENDING",
        amountCents: 100,
        currency: "CNY",
        providerPayload: { signed: "provider-payload" },
        createdAt,
      }),
    });

    await expect(h.service.createPayment("user", {
      ...h.input,
      channel: sample.channel,
      platform: sample.platform,
    }, {})).resolves.toMatchObject({
      channel: sample.channel,
      status: "pending",
    });
    expect(tx.paymentIntent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        channel: sample.storedChannel,
        integrationKey: sample.integrationKey,
      }),
    }));
    expect(h.providers.create).toHaveBeenCalledWith(
      expect.objectContaining({ integrationKey: sample.integrationKey }),
      expect.any(Object),
    );
  });
  it.each(["WORKER_OUTBOUND_PAUSED", "BUSINESS_WRITES_PAUSED", "MAINTENANCE_READ_ONLY"])("retains %s before preflight or new intent", async key => {
    vi.stubEnv(key, "true"); const h = billingFixture();
    await expect(h.service.createPayment("user", h.input, {})).rejects.toMatchObject({ status: 503 });
    expect(h.resolve).not.toHaveBeenCalled(); expect(h.providers.identity).not.toHaveBeenCalled(); expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it("enforces WeChat-only JSAPI and browser-only Alipay before any order resolution", async () => {
    const inWechatAlipay = billingFixture();
    await expect(inWechatAlipay.service.createPayment("user", inWechatAlipay.input, { clientUserAgent: "MicroMessenger" })).rejects.toMatchObject({ status: 400, response: { errorKey: "payment_channel_unavailable" } });
    expect(inWechatAlipay.resolve).not.toHaveBeenCalled();

    const browserWechat = billingFixture();
    await expect(browserWechat.service.createPayment("user", { ...browserWechat.input, channel: "wechat_jsapi" }, { clientUserAgent: "Mozilla/5.0" })).rejects.toMatchObject({ status: 400, response: { errorKey: "payment_channel_unavailable" } });
    expect(browserWechat.resolve).not.toHaveBeenCalled();

    const inWechatJsapi = billingFixture();
    await expect(inWechatJsapi.service.createPayment("user", { ...inWechatJsapi.input, channel: "wechat_jsapi" }, { clientUserAgent: "MicroMessenger" })).rejects.toThrow("synthetic unconfigured");
    expect(inWechatJsapi.resolve).toHaveBeenCalledOnce();

    const browserAlipay = billingFixture();
    await expect(browserAlipay.service.createPayment("user", browserAlipay.input, { clientUserAgent: "Mozilla/5.0" })).rejects.toThrow("synthetic unconfigured");
    expect(browserAlipay.resolve).toHaveBeenCalledOnce();
  });
  it("returns owned same-key existing payment even when new dispatch is paused or unsupported", async () => {
    const h = billingFixture("USD"); vi.stubEnv("WORKER_OUTBOUND_PAUSED", "true");
    h.db.paymentIntent.findUnique.mockResolvedValue({ ...intent(PaymentChannel.WECHAT_APP), channel: "WECHAT_APP", currency: "USD", status: "PENDING", providerPayload: { type: "APP" }, createdAt: new Date() } as any);
    expect(await h.service.createPayment("user", { ...h.input, channel: "wechat_app" }, {})).toMatchObject({ id: "intent", channel: "wechat_app", currency: "USD" });
    expect(h.resolve).not.toHaveBeenCalled(); expect(h.providers.identity).not.toHaveBeenCalled(); expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.providers.create).not.toHaveBeenCalled();
    await expect(h.service.createPayment("another-user", { ...h.input, channel: "wechat_app" }, {})).rejects.toMatchObject({ status: 409 });
  });
});
