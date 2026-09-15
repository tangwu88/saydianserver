import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aliyun = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  requests: [] as Record<string, unknown>[],
  sendSms: vi.fn(),
}));

vi.mock("@alicloud/openapi-core", () => ({
  $OpenApiUtil: {
    Config: class {
      constructor(input: Record<string, unknown>) {
        Object.assign(this, input);
      }
    },
  },
}));

vi.mock("@alicloud/dysmsapi20170525", () => ({
  default: class {
    constructor(config: Record<string, unknown>) {
      aliyun.configs.push(config);
    }
    sendSms(request: Record<string, unknown>) {
      aliyun.requests.push(request);
      return aliyun.sendSms(request);
    }
  },
  SendSmsRequest: class {
    constructor(input: Record<string, unknown>) {
      Object.assign(this, input);
    }
  },
}));

import { SmsAdapterService } from "./sms-adapter.service";

function fixture(
  provider: string,
  publicConfig: Record<string, unknown>,
  secrets: Record<string, string>,
) {
  const prisma = {
    integrationConfig: {
      findUnique: vi.fn().mockResolvedValue({
        state: "CONFIGURED",
        publicConfig: { provider, ...publicConfig },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const integrationSecrets = { resolve: vi.fn().mockResolvedValue(secrets) };
  return {
    prisma,
    integrationSecrets,
    service: new SmsAdapterService(prisma as never, integrationSecrets as never),
  };
}

describe("SMS provider adapter", () => {
  beforeEach(() => {
    aliyun.configs.length = 0;
    aliyun.requests.length = 0;
    aliyun.sendSms.mockReset().mockResolvedValue({ body: { code: "OK" } });
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("H5_DEMO_ENABLED", "false");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends an Aliyun verification template without exposing credentials", async () => {
    const h = fixture(
      "aliyun",
      { signName: "合成测试签名", templateCode: "SMS_123456789" },
      { accessKeyId: "synthetic-access-key-id", accessKeySecret: "synthetic-access-key-secret" },
    );

    await h.service.send("13800138000", "482915", "login");

    expect(aliyun.configs[0]).toMatchObject({
      accessKeyId: "synthetic-access-key-id",
      accessKeySecret: "synthetic-access-key-secret",
      endpoint: "dysmsapi.aliyuncs.com",
      connectTimeout: 5_000,
      readTimeout: 10_000,
    });
    expect(aliyun.requests[0]).toMatchObject({
      phoneNumbers: "13800138000",
      signName: "合成测试签名",
      templateCode: "SMS_123456789",
      templateParam: JSON.stringify({ code: "482915" }),
    });
    expect(h.prisma.integrationConfig.updateMany).toHaveBeenCalledWith({
      where: { key: "sms" },
      data: { lastCheckedAt: expect.any(Date), lastError: null },
    });
  });

  it("fails closed when Aliyun rejects the request", async () => {
    aliyun.sendSms.mockResolvedValue({ body: { code: "isv.SMS_SIGNATURE_ILLEGAL" } });
    const h = fixture(
      "aliyun",
      { signName: "合成测试签名", templateCode: "SMS_123456789" },
      { accessKeyId: "synthetic-id", accessKeySecret: "synthetic-secret" },
    );

    await expect(h.service.send("13800138000", "123456", "login")).rejects.toThrow(
      "短信服务暂时无法使用",
    );
    expect(h.prisma.integrationConfig.updateMany).not.toHaveBeenCalled();
  });

  it("does not call Aliyun when a required credential is missing", async () => {
    const h = fixture(
      "aliyun",
      { signName: "合成测试签名", templateCode: "SMS_123456789" },
      { accessKeyId: "synthetic-id" },
    );

    await expect(h.service.send("13800138000", "123456", "login")).rejects.toThrow(
      "短信服务暂时无法使用",
    );
    expect(aliyun.sendSms).not.toHaveBeenCalled();
  });

  it("retains the existing webhook provider behavior", async () => {
    const outbound = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", outbound);
    const h = fixture(
      "webhook",
      { webhookUrl: "https://sms.example.invalid/send" },
      { webhookToken: "synthetic-webhook-token" },
    );

    await h.service.send("13800138000", "123456", "bind_mobile");

    expect(outbound).toHaveBeenCalledWith(
      "https://sms.example.invalid/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer synthetic-webhook-token",
        }),
        body: JSON.stringify({
          mobile: "13800138000",
          code: "123456",
          usage: "bind_mobile",
        }),
      }),
    );
    expect(aliyun.sendSms).not.toHaveBeenCalled();
  });
});
