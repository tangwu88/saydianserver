import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { IntegrationState, PaymentChannel } from "@prisma/client";
import {
  constants,
  createDecipheriv,
  createSign,
  createVerify,
  randomBytes,
} from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { env } from "../common/environment";
import { safeObject } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";

type IntentForProvider = {
  id: string;
  paymentNo: string;
  amountCents: number;
  currency: string;
  description: string;
  businessId: string;
  channel: PaymentChannel;
};

export type RefundForProvider = {
  refundNo: string;
  paymentNo: string;
  providerTransactionId: string | null;
  amountCents: number;
  totalCents: number;
  currency: string;
  reason: string;
  channel: PaymentChannel;
};

export type ProviderRefundResult = {
  completed: boolean;
  providerRefundId: string | null;
  payload: Record<string, unknown>;
};

@Injectable()
export class PaymentProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async create(
    intent: IntentForProvider,
    context: {
      wechatOpenId?: string | null;
      clientIp?: string;
      appleProductId?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    if (intent.channel === PaymentChannel.APPLE_IAP) {
      return this.appleInvoke(intent, context.appleProductId);
    }
    if (intent.channel.startsWith("WECHAT")) {
      return this.createWechat(intent, context);
    }
    return this.createAlipay(intent);
  }

  async refund(refund: RefundForProvider): Promise<ProviderRefundResult> {
    if (refund.channel === PaymentChannel.APPLE_IAP) {
      throw new ServiceUnavailableException("苹果购买退款由App Store处理");
    }
    if (refund.channel.startsWith("WECHAT")) return this.refundWechat(refund);
    return this.refundAlipay(refund);
  }

  async decodeWechatNotification(
    headers: Record<string, string | undefined>,
    payload: Record<string, unknown>,
    rawBody: Buffer,
  ): Promise<Record<string, unknown>> {
    await this.assertConfigured("wechat_pay");
    const secrets = await this.wechatSecrets();
    const publicKey = secrets.platformPublicKeyPem ?? "";
    const platformSerialNo = secrets.platformSerialNo ?? "";
    const apiV3Key = secrets.apiV3Key ?? "";
    if (!publicKey || !platformSerialNo || Buffer.byteLength(apiV3Key) !== 32) {
      throw new ServiceUnavailableException("微信支付回调暂时无法处理");
    }
    const { timestamp, nonce, signature } = validateWechatNotificationHeaders(
      headers,
      platformSerialNo,
    );
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${timestamp}\n${nonce}\n${rawBody.toString("utf8")}\n`);
    if (!verifier.verify(publicKey, signature, "base64")) {
      throw new BadRequestException("微信支付通知验证失败");
    }
    const resource = safeObject(payload.resource);
    const cipherBytes = Buffer.from(String(resource.ciphertext ?? ""), "base64");
    if (cipherBytes.length <= 16) {
      throw new BadRequestException("微信支付通知内容不完整");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(apiV3Key),
      Buffer.from(String(resource.nonce ?? "")),
    );
    decipher.setAAD(Buffer.from(String(resource.associated_data ?? "")));
    decipher.setAuthTag(cipherBytes.subarray(-16));
    try {
      const decrypted = JSON.parse(
        Buffer.concat([
          decipher.update(cipherBytes.subarray(0, -16)),
          decipher.final(),
        ]).toString("utf8"),
      ) as Record<string, unknown>;
      await markIntegrationVerified(this.prisma, "wechat_pay");
      return decrypted;
    } catch {
      throw new BadRequestException("微信支付通知内容无法读取");
    }
  }

  async verifyAlipayNotification(payload: Record<string, string>): Promise<void> {
    await this.assertConfigured("alipay");
    const publicKey = (await this.alipaySecrets()).publicKeyPem ?? "";
    if (!publicKey) {
      throw new ServiceUnavailableException("支付宝回调暂时无法处理");
    }
    const signature = payload.sign ?? "";
    const unsigned = Object.fromEntries(
      Object.entries(payload).filter(([key]) => !["sign", "sign_type"].includes(key)),
    );
    const verifier = createVerify("RSA-SHA256");
    verifier.update(canonical(unsigned));
    if (!verifier.verify(publicKey, signature, "base64")) {
      throw new BadRequestException("支付宝通知验证失败");
    }
    await markIntegrationVerified(this.prisma, "alipay");
  }

  private async createWechat(
    intent: IntentForProvider,
    context: { wechatOpenId?: string | null; clientIp?: string },
  ): Promise<Record<string, unknown>> {
    const publicConfig = await this.assertConfigured("wechat_pay");
    const secrets = await this.wechatSecrets();
    const merchantId = secrets.merchantId ?? "";
    const serialNo = secrets.serialNo ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    if (!merchantId || !serialNo || !privateKeyPem) {
      throw new ServiceUnavailableException("微信支付暂时无法使用，请稍后再试");
    }
    const appId =
      intent.channel === PaymentChannel.WECHAT_MINI
        ? secrets.appIdMini ?? ""
        : intent.channel === PaymentChannel.WECHAT_APP
          ? secrets.appIdApp ?? ""
          : secrets.appIdOfficial ?? secrets.appIdMini ?? "";
    if (!appId) {
      throw new ServiceUnavailableException("微信支付暂时无法使用，请稍后再试");
    }
    const path = wechatTransactionPath(intent.channel);
    const notifyUrl = String(
      publicConfig.notifyUrl ??
        `${requiredEnv("PUBLIC_BASE_URL").replace(/\/$/, "")}/api/saydian-app/v2/billing/payments/wechat/notify`,
    );
    const body: Record<string, unknown> = {
      appid: appId,
      mchid: merchantId,
      description: intent.description.slice(0, 100),
      out_trade_no: intent.paymentNo,
      notify_url: notifyUrl,
      amount: { total: intent.amountCents, currency: intent.currency },
      attach: intent.businessId,
    };
    if (
      ([PaymentChannel.WECHAT_MINI, PaymentChannel.WECHAT_JSAPI] as PaymentChannel[]).includes(
        intent.channel,
      )
    ) {
      if (!context.wechatOpenId) {
        throw new BadRequestException("当前账号未绑定微信，不能使用此支付方式");
      }
      body.payer = { openid: context.wechatOpenId };
    }
    if (intent.channel === PaymentChannel.WECHAT_H5) {
      body.scene_info = {
        payer_client_ip: context.clientIp || "127.0.0.1",
        h5_info: {
          type: "Wap",
          app_name: "Saydian赛电",
          app_url: env("STOREFRONT_URL", requiredEnv("PUBLIC_BASE_URL")),
        },
      };
    }
    const result = await this.wechatRequest("POST", path, body, {
      merchantId,
      serialNo,
      privateKeyPem,
    });
    if (intent.channel === PaymentChannel.WECHAT_NATIVE) {
      return { type: "QR", codeUrl: String(result.code_url ?? "") };
    }
    if (intent.channel === PaymentChannel.WECHAT_H5) {
      return { type: "REDIRECT", url: String(result.h5_url ?? "") };
    }
    const prepayId = String(result.prepay_id ?? "");
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const nonceStr = randomBytes(16).toString("hex");
    if (intent.channel === PaymentChannel.WECHAT_APP) {
      return {
        type: "APP",
        appid: appId,
        partnerid: merchantId,
        prepayid: prepayId,
        package: "Sign=WXPay",
        noncestr: nonceStr,
        timestamp,
        sign: rsaSign(
          `${appId}\n${timestamp}\n${nonceStr}\n${prepayId}\n`,
          privateKeyPem,
        ),
      };
    }
    const packageValue = `prepay_id=${prepayId}`;
    return {
      type: "JSAPI",
      appId,
      timeStamp: timestamp,
      nonceStr,
      package: packageValue,
      signType: "RSA",
      paySign: rsaSign(
        `${appId}\n${timestamp}\n${nonceStr}\n${packageValue}\n`,
        privateKeyPem,
      ),
    };
  }

  private async createAlipay(
    intent: IntentForProvider,
  ): Promise<Record<string, unknown>> {
    const publicConfig = await this.assertConfigured("alipay");
    const secrets = await this.alipaySecrets();
    const appId = secrets.appId ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    if (!appId || !privateKeyPem) {
      throw new ServiceUnavailableException("支付宝暂时无法使用，请稍后再试");
    }
    const method =
      intent.channel === PaymentChannel.ALIPAY_PAGE
        ? "alipay.trade.page.pay"
        : intent.channel === PaymentChannel.ALIPAY_APP
          ? "alipay.trade.app.pay"
          : "alipay.trade.wap.pay";
    const params: Record<string, string> = {
      app_id: appId,
      method,
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayDate(new Date()),
      version: "1.0",
      notify_url: String(
        publicConfig.notifyUrl ??
          `${requiredEnv("PUBLIC_BASE_URL").replace(/\/$/, "")}/api/saydian-app/v2/billing/payments/alipay/notify`,
      ),
      return_url: String(
        publicConfig.returnUrl ??
          `${env("STOREFRONT_URL", requiredEnv("PUBLIC_BASE_URL"))}/#/orders`,
      ),
      biz_content: JSON.stringify({
        out_trade_no: intent.paymentNo,
        total_amount: (intent.amountCents / 100).toFixed(2),
        subject: intent.description.slice(0, 100),
        product_code:
          intent.channel === PaymentChannel.ALIPAY_PAGE
            ? "FAST_INSTANT_TRADE_PAY"
            : intent.channel === PaymentChannel.ALIPAY_APP
              ? "QUICK_MSECURITY_PAY"
              : "QUICK_WAP_WAY",
        passback_params: intent.businessId,
      }),
    };
    params.sign = rsaSign(canonical(params), privateKeyPem);
    if (intent.channel === PaymentChannel.ALIPAY_APP) {
      return { type: "APP", orderString: new URLSearchParams(params).toString() };
    }
    return {
      type: "FORM",
      url: String(publicConfig.gateway ?? "https://openapi.alipay.com/gateway.do"),
      method: "POST",
      fields: params,
    };
  }

  private async appleInvoke(
    intent: IntentForProvider,
    productIdInput?: string | null,
  ) {
    await this.assertConfigured("apple_iap");
    const productId = String(productIdInput ?? "").trim();
    if (!productId) {
      throw new ServiceUnavailableException("苹果应用内购买暂时无法使用");
    }
    return {
      type: "STOREKIT",
      productId,
      // StoreKit requires a UUID and returns it inside Apple's signed
      // transaction. Binding it to the server-side intent prevents a valid
      // purchase from being replayed against another account or offer.
      appAccountToken: intent.id,
    };
  }

  private async refundWechat(
    refund: RefundForProvider,
  ): Promise<ProviderRefundResult> {
    const publicConfig = await this.assertConfigured("wechat_pay");
    const secrets = await this.wechatSecrets();
    const merchantId = secrets.merchantId ?? "";
    const serialNo = secrets.serialNo ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    if (!merchantId || !serialNo || !privateKeyPem) {
      throw new ServiceUnavailableException("微信退款暂时无法使用，请稍后再试");
    }
    const notifyUrl = String(
      publicConfig.refundNotifyUrl ??
        `${requiredEnv("PUBLIC_BASE_URL").replace(/\/$/, "")}/api/saydian-app/v2/billing/payments/wechat/refund-notify`,
    );
    const payload = await this.wechatRequest(
      "POST",
      "/v3/refund/domestic/refunds",
      {
        ...(refund.providerTransactionId
          ? { transaction_id: refund.providerTransactionId }
          : { out_trade_no: refund.paymentNo }),
        out_refund_no: refund.refundNo,
        reason: refund.reason.slice(0, 80),
        notify_url: notifyUrl,
        amount: {
          refund: refund.amountCents,
          total: refund.totalCents,
          currency: refund.currency,
        },
      },
      { merchantId, serialNo, privateKeyPem },
    );
    return {
      completed: String(payload.status ?? "").toUpperCase() === "SUCCESS",
      providerRefundId: String(payload.refund_id ?? "").trim() || null,
      payload,
    };
  }

  private async refundAlipay(
    refund: RefundForProvider,
  ): Promise<ProviderRefundResult> {
    const publicConfig = await this.assertConfigured("alipay");
    const secrets = await this.alipaySecrets();
    const appId = secrets.appId ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    const publicKeyPem = secrets.publicKeyPem ?? "";
    if (!appId || !privateKeyPem || !publicKeyPem) {
      throw new ServiceUnavailableException("支付宝退款暂时无法使用，请稍后再试");
    }
    const params: Record<string, string> = {
      app_id: appId,
      method: "alipay.trade.refund",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayDate(new Date()),
      version: "1.0",
      biz_content: JSON.stringify({
        ...(refund.providerTransactionId
          ? { trade_no: refund.providerTransactionId }
          : { out_trade_no: refund.paymentNo }),
        refund_amount: (refund.amountCents / 100).toFixed(2),
        refund_reason: refund.reason.slice(0, 256),
        out_request_no: refund.refundNo,
      }),
    };
    params.sign = rsaSign(canonical(params), privateKeyPem);
    const response = await fetch(
      String(publicConfig.gateway ?? "https://openapi.alipay.com/gateway.do"),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const raw = await response.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = safeObject(JSON.parse(raw));
    } catch {
      throw new ServiceUnavailableException("支付宝退款暂时无法完成，请稍后再试");
    }
    const result = safeObject(parsed.alipay_trade_refund_response);
    const signature = String(parsed.sign ?? "");
    const signedContent = extractJsonObject(raw, "alipay_trade_refund_response");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signedContent);
    if (!signature || !signedContent || !verifier.verify(publicKeyPem, signature, "base64")) {
      throw new BadRequestException("支付宝退款响应验证失败");
    }
    if (!response.ok || String(result.code ?? "") !== "10000") {
      throw new ServiceUnavailableException("支付宝退款暂时无法完成，请稍后再试");
    }
    await markIntegrationVerified(this.prisma, "alipay");
    return {
      completed: true,
      providerRefundId: String(result.trade_no ?? refund.providerTransactionId ?? "").trim() || null,
      payload: result,
    };
  }

  private async assertConfigured(key: string): Promise<Record<string, unknown>> {
    const config = await this.prisma.integrationConfig.findUnique({ where: { key } });
    if (!config || config.state !== IntegrationState.CONFIGURED) {
      throw new ServiceUnavailableException("该支付方式暂时无法使用，请稍后再试");
    }
    return safeObject(config.publicConfig);
  }

  private wechatSecrets() {
    return this.integrationSecrets.resolve("wechat_pay", {
      merchantId: "WECHAT_PAY_MERCHANT_ID",
      serialNo: "WECHAT_PAY_SERIAL_NO",
      privateKeyPem: "WECHAT_PAY_PRIVATE_KEY_PEM",
      platformPublicKeyPem: "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM",
      platformSerialNo: "WECHAT_PAY_PLATFORM_SERIAL_NO",
      apiV3Key: "WECHAT_PAY_API_V3_KEY",
      appIdMini: "WECHAT_PAY_APP_ID_MINI",
      appIdApp: "WECHAT_PAY_APP_ID_APP",
      appIdOfficial: "WECHAT_PAY_APP_ID_OFFICIAL",
    });
  }

  private alipaySecrets() {
    return this.integrationSecrets.resolve("alipay", {
      appId: "ALIPAY_APP_ID",
      privateKeyPem: "ALIPAY_PRIVATE_KEY_PEM",
      publicKeyPem: "ALIPAY_PUBLIC_KEY_PEM",
    });
  }

  private async wechatRequest(
    method: string,
    path: string,
    body: unknown,
    credentials: { merchantId: string; serialNo: string; privateKeyPem: string },
  ): Promise<Record<string, unknown>> {
    const bodyText = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const nonce = randomBytes(16).toString("hex");
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyText}\n`;
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${credentials.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${credentials.serialNo}",signature="${rsaSign(message, credentials.privateKeyPem)}"`;
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization,
      },
      body: bodyText,
      signal: AbortSignal.timeout(20_000),
    });
    const result = safeObject(await response.json().catch(() => ({})));
    if (!response.ok) {
      throw new ServiceUnavailableException("微信支付暂时无法使用，请稍后再试");
    }
    await markIntegrationVerified(this.prisma, "wechat_pay");
    return result;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException("支付服务暂时无法使用，请稍后再试");
  return value;
}

function wechatTransactionPath(channel: PaymentChannel): string {
  if (channel === PaymentChannel.WECHAT_H5) return "/v3/pay/transactions/h5";
  if (channel === PaymentChannel.WECHAT_NATIVE) return "/v3/pay/transactions/native";
  if (channel === PaymentChannel.WECHAT_APP) return "/v3/pay/transactions/app";
  return "/v3/pay/transactions/jsapi";
}

function canonical(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export function validateWechatNotificationHeaders(
  headers: Record<string, string | undefined>,
  expectedSerialNo: string,
  nowMs = Date.now(),
) {
  const timestamp = String(headers["wechatpay-timestamp"] ?? "").trim();
  const nonce = String(headers["wechatpay-nonce"] ?? "").trim();
  const signature = String(headers["wechatpay-signature"] ?? "").trim();
  const serialNo = String(headers["wechatpay-serial"] ?? "").trim();
  const timestampSeconds = /^\d+$/.test(timestamp) ? Number(timestamp) : Number.NaN;
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(nowMs / 1_000) - timestampSeconds) > 300
  ) {
    throw new BadRequestException("微信支付通知已过期或时间不正确");
  }
  if (!nonce || nonce.length > 64 || !signature) {
    throw new BadRequestException("微信支付通知头不完整");
  }
  if (
    !serialNo ||
    serialNo.toUpperCase() !== expectedSerialNo.trim().toUpperCase()
  ) {
    throw new BadRequestException("微信支付通知证书不匹配");
  }
  return { timestamp, nonce, signature };
}

function rsaSign(message: string, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  return signer.sign(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING },
    "base64",
  );
}

function formatAlipayDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function extractJsonObject(raw: string, key: string): string {
  const marker = `"${key}":`;
  const markerIndex = raw.indexOf(marker);
  if (markerIndex < 0) return "";
  const start = raw.indexOf("{", markerIndex + marker.length);
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }
  return "";
}
