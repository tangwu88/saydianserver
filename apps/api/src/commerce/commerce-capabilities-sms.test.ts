import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommerceCapabilitiesService } from "./commerce-capabilities.service";

function fixture(
  publicConfig: Record<string, unknown>,
  secretsValue: Record<string, string>,
) {
  const db = {
    integrationConfig: {
      findMany: vi.fn().mockResolvedValue([
        { key: "sms", state: "CONFIGURED", publicConfig },
      ]),
    },
  };
  const secrets = { resolve: vi.fn().mockResolvedValue(secretsValue) };
  const official = { configured: vi.fn().mockRejectedValue(new Error("not configured")) };
  return {
    service: new CommerceCapabilitiesService(db as never, secrets as never, official as never, { capabilities: vi.fn().mockResolvedValue({ email: false, sms: false, smsCountries: [] }) } as never),
    secrets,
  };
}

describe("domestic SMS capability", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries({
      APP_REALM: "domestic",
      NODE_ENV: "production",
      ALLOW_TEST_OTP: "false",
      BUSINESS_WRITES_PAUSED: "false",
      MAINTENANCE_READ_ONLY: "false",
      WORKER_OUTBOUND_PAUSED: "false",
      H5_DEMO_ENABLED: "false",
    })) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No provider request permitted")));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("advertises Aliyun SMS only when public and encrypted settings are complete", async () => {
    const h = fixture(
      { provider: "aliyun", signName: "合成签名", templateCode: "SMS_123456789" },
      { accessKeyId: "synthetic-id", accessKeySecret: "synthetic-secret" },
    );

    expect((await h.service.publicCapabilities()).login.sms.enabled).toBe(true);
    expect(h.secrets.resolve).toHaveBeenCalledWith("sms", expect.objectContaining({
      accessKeyId: "ALIBABA_CLOUD_ACCESS_KEY_ID",
      accessKeySecret: "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    }));
  });

  it.each([
    [{ provider: "aliyun", signName: "", templateCode: "SMS_123456789" }, { accessKeyId: "id", accessKeySecret: "secret" }],
    [{ provider: "aliyun", signName: "合成签名", templateCode: "123456789" }, { accessKeyId: "id", accessKeySecret: "secret" }],
    [{ provider: "aliyun", signName: "合成签名", templateCode: "SMS_123456789" }, { accessKeyId: "id" }],
  ])("fails closed for incomplete Aliyun configuration", async (publicConfig, secrets) => {
    const result = await fixture(publicConfig, secrets).service.publicCapabilities();
    expect(result.login.sms.enabled).toBe(false);
  });
});
