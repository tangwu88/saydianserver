import { Injectable } from "@nestjs/common";
import { IntegrationState } from "@prisma/client";
import { getCountries } from "libphonenumber-js";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { safeObject } from "../common/crypto";
import { markIntegrationVerified } from "../common/integration-health";
import {
  globalError,
  type VerificationChannel,
  type VerificationPurpose,
} from "./global-identity";
import { SmsAdapterService } from "./sms-adapter.service";
import { deliverWecomEmail, emailAddress } from "./wecom-email";

const integrationKeys = { email: "email_otp", sms: "sms_global" } as const;

@Injectable()
export class GlobalVerificationDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: IntegrationSecretsService,
    private readonly sms: SmsAdapterService,
  ) {}

  async capabilities() {
    const [email, sms] = await Promise.all([
      this.configuration("email"),
      this.configuration("sms"),
    ]);
    return {
      email: Boolean(email),
      sms: Boolean(sms),
      smsCountries: sms?.countries ?? [],
    };
  }

  async assertAvailable(channel: VerificationChannel, country: string | null) {
    const config = await this.configuration(channel);
    if (
      !config ||
      (channel === "sms" && (!country || !config.countries.includes(country)))
    ) {
      throw globalError(
        503,
        "verification_unavailable",
        "Verification is not available for this address or country yet.",
      );
    }
    return config;
  }

  async send(input: {
    channel: VerificationChannel;
    identifier: string;
    country: string | null;
    code: string;
    purpose: VerificationPurpose;
    locale: string;
    challengeId: string;
  }) {
    const config = await this.assertAvailable(input.channel, input.country);
    if (config.provider === "wecom_smtp") {
      await this.sendSmtp(config, { recipient: input.identifier, code: input.code, locale: input.locale });
      return;
    }
    if (config.provider === "aliyun") {
      if (input.country !== "CN" || !input.identifier.startsWith("+86")) {
        throw globalError(
          503,
          "verification_unavailable",
          "Verification is not available for this address or country yet.",
        );
      }
      await this.sms
        .send(input.identifier.slice(3), input.code, input.purpose)
        .catch(() => {
          throw globalError(
            503,
            "verification_delivery_failed",
            "The verification code could not be sent. Please try again later.",
          );
        });
      return;
    }
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        channel: input.channel,
        recipient: input.identifier,
        code: input.code,
        purpose: input.purpose,
        locale: input.locale,
        expiresIn: 300,
        challengeId: input.challengeId,
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    }).catch(() => null);
    if (!response?.ok)
      throw globalError(
        503,
        "verification_delivery_failed",
        "The verification code could not be sent. Please try again later.",
      );
    await markIntegrationVerified(this.prisma, integrationKeys[input.channel]);
  }

  async sendEmailTest(recipient: unknown) {
    if (process.env.MAINTENANCE_READ_ONLY === "true" || process.env.WORKER_OUTBOUND_PAUSED === "true") {
      throw globalError(503, "verification_unavailable", "系统处于维护或外发暂停状态，暂不发送测试邮件。");
    }
    const address = emailAddress(recipient);
    const config = await this.configuration("email", true);
    if (!config || config.provider !== "wecom_smtp") {
      throw globalError(503, "verification_unavailable", "请先保存企业微信邮箱配置，服务状态选择启用；投递验收可暂时关闭。");
    }
    await this.sendSmtp(config, { recipient: address, test: true });
    return { submitted: true, deliveryVerified: false };
  }

  private async sendSmtp(config: { fromAddress: string; smtpPassword: string }, input: Parameters<typeof deliverWecomEmail>[1]) {
    try {
      await deliverWecomEmail(config, input);
    } catch {
      // Provider errors can include credentials, recipient and raw SMTP responses.
      throw globalError(503, "verification_delivery_failed", "邮件发送失败，请检查邮箱客户端授权码及 SMTP 服务，稍后重试。");
    }
    if (!input.test) await markIntegrationVerified(this.prisma, "email_otp");
  }

  private async configuration(channel: VerificationChannel, allowUnverifiedEmailTest = false) {
    const key = integrationKeys[channel];
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key },
    });
    const config = safeObject(integration?.publicConfig);
    const provider = String(
      config.provider ??
        process.env[
          channel === "email" ? "GLOBAL_EMAIL_PROVIDER" : "GLOBAL_SMS_PROVIDER"
        ] ??
        "disabled",
    ).toLowerCase();
    if (channel === "email" && provider === "wecom_smtp") {
      if (config.provider !== "wecom_smtp" || integration?.state !== IntegrationState.CONFIGURED ||
        (!allowUnverifiedEmailTest && config.deliveryVerified !== true)) return null;
      let fromAddress: string;
      try { fromAddress = emailAddress(config.fromAddress); } catch { return null; }
      const resolved = await this.secrets.resolve(key, { smtpPassword: "GLOBAL_EMAIL_SMTP_PASSWORD" })
        .catch(() => ({}) as Record<string, string>);
      if (!resolved.smtpPassword) return null;
      return { provider: "wecom_smtp" as const, fromAddress, smtpPassword: resolved.smtpPassword, countries: [] as string[] };
    }
    if (provider !== "webhook") {
      if (channel === "sms" && (await this.sms.aliyunReady())) {
        return {
          provider: "aliyun" as const,
          url: "",
          token: "",
          countries: ["CN"],
        };
      }
      return null;
    }
    // Enable only after the operator has tested the provider and its country list.
    if (
      integration?.state !== IntegrationState.CONFIGURED ||
      config.provider !== "webhook" ||
      config.deliveryVerified !== true
    )
      return null;
    const prefix = channel === "email" ? "GLOBAL_EMAIL" : "GLOBAL_SMS";
    const resolved = await this.secrets
      .resolve(key, {
        webhookUrl: `${prefix}_WEBHOOK_URL`,
        webhookToken: `${prefix}_WEBHOOK_TOKEN`,
      })
      .catch(() => ({}) as Record<string, string>);
    const url = String(config.webhookUrl ?? resolved.webhookUrl ?? "");
    const token = resolved.webhookToken ?? "";
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        !token
      )
        return null;
    } catch {
      return null;
    }
    const countries = Array.isArray(config.countries)
      ? [
          ...new Set(
            config.countries
              .map(String)
              .filter((value) =>
                getCountries().some((country) => country === value),
              ),
          ),
        ].sort()
      : [];
    if (channel === "sms" && countries.length === 0) return null;
    return { provider: "webhook" as const, url, token, countries };
  }
}
