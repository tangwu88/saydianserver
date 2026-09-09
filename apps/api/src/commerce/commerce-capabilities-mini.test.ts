import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { CommerceCapabilitiesService } from "./commerce-capabilities.service";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const miniAppId = "wxH5CONTRACTMINI001", officialAppId = "wxH5CONTRACTOFFICIAL1";
function fixture(input: { mini?: string; official?: string; oauth?: string; configured?: boolean; invalidMerchant?: boolean } = {}) {
  const secrets = { resolve: vi.fn().mockResolvedValue({
    merchantId: "synthetic-merchant", serialNo: "synthetic-serial", platformSerialNo: "synthetic-platform",
    apiV3Key: input.invalidMerchant ? "invalid" : "x".repeat(32), privateKeyPem: keys.privateKey, platformPublicKeyPem: keys.publicKey,
    appIdMini: input.mini, appIdOfficial: input.official,
  }) };
  const db = { integrationConfig: { findMany: vi.fn().mockResolvedValue(input.configured === false ? [] : [
    { key: "wechat_pay", state: "CONFIGURED", publicConfig: { notifyUrl: "https://demo.example.invalid/notify" } },
  ]) } };
  const configured = input.oauth ? vi.fn().mockResolvedValue({ appId: input.oauth })
    : vi.fn().mockRejectedValue(new Error("Official OAuth unconfigured"));
  return { service: new CommerceCapabilitiesService(db as any, secrets as any, { configured } as any), secrets };
}
const payment = (result: Awaited<ReturnType<CommerceCapabilitiesService["publicCapabilities"]>>, channel: string) =>
  result.payments.find(item => item.channel === channel)!;

describe("mini payment configuration independence", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("H5_DEMO_ENABLED", "true"); vi.stubEnv("ALLOW_TEST_OTP", "false");
    vi.stubEnv("MAINTENANCE_READ_ONLY", "false"); vi.stubEnv("BUSINESS_WRITES_PAUSED", "false"); vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Tests forbid provider requests")));
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("advertises configured mini payment when official payment appId and OAuth are absent", async () => {
    const h = fixture({ mini: miniAppId }), result = await h.service.publicCapabilities();
    expect(payment(result, "wechat_mini")).toEqual({ channel: "wechat_mini", environments: ["mini"], enabled: true });
    expect(result.login.wechatH5.enabled).toBe(false);
    for (const channel of ["wechat_jsapi", "wechat_h5", "wechat_native"]) expect(payment(result, channel).enabled).toBe(false);
    expect(h.secrets.resolve).toHaveBeenCalledWith("wechat_pay", expect.objectContaining({ appIdMini: "WECHAT_PAY_APP_ID_MINI" }));
    expect(JSON.stringify(result)).not.toMatch(/appId|merchantId|privateKey|synthetic-merchant/);
  });
  it("does not infer mini payment readiness from a configured official app", async () => {
    const result = await fixture({ official: officialAppId, oauth: officialAppId }).service.publicCapabilities();
    expect(payment(result, "wechat_mini")).toMatchObject({ enabled: false, environments: ["mini"] });
    for (const channel of ["wechat_jsapi", "wechat_h5", "wechat_native"]) expect(payment(result, channel).enabled).toBe(true);
  });
  it("requires matching official OAuth only for JSAPI, not mini or browser WeChat", async () => {
    const result = await fixture({ mini: miniAppId, official: officialAppId, oauth: "wxDifferentOfficial1" }).service.publicCapabilities();
    expect(payment(result, "wechat_jsapi").enabled).toBe(false);
    for (const channel of ["wechat_mini", "wechat_h5", "wechat_native"]) expect(payment(result, channel).enabled).toBe(true);
  });
  it("does not advertise malformed mini appId while a valid official app is configured", async () => {
    const result = await fixture({ mini: "bad", official: officialAppId, oauth: officialAppId }).service.publicCapabilities();
    expect(payment(result, "wechat_mini").enabled).toBe(false);
    expect(payment(result, "wechat_jsapi").enabled).toBe(true);
  });
  it.each([{ configured: false }, { invalidMerchant: true }])("fails closed without shared merchant readiness %j", async options => {
    const result = await fixture({ mini: miniAppId, official: officialAppId, oauth: officialAppId, ...options }).service.publicCapabilities();
    expect(result.payments.filter(item => item.channel.startsWith("wechat")).every(item => !item.enabled && item.reason)).toBe(true);
  });
  it.each(["WORKER_OUTBOUND_PAUSED", "BUSINESS_WRITES_PAUSED", "MAINTENANCE_READ_ONLY"])("preserves the common write gate %s", async key => {
    vi.stubEnv(key, "true");
    const result = await fixture({ mini: miniAppId, official: officialAppId, oauth: officialAppId }).service.publicCapabilities();
    expect(payment(result, "wechat_mini")).toMatchObject({ enabled: false, reason: "交易维护中" });
    expect(result.payments.every(item => !item.enabled)).toBe(true);
  });
});
