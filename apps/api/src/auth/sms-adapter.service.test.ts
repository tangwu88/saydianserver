import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  sendSms: vi.fn(),
  configs: [] as Record<string, unknown>[],
}));

vi.mock("@alicloud/openapi-core", () => ({
  $OpenApiUtil: {
    Config: class {
      constructor(input: Record<string, unknown>) {
        Object.assign(this, input);
        sdk.configs.push(input);
      }
    },
  },
}));

vi.mock("@alicloud/dysmsapi20170525", () => ({
  default: class {
    sendSms(request: unknown) { return sdk.sendSms(request); }
  },
  SendSmsRequest: class {
    constructor(input: Record<string, unknown>) { Object.assign(this, input); }
  },
}));

import { SmsAdapterService } from "./sms-adapter.service";

function fixture(publicConfig: Record<string, unknown>, secrets: Record<string, string>, state = "CONFIGURED") {
  const prisma = {
    integrationConfig: {
      findUnique: vi.fn().mockResolvedValue({ state, publicConfig }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const integrationSecrets = { resolve: vi.fn().mockResolvedValue(secrets) };
  return { service: new SmsAdapterService(prisma as any, integrationSecrets as any), prisma, integrationSecrets };
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SMS_PROVIDER", "disabled");
  sdk.sendSms.mockReset();
  sdk.configs.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Aliyun SMS adapter", () => {
  const config = { provider: "aliyun", signName: "合成签名", templateCode: "SMS_123456789" };
  const secrets = { accessKeyId: "synthetic-id", accessKeySecret: "synthetic-secret" };

  it("reports configuration readiness without calling the provider", async () => {
    const h = fixture(config, secrets);
    expect(await h.service.aliyunReady()).toBe(true);
    expect(sdk.sendSms).not.toHaveBeenCalled();
    expect(h.integrationSecrets.resolve).toHaveBeenCalledWith("sms", {
      accessKeyId: "ALIBABA_CLOUD_ACCESS_KEY_ID",
      accessKeySecret: "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    });
  });

  it("fails closed for disabled, incomplete or malformed configuration", async () => {
    expect(await fixture(config, secrets, "DISABLED").service.aliyunReady()).toBe(false);
    expect(await fixture({ ...config, templateCode: "123456789" }, secrets).service.aliyunReady()).toBe(false);
    expect(await fixture(config, { accessKeyId: "synthetic-id" }).service.aliyunReady()).toBe(false);
  });

  it("sends only the code template variable and records successful delivery", async () => {
    sdk.sendSms.mockResolvedValue({ body: { code: "OK" } });
    const h = fixture(config, secrets);
    await h.service.send("13812345678", "246810", "login");
    expect(sdk.configs[0]).toEqual(expect.objectContaining({
      accessKeyId: "synthetic-id",
      accessKeySecret: "synthetic-secret",
      endpoint: "dysmsapi.aliyuncs.com",
    }));
    expect(sdk.sendSms).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumbers: "13812345678",
      signName: "合成签名",
      templateCode: "SMS_123456789",
      templateParam: JSON.stringify({ code: "246810" }),
    }));
    expect(h.prisma.integrationConfig.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { key: "sms" } }));
  });

  it("uses a generic failure when Aliyun rejects or cannot complete delivery", async () => {
    sdk.sendSms.mockResolvedValue({ body: { code: "isv.SYNTHETIC", message: "provider-secret-detail" } });
    const h = fixture(config, secrets);
    await expect(h.service.send("13812345678", "246810", "login")).rejects.toThrow("短信服务暂时无法使用");
    expect(h.prisma.integrationConfig.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the existing webhook provider behavior", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const h = fixture({ provider: "webhook", webhookUrl: "https://example.invalid/sms" }, { webhookToken: "synthetic-token" });
    await h.service.send("13812345678", "123456", "login");
    expect(fetch).toHaveBeenCalledWith("https://example.invalid/sms", expect.objectContaining({ method: "POST" }));
    expect(sdk.sendSms).not.toHaveBeenCalled();
  });
});
