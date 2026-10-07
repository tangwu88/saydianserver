import { Injectable } from "@nestjs/common";
import { IntegrationState } from "@prisma/client";
import {
  businessWritesPaused,
  shouldPauseWorkers,
} from "@saydian/app-contracts";
import { WechatH5AuthService } from "../auth/wechat-h5-auth.service";
import { env } from "../common/environment";
import { safeObject } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";

import {
  configuredGlobalMarkets,
  globalCommerceCountry,
  globalCommerceCurrency,
  globalCommercePaymentChannels,
  globalPaymentConfigurationReady,
} from "./global-commerce-policy";
import { GlobalVerificationDeliveryService } from "../auth/global-verification-delivery.service";
import { wechatMiniConfiguration } from "../common/wechat-mini-config";

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
    private readonly verificationDelivery: GlobalVerificationDeliveryService,
  ) {}

  // Configuration readiness is not a provider verification or a payer identity
  // assertion. Creating a payment still validates the actual User.
  async publicCapabilities(
    locale?: string,
    client: "h5" | "app" | "mini" = "h5",
    product?: unknown,
  ) {
    const readOnly = businessWritesPaused(process.env);
    const outboundPaused = shouldPauseWorkers(process.env);
    const rows = await this.prisma.integrationConfig.findMany({
      where: {
        key: {
          in: ["sms", "wechat_pay", "wechat_pay_app", "alipay", "alipay_app", ...(client === "mini" ? ["wechat_mini"] : [])],
        },
      },
    });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const verificationReady = await this.verificationDelivery.capabilities();
    const configured = (key: string) =>
      byKey.get(key)?.state === IntegrationState.CONFIGURED;
    let mini: Awaited<ReturnType<typeof wechatMiniConfiguration>> | null = null;
    let miniPayment = false;
    if (client === "mini") {
      try { mini = await wechatMiniConfiguration(this.prisma, this.secrets, byKey.get("wechat_mini") ?? null); } catch { mini = null; }
    }

    let officialAppId: string | null = null;
    try {
      officialAppId = (await this.official.configured()).appId;
    } catch {
      officialAppId = null;
    }
    let jsapi = false,
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
          ...(client === "mini" ? { appIdMini: "WECHAT_PAY_APP_ID_MINI" } : {}),
        });
        const config = safeObject(byKey.get("wechat_pay")?.publicConfig);
        jsapi = globalPaymentConfigurationReady("WECHAT_JSAPI", config, secret, env("PUBLIC_BASE_URL", ""))
          && !!officialAppId && secret.appIdOfficial === officialAppId;
        miniPayment = !!mini?.paymentEnabled && mini.appId === secret.appIdMini
          && globalPaymentConfigurationReady("WECHAT_MINI", config, secret, env("PUBLIC_BASE_URL", ""));
      } catch {
        jsapi = false;
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
    if (client === "mini") payments.push({ channel: "wechat_mini", environments: ["mini"],
      ...capability(miniPayment && !outboundPaused, miniPayment && outboundPaused ? "交易维护中" : "小程序支付未启用或凭证未配置一致") });
    {
      const [official, marketConfig] = await Promise.all([
        this.official.globalCapabilities(client === "mini" ? "zh-Hans" : locale, client === "mini" ? undefined : product),
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
        product: official.product,
        consentVersion: official.consentVersion,
        legal: official.legal,
        login: {
          password: { enabled: !readOnly },
          sms: {
            ...capability(
              verificationReady.sms && !readOnly,
              readOnly
                ? "系统维护中"
                : "International SMS verification is not configured.",
            ),
          },
          email: capability(
            verificationReady.email && !readOnly,
            readOnly ? "系统维护中" : "Email verification is not configured.",
          ),
          defaultChannel: "sms",
          wechatH5: official.wechatH5,
          wechatBinding: official.wechatBinding,
          ...(client === "mini" ? { wechatMini: capability(!!mini && !!official.consentVersion && !!official.legal && !readOnly && !outboundPaused,
            readOnly || outboundPaused ? "系统维护中" : !official.consentVersion || !official.legal ? "用户协议和隐私政策尚未发布" : "微信小程序登录未配置") } : {}),
        },
        payments: payments
          .filter(
            (payment) =>
              globalCommercePaymentChannels.some(
                (channel) => channel.toLowerCase() === payment.channel,
              ) &&
              (client === "mini" ? payment.channel === "wechat_mini" : client === "app"
                ? payment.environments.includes("android") ||
                  payment.environments.includes("ios")
                : payment.channel !== "wechat_mini" && !payment.environments.includes("android") &&
                  !payment.environments.includes("ios")),
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
            requiresVerifiedAccount: true,
          },
        },
        maintenance: {
          readOnly,
          ...(readOnly ? { reason: "系统维护中，仅可浏览已有信息" } : {}),
        },
        demo: false,
      };
    }
  }
}

function capability(enabled: boolean, reason: string): Capability {
  return enabled ? { enabled } : { enabled, reason };
}
