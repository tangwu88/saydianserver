import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { aliyunEmailSettings, aliyunMailSignature, deliverAliyunEmail } from "./aliyun-email";
import { emailDeliverySettings } from "./email-delivery-settings";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";

const config = { accessKeyId: "synthetic-id", accessKeySecret: "synthetic-secret", accountName: "sender@example.com", regionId: "cn-hangzhou", fromAlias: "Say Ring" };
const input = { channel: "email" as const, identifier: "recipient@example.net", country: null, code: "123456", purpose: "register" as const, locale: "zh-Hans", challengeId: "synthetic" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function harness(verified = true, state = "CONFIGURED") {
  const row = { state, publicConfig: { provider: "aliyun_dm", accountName: config.accountName, regionId: config.regionId, fromAlias: config.fromAlias, deliveryVerified: verified } };
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const resolve = vi.fn().mockResolvedValue(config);
  const service = new GlobalVerificationDeliveryService({ integrationConfig: { findUnique: vi.fn().mockResolvedValue(row), updateMany } } as any, { resolve } as any, { aliyunReady: vi.fn().mockResolvedValue(false) } as any);
  return { service, row, updateMany, resolve };
}
const accepted = () => new Response(JSON.stringify({ RequestId: "synthetic-request", EnvId: "synthetic-message" }));
describe("Aliyun Direct Mail API", () => {
  it("signs with RFC3986 encoding and excludes Signature", () => {
    const canonical = "AccountName=a%2Bb%40example.com&Subject=%E6%B5%8B%E8%AF%95%20%21";
    const encoded = encodeURIComponent(canonical).replace(/!/g, "%21");
    const expected = createHmac("sha1", "secret&").update(`POST&%2F&${encoded}`).digest("base64");
    expect(aliyunMailSignature({ Subject: "测试 !", AccountName: "a+b@example.com", Signature: "ignored" }, "secret")).toBe(expected);
  });
  it("uses a fixed HTTPS POST, single recipient, signed body, timeout and no redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(accepted()); vi.stubGlobal("fetch", fetcher);
    await deliverAliyunEmail(config, { recipient: input.identifier, code: input.code });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://dm.aliyuncs.com/");
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const params = Object.fromEntries(new URLSearchParams(options.body));
    expect(params).toMatchObject({ Action: "SingleSendMail", Version: "2015-11-23", RegionId: "cn-hangzhou", AccountName: config.accountName, ToAddress: input.identifier, AddressType: "1", ReplyToAddress: "false", Format: "JSON" });
    expect(params.TextBody).toContain("123456");
    expect(params.Signature).toBe(aliyunMailSignature(params, config.accessKeySecret));
    expect(options.body).not.toContain(config.accessKeySecret);
  });
  for (const result of [{ Code: "InvalidAccessKey", Message: config.accessKeySecret }, {}, { RequestId: "x" }]) {
    it(`fails closed without raw provider details for ${JSON.stringify(Object.keys(result))}`, async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
      await expect(deliverAliyunEmail(config, { recipient: input.identifier, code: input.code })).rejects.toThrow("Aliyun email submission failed");
    });
  }
  it("rejects arbitrary hosts, recipient lists, invalid code and header injection before network", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const bad of [{ regionId: "https://evil.invalid" }, { accountName: "x@example.com\r\nBcc:a@example.net" }, { fromAlias: "x\nHeader" }]) {
      await expect(deliverAliyunEmail({ ...config, ...bad }, { recipient: input.identifier, code: input.code })).rejects.toThrow();
    }
    await expect(deliverAliyunEmail(config, { recipient: "a@example.com,b@example.com", code: input.code })).rejects.toThrow();
    await expect(deliverAliyunEmail(config, { recipient: input.identifier, code: "12" })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires enabled configuration, credentials and manual delivery acceptance for OTP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(accepted));
    const h = harness(); await h.service.send(input);
    expect(h.resolve).toHaveBeenCalledWith("email_otp", expect.objectContaining({ accessKeySecret: "GLOBAL_EMAIL_ALIYUN_ACCESS_KEY_SECRET" }));
    expect(h.updateMany).toHaveBeenCalledOnce();
    for (const other of [harness(false), harness(true, "DISABLED")]) {
      await expect(other.service.capabilities()).resolves.toMatchObject({ email: false });
      await expect(other.service.send(input)).rejects.toThrow();
    }
    h.resolve.mockResolvedValue({}); await expect(h.service.capabilities()).resolves.toMatchObject({ email: false });
  });
  it("test mail does not create OTP or mark delivery verified, and respects maintenance", async () => {
    const fetcher = vi.fn().mockImplementation(accepted); vi.stubGlobal("fetch", fetcher);
    const h = harness(false);
    await expect(h.service.sendEmailTest(input.identifier)).resolves.toEqual({ submitted: true, deliveryVerified: false });
    expect(new URLSearchParams(fetcher.mock.calls[0]![1].body).get("TextBody")).not.toContain(input.code);
    expect(h.updateMany).not.toHaveBeenCalled();
    for (const key of ["MAINTENANCE_READ_ONLY", "WORKER_OUTBOUND_PAUSED"]) {
      vi.stubEnv(key, "true"); await expect(h.service.sendEmailTest(input.identifier)).rejects.toThrow(); vi.stubEnv(key, "false");
    }
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("reset acceptance on sender, region or credential change; never publish AccessKeys", () => {
    const before = harness().row.publicConfig;
    expect(emailDeliverySettings(before, before, false).deliveryVerified).toBe(true);
    for (const next of [{ ...before, accountName: "new@example.net" }, { ...before, regionId: "ap-southeast-1" }, { ...before, fromAlias: "New" }]) {
      expect(emailDeliverySettings(before, next, false).deliveryVerified).toBe(false);
    }
    expect(emailDeliverySettings(before, before, true).deliveryVerified).toBe(false);
    expect(() => emailDeliverySettings(before, { ...before, accessKeySecret: "secret" }, false)).toThrow();
    expect(() => aliyunEmailSettings({ accountName: config.accountName, regionId: "__proto__" })).toThrow();
  });
});
