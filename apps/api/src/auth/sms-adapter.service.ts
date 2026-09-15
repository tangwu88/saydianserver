import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { IntegrationState } from "@prisma/client";
import Dysmsapi20170525, { SendSmsRequest } from "@alicloud/dysmsapi20170525";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import { env } from "../common/environment";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";

@Injectable()
export class SmsAdapterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async send(mobile: string, code: string, usage: string): Promise<void> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "sms" },
    });
    const publicConfig = safeObject(integration?.publicConfig);
    const provider = String(
      publicConfig.provider ?? env("SMS_PROVIDER", "disabled"),
    ).toLowerCase();
    if (provider === "mock" && env("NODE_ENV", "development") !== "production") {
      process.stdout.write(
        `${JSON.stringify({
          level: "info",
          event: "mock_sms_accepted",
          mobileSuffix: mobile.slice(-4),
          usage,
        })}\n`,
      );
      return;
    }
    if (integration?.state !== IntegrationState.CONFIGURED) {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
    const secrets = await this.integrationSecrets.resolve("sms", {
      webhookUrl: "SMS_WEBHOOK_URL",
      webhookToken: "SMS_WEBHOOK_TOKEN",
      accessKeyId: "ALIBABA_CLOUD_ACCESS_KEY_ID",
      accessKeySecret: "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    });
    if (provider === "aliyun") {
      const accessKeyId = secrets.accessKeyId ?? "";
      const accessKeySecret = secrets.accessKeySecret ?? "";
      const signName = String(
        publicConfig.signName ?? env("ALIYUN_SMS_SIGN_NAME", ""),
      ).trim();
      const templateCode = String(
        publicConfig.templateCode ?? env("ALIYUN_SMS_TEMPLATE_CODE", ""),
      ).trim();
      if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
        throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
      }
      const client = new Dysmsapi20170525(
        new $OpenApiUtil.Config({
          accessKeyId,
          accessKeySecret,
          endpoint: "dysmsapi.aliyuncs.com",
          connectTimeout: 5_000,
          readTimeout: 10_000,
        }),
      );
      const response = await client
        .sendSms(
          new SendSmsRequest({
            phoneNumbers: mobile,
            signName,
            templateCode,
            templateParam: JSON.stringify({ code }),
          }),
        )
        .catch(() => null);
      if (response?.body?.code !== "OK") {
        throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
      }
      await markIntegrationVerified(this.prisma, "sms");
      return;
    }
    if (provider !== "webhook") {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
    const url = String(publicConfig.webhookUrl ?? secrets.webhookUrl ?? "");
    const token = secrets.webhookToken ?? "";
    if (!url || !token) {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ mobile, code, usage }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
    await markIntegrationVerified(this.prisma, "sms");
  }
}
