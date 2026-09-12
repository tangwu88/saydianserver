import { Injectable } from "@nestjs/common";
import { IntegrationState } from "@prisma/client";
import {
  businessWritesPaused,
  shouldPauseWorkers,
} from "@saydian/app-contracts";
import { WechatH5AuthService } from "../auth/wechat-h5-auth.service";
import { env, envBoolean } from "../common/environment";
import { safeObject } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { isGlobalRealm } from "../common/deployment-realm";
import {
  configuredGlobalMarkets,
  globalCommerceCountry,
  globalCommerceCurrency,
  globalCommercePaymentChannels,
  globalPaymentConfigurationReady,
  paymentRsaKey as rsaKey,
  securePaymentEndpoint as secureEndpoint,
} from "./global-commerce-policy";

type Capability = { enabled: boolean; reason?: string };
type PaymentCapability = Capability & {
  channel: string;
  environments: string[];
};

@Injectable()
export class CommerceCapabilitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: IntegrationSecretsService,
    private readonly official: WechatH5AuthService,
  ) {}

  // Configuration readiness is not a provider verification or a payer identity
  // assertion. Creating a payment still validates the actual User.
  async publicCapabilities(locale?: string, client: "h5" | "app" = "h5") {
    const global = isGlobalRealm();
    const readOnly = businessWritesPaused(process.env);
    const outboundPaused = shouldPauseWorkers(process.env);
    const demo =
      process.env.NODE_ENV !== "production" && envBoolean("H5_DEMO_ENABLED");
    const rows = await this.prisma.integrationConfig.findMany({
      where: { key: { in: ["sms", "wechat_pay", "wechat_pay_app", "alipay", "alipay_app"] } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const configured = (key: string) =>
      byKey.get(key)?.state === IntegrationState.CONFIGURED;
    let sms =
      !global &&
      process.env.NODE_ENV !== "production" &&
      envBoolean("ALLOW_TEST_OTP");
    if (!global && !sms && configured("sms")) {
      try {
        const publicConfig = safeObject(byKey.get("sms")?.publicConfig);
        const secret = await this.secrets.resolve("sms", {
          webhookUrl: "SMS_WEBHOOK_URL",
          webhookToken: "SMS_WEBHOOK_TOKEN",
        });
        sms =
          (publicConfig.provider ?? env("SMS_PROVIDER", "disabled")) ===
            "webhook" &&
          !!secret.webhookToken &&
          secureEndpoint(
            String(publicConfig.webhookUrl ?? secret.webhookUrl ?? ""),
          );
      } catch {
        sms = false;
      }
    }
    let officialAppId: string | null = null;
    try {
      officialAppId = (await this.official.configured()).appId;
    } catch {
      officialAppId = null;
    }
    let wechat = false,
      jsapi = false,
      mini = false,
      alipay = false,
      wechatApp = false,
      alipayApp = false;
    if (configured("wechat_pay")) {
      try {
        const secret = await this.secrets.resolve("wechat_pay", {
          merchantId: "WECHAT_PAY_MERCHANT_ID",
          serialNo: "WECHAT_PAY_SERIAL_NO",
          privateKeyPem: "WECHAT_PAY_PRIVATE_KEY_PEM",
          platformPublicKeyPem: "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM",
          platformSerialNo: "WECHAT_PAY_PLATFORM_SERIAL_NO",
          apiV3Key: "WECHAT_PAY_API_V3_KEY",
          appIdOfficial: "WECHAT_PAY_APP_ID_OFFICIAL",
          appIdMini: "WECHAT_PAY_APP_ID_MINI",
        });
        const config = safeObject(byKey.get("wechat_pay")?.publicConfig);
        const notify = String(
          config.notifyUrl ??
            `${env("PUBLIC_BASE_URL", "")}/api/saydian-app/v2/billing/payments/wechat/notify`,
        );
        const merchantReady =
          !!secret.merchantId &&
          !!secret.serialNo &&
          !!secret.platformSerialNo &&
          secret.apiV3Key?.length === 32 &&
          rsaKey(secret.privateKeyPem, true) &&
          rsaKey(secret.platformPublicKeyPem, false) &&
          secureEndpoint(notify);
        // Native/H5 use appIdOfficial; mini uses its own appId. Missing
        // official-account OAuth configuration must not disable existing mini payments.
        wechat =
          merchantReady &&
          /^wx[A-Za-z0-9]{8,64}$/.test(secret.appIdOfficial ?? "");
        mini =
          merchantReady && /^wx[A-Za-z0-9]{8,64}$/.test(secret.appIdMini ?? "");
        jsapi =
          wechat && !!officialAppId && secret.appIdOfficial === officialAppId;
        if (
          global &&
          !globalPaymentConfigurationReady(
            "WECHAT_H5",
            config,
            secret,
            env("PUBLIC_BASE_URL", ""),
          )
        )
          wechat = jsapi = false;
      } catch {
        wechat = false;
        jsapi = false;
        mini = false;
      }
    }
    if (configured("alipay")) {
      try {
        const secret = await this.secrets.resolve("alipay", {
          appId: "ALIPAY_APP_ID",
          privateKeyPem: "ALIPAY_PRIVATE_KEY_PEM",
          publicKeyPem: "ALIPAY_PUBLIC_KEY_PEM",
        });
        const config = safeObject(byKey.get("alipay")?.publicConfig);
        const notify = String(
          config.notifyUrl ??
            `${env("PUBLIC_BASE_URL", "")}/api/saydian-app/v2/billing/payments/alipay/notify`,
        );
        alipay =
          !!secret.appId &&
          rsaKey(secret.privateKeyPem, true) &&
          rsaKey(secret.publicKeyPem, false) &&
          secureEndpoint(notify) &&
          secureEndpoint(
            String(config.gateway ?? "https://openapi.alipay.com/gateway.do"),
          );
        if (global)
          alipay = globalPaymentConfigurationReady(
            "ALIPAY_WAP",
            config,
            secret,
            env("PUBLIC_BASE_URL", ""),
          );
      } catch {
        alipay = false;
      }
    }
    if (configured("wechat_pay_app")) {
      try {
        const secret = await this.secrets.resolve("wechat_pay_app", {
          merchantId: "WECHAT_PAY_APP_MERCHANT_ID",
          serialNo: "WECHAT_PAY_APP_SERIAL_NO",
          privateKeyPem: "WECHAT_PAY_APP_PRIVATE_KEY_PEM",
          platformPublicKeyPem: "WECHAT_PAY_APP_PLATFORM_PUBLIC_KEY_PEM",
          platformSerialNo: "WECHAT_PAY_APP_PLATFORM_SERIAL_NO",
          apiV3Key: "WECHAT_PAY_APP_API_V3_KEY",
          appIdApp: "WECHAT_PAY_APP_ID",
        });
        const config = safeObject(byKey.get("wechat_pay_app")?.publicConfig);
        wechatApp = globalPaymentConfigurationReady(
          "WECHAT_APP",
          config,
          secret,
          env("PUBLIC_BASE_URL", ""),
        );
      } catch {
        wechatApp = false;
      }
    }
    if (configured("alipay_app")) {
      try {
        const secret = await this.secrets.resolve("alipay_app", {
          appId: "ALIPAY_PAY_APP_ID",
          privateKeyPem: "ALIPAY_PAY_APP_PRIVATE_KEY_PEM",
          publicKeyPem: "ALIPAY_PAY_APP_PUBLIC_KEY_PEM",
        });
        const config = safeObject(byKey.get("alipay_app")?.publicConfig);
        alipayApp = globalPaymentConfigurationReady(
          "ALIPAY_APP",
          config,
          secret,
          env("PUBLIC_BASE_URL", ""),
        );
      } catch {
        alipayApp = false;
      }
    }
    const payments: PaymentCapability[] = [
      {
        channel: "wechat_jsapi",
        environments: ["wechat"],
        ...capability(
          jsapi && !outboundPaused,
          jsapi && outboundPaused ? "交易维护中" : "公众号身份或微信支付未配置",
        ),
      },
      {
        channel: "wechat_mini",
        environments: ["mini"],
        ...capability(
          mini && !outboundPaused,
          mini && outboundPaused ? "交易维护中" : "微信小程序支付未配置",
        ),
      },
      {
        channel: "wechat_h5",
        environments: ["browser"],
        ...capability(
          wechat && !outboundPaused,
          wechat && outboundPaused ? "交易维护中" : "微信 H5 支付未配置",
        ),
      },
      {
        channel: "wechat_native",
        environments: ["browser"],
        ...capability(
          wechat && !outboundPaused,
          wechat && outboundPaused ? "交易维护中" : "微信扫码支付未配置",
        ),
      },
      {
        channel: "alipay_wap",
        environments: ["browser"],
        ...capability(
          alipay && !outboundPaused,
          alipay && outboundPaused ? "交易维护中" : "支付宝支付未配置",
        ),
      },
      {
        channel: "alipay_page",
        environments: ["browser"],
        ...capability(
          alipay && !outboundPaused,
          alipay && outboundPaused ? "交易维护中" : "支付宝支付未配置",
        ),
      },
      {
        channel: "wechat_app",
        environments: ["android", "ios"],
        ...capability(
          wechatApp && !outboundPaused,
          wechatApp && outboundPaused ? "交易维护中" : "App 微信支付未配置",
        ),
      },
      {
        channel: "alipay_app",
        environments: ["android", "ios"],
        ...capability(
          alipayApp && !outboundPaused,
          alipayApp && outboundPaused ? "交易维护中" : "App 支付宝支付未配置",
        ),
      },
    ];
    if (global) {
      const [official, marketConfig] = await Promise.all([
        this.official.globalCapabilities(locale),
        this.prisma.commerceBusinessConfig.findUnique({
          where: { key: "global.markets" },
        }),
      ]);
      const checkoutMarket = configuredGlobalMarkets(marketConfig).find(
        (market) => market.commerceEnabled,
      );
      const checkoutAvailable = Boolean(checkoutMarket);
      return {
        realm: "global",
        consentVersion: official.consentVersion,
        legal: official.legal,
        login: {
          password: { enabled: !readOnly },
          sms: {
            enabled: false,
            reason: "Use email or international account sign-in.",
          },
          wechatH5: official.wechatH5,
          wechatBinding: official.wechatBinding,
        },
        payments: payments
          .filter((payment) =>
            globalCommercePaymentChannels.some(
              (channel) => channel.toLowerCase() === payment.channel,
            ) && (client === "app"
              ? payment.environments.includes("android") || payment.environments.includes("ios")
              : !payment.environments.includes("android") && !payment.environments.includes("ios")),
          )
          .map((payment) =>
            checkoutAvailable
              ? payment
              : {
                  ...payment,
                  enabled: false,
                  reason: "当前尚未开放中国大陆人民币结算",
                },
          ),
        checkout: {
          ...capability(
            checkoutAvailable && !readOnly,
            readOnly ? "系统维护中" : "当前尚未开放中国大陆人民币结算",
          ),
          countryCodes: [globalCommerceCountry],
          currency: globalCommerceCurrency,
          ...(checkoutMarket
            ? { currencyExponent: checkoutMarket.currencyExponent }
            : {}),
          minimumCashCents: 1,
          points: {
            supported: checkoutAvailable,
            requiresVerifiedAccount: false,
          },
        },
        maintenance: {
          readOnly,
          ...(readOnly ? { reason: "系统维护中，仅可浏览已有信息" } : {}),
        },
        demo: false,
      };
    }
    return {
      login: {
        password: capability(!readOnly, "系统维护中"),
        sms: capability(
          sms && !readOnly,
          readOnly ? "系统维护中" : "短信服务未配置",
        ),
        wechatH5: capability(
          !!officialAppId && !readOnly,
          readOnly ? "系统维护中" : "微信公众号登录未配置",
        ),
      },
      payments: client === "app"
        ? payments.filter(payment => payment.environments.includes("android") || payment.environments.includes("ios"))
        : payments.filter(payment => !payment.environments.includes("android") && !payment.environments.includes("ios")),
      checkout: {
        minimumCashCents: 1,
        points: { supported: true, requiresVerifiedAccount: true },
      },
      maintenance: {
        readOnly,
        ...(readOnly ? { reason: "系统维护中，仅可浏览已有信息" } : {}),
      },
      demo,
    };
  }
}

function capability(enabled: boolean, reason: string): Capability {
  return enabled ? { enabled } : { enabled, reason };
}
