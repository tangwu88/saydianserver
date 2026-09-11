import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { CommerceCapabilitiesService } from "./commerce-capabilities.service";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const appId = "wxSyntheticOfficial1";
function fixture() {
  const credentials: Record<string, any> = {
    wechat_pay: { merchantId: "synthetic-merchant", serialNo: "synthetic-serial", platformSerialNo: "synthetic-platform", apiV3Key: "x".repeat(32), privateKeyPem: keys.privateKey, platformPublicKeyPem: keys.publicKey, appIdOfficial: appId, appIdMini: "wxSyntheticMini123" },
    alipay: { appId: "synthetic-alipay", privateKeyPem: keys.privateKey, publicKeyPem: keys.publicKey },
  };
  const rows = ["wechat_pay", "alipay"].map(key => ({ key, state: "CONFIGURED", publicConfig: { notifyUrl: "https://demo.invalid/global/notify" } }));
  const db = { integrationConfig: { findMany: vi.fn().mockResolvedValue(rows) }, commerceBusinessConfig: { findUnique: vi.fn().mockResolvedValue(null) } };
  const secrets = { resolve: vi.fn(async (key: string) => credentials[key]) };
  const official = { configured: vi.fn().mockResolvedValue({ appId }), globalCapabilities: vi.fn().mockResolvedValue({ consentVersion: "legal-v1", legal: null, wechatH5: { enabled: true }, wechatBinding: { phoneCodeMode: "test" } }) };
  return { service: new CommerceCapabilitiesService(db as any, secrets as any, official as any), db, secrets, official, credentials, rows };
}
beforeEach(() => {
  for (const [key, value] of Object.entries({ APP_REALM: "global", NODE_ENV: "production", WORKER_OUTBOUND_PAUSED: "false", BUSINESS_WRITES_PAUSED: "false", MAINTENANCE_READ_ONLY: "false", H5_DEMO_ENABLED: "false", ALLOW_TEST_OTP: "false" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No provider requests permitted")));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("global commerce capability readiness", () => {
  it("offers only CN/CNY and five ready H5 rails without changing global login or leaking credentials", async () => {
    const h = fixture(), result = await h.service.publicCapabilities("en");
    expect(result).toMatchObject({ realm: "global", checkout: { enabled: true, countryCodes: ["CN"], currency: "CNY", minimumCashCents: 1 }, login: { sms: { enabled: false }, wechatBinding: { phoneCodeMode: "test" } }, demo: false });
    expect(result.payments.map(payment => payment.channel)).toEqual(["wechat_jsapi", "wechat_h5", "wechat_native", "alipay_wap", "alipay_page"]);
    expect(result.payments.every(payment => payment.enabled)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/privateKey|merchantId|appId|synthetic-merchant/);
    expect(h.secrets.resolve.mock.calls.every(([key]) => key !== "sms")).toBe(true);
  });
  it("allows checkout with unconfigured providers without pretending payments work", async () => {
    const h = fixture(); h.db.integrationConfig.findMany.mockResolvedValue([]);
    const result = await h.service.publicCapabilities();
    expect(result.checkout).toMatchObject({ enabled: true });
    expect(result.payments.every(payment => !payment.enabled && !!payment.reason)).toBe(true);
  });
  it.each(["WORKER_OUTBOUND_PAUSED", "BUSINESS_WRITES_PAUSED", "MAINTENANCE_READ_ONLY"])("retains %s payment stop", async key => {
    vi.stubEnv(key, "true"); const result = await fixture().service.publicCapabilities();
    expect(result.payments.every(payment => !payment.enabled)).toBe(true);
    expect(result.checkout).toMatchObject({ enabled: key === "WORKER_OUTBOUND_PAUSED" });
  });
  it.each(["merchant", "secret", "callback", "multibyte-key", "app-mismatch"])("does not infer provider readiness: %s", async kind => {
    const h = fixture();
    if (kind === "merchant") h.credentials.wechat_pay.merchantId = "";
    if (kind === "secret") h.credentials.wechat_pay.privateKeyPem = "invalid";
    if (kind === "callback") h.rows[0]!.publicConfig.notifyUrl = "http://demo.invalid/notify";
    if (kind === "multibyte-key") h.credentials.wechat_pay.apiV3Key = "中".repeat(32);
    if (kind === "app-mismatch") h.official.configured.mockResolvedValue({ appId: "wxAnotherOfficial1" });
    const result = await h.service.publicCapabilities();
    expect(result.payments.find(payment => payment.channel === "wechat_jsapi")?.enabled).toBe(false);
    if (kind !== "app-mismatch") expect(result.payments.filter(payment => payment.channel.startsWith("wechat")).every(payment => !payment.enabled)).toBe(true);
  });
  it.each([{ enabled: false, value: {} }, { enabled: true, value: { markets: [{ countryCode: "CN", currency: "USD", enabled: true }] } }, { enabled: true, value: { markets: [{ countryCode: "CN", currency: "CNY", enabled: true, commerceEnabled: false }] } }])("respects explicit market restrictions %j", async config => {
    const h = fixture(); h.db.commerceBusinessConfig.findUnique.mockResolvedValue(config as any);
    const result = await h.service.publicCapabilities();
    expect(result.checkout).toMatchObject({ enabled: false }); expect(result.payments.every(payment => !payment.enabled)).toBe(true);
  });
});
