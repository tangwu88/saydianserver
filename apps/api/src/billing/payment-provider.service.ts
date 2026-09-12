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
import QRCode from "qrcode";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { markIntegrationVerified } from "../common/integration-health";
import { isGlobalRealm } from "../common/deployment-realm";
import { globalError } from "../auth/global-identity";
import { globalCommerceCurrency, globalCommercePaymentChannels, globalPaymentConfigurationReady } from "../commerce/global-commerce-policy";
import { requireGlobalWechatH5 } from "../auth/global-wechat-policy";
import { officialRedirectUri } from "../auth/wechat-h5-auth.service";

type IntentForProvider = {
  id: string;
  userId?: string;
  businessType?: string;
  paymentNo: string;
  amountCents: number;
  currency: string;
  description: string;
  businessId: string;
  channel: PaymentChannel;
};

type WechatPaymentForQuery = {
  paymentNo: string;
  channel: PaymentChannel;
  providerMerchantId: string | null;
};

type AlipayPaymentForQuery = {
  paymentNo: string;
  channel: PaymentChannel;
  providerAppId: string | null;
};

export type PaymentForClose = {
  paymentNo: string;
  channel: PaymentChannel;
  providerMerchantId: string | null;
  providerAppId: string | null;
};

/** Validate before reserving a new intent and again immediately before dispatch. */
export function assertGlobalPaymentSupported(intent: { channel: PaymentChannel; businessType?: string; currency: string }) {
  assertGlobalPaymentScope(intent);
  if (isGlobalRealm() && intent.channel !== PaymentChannel.APPLE_IAP && intent.currency !== globalCommerceCurrency) {
    throw globalError(503, "payment_unavailable", "当前仅支持人民币商城订单支付。");
  }
}

export function assertGlobalPaymentScope(intent: { channel: PaymentChannel; businessType?: string }) {
  if (!isGlobalRealm() || intent.channel === PaymentChannel.APPLE_IAP) return;
  if (intent.businessType !== "COMMERCE_ORDER" ||
      !globalCommercePaymentChannels.some(channel => channel === intent.channel)) {
    throw globalError(503, "payment_unavailable", "当前仅支持人民币商城订单的微信支付或支付宝支付。");
  }
}

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
  amountCents: number;
  refundNo: string;
  paymentNo: string;
  providerTransactionId: string;
  currency: string | null;
  payload: Record<string, unknown>;
};

@Injectable()
export class PaymentProviderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async identity(channel: PaymentChannel): Promise<{ merchantId: string | null; appId: string | null }> {
    if (channel === PaymentChannel.APPLE_IAP || channel === PaymentChannel.OFFLINE_MANUAL) return { merchantId: null, appId: null };
    const config = await this.assertConfigured(channel.startsWith("WECHAT") ? "wechat_pay" : "alipay");
    if (channel.startsWith("WECHAT")) {
      const secrets = await this.wechatSecrets();
      const appId = channel === PaymentChannel.WECHAT_APP ? secrets.appIdApp : channel === PaymentChannel.WECHAT_MINI ? secrets.appIdMini : secrets.appIdOfficial;
      if (!secrets.merchantId || !appId) throw new ServiceUnavailableException("微信支付商户或应用未配置");
      if (isGlobalRealm()) {
        this.assertGlobalConfiguration(channel, config, secrets);
        if (channel === PaymentChannel.WECHAT_JSAPI) await this.assertGlobalOfficialApp(appId);
      }
      return { merchantId: secrets.merchantId, appId };
    }
    const secrets = await this.alipaySecrets();
    if (!secrets.appId) throw new ServiceUnavailableException("支付宝应用未配置");
    if (isGlobalRealm()) this.assertGlobalConfiguration(channel, config, secrets);
    return { merchantId: null, appId: secrets.appId };
  }

  private assertGlobalConfiguration(channel: PaymentChannel, config: Record<string, unknown>, secrets: Record<string, string | undefined>) {
    if (!globalPaymentConfigurationReady(channel, config, secrets, env("PUBLIC_BASE_URL", ""))) {
      throw new ServiceUnavailableException("支付商户、验签凭据或安全回调地址尚未配置完整");
    }
  }

  private async assertGlobalOfficialApp(appId: string) {
    requireGlobalWechatH5();
    const config = await this.assertConfigured("wechat_official");
    const secret = await this.integrationSecrets.resolve("wechat_official", { appId: "WECHAT_OFFICIAL_APP_ID", appSecret: "WECHAT_OFFICIAL_APP_SECRET" });
    if ((secret.appId ?? String(config.appId ?? "")).trim() !== appId || (secret.appSecret ?? "").trim().length < 16) {
      throw new ServiceUnavailableException("公众号身份与微信支付应用尚未配置一致");
    }
    officialRedirectUri(String(config.redirectUri ?? env("WECHAT_OFFICIAL_REDIRECT_URI", "")), env("COMMERCE_STOREFRONT_URL", ""));
  }

  async assertIdentity(intent: { channel: PaymentChannel; providerMerchantId: string | null; providerAppId: string | null }) {
    if (intent.channel === PaymentChannel.APPLE_IAP || intent.channel === PaymentChannel.OFFLINE_MANUAL) return;
    const identity = await this.identity(intent.channel);
    if (!intent.providerAppId || intent.providerAppId !== identity.appId ||
      (intent.channel.startsWith("WECHAT") && (!intent.providerMerchantId || intent.providerMerchantId !== identity.merchantId))) {
      throw new BadRequestException("原交易商户或应用与当前配置未核验一致，禁止重新发起资金请求");
    }
  }

  // Also call before reserving a JSAPI PaymentIntent so missing identity does
  // not leave an order with an un-dispatchable pending relation.
  async resolveOfficialPayer(userId: string, appId: string): Promise<string> {
    const identity = await this.prisma.wechatOfficialIdentity.findUnique({
      where: { userId_appId: { userId, appId } },
      include: { user: { select: { status: true, mobileVerifiedAt: true, emailVerifiedAt: true } } },
    });
    if (!identity || identity.user.status !== "ACTIVE" || !(identity.user.mobileVerifiedAt || (isGlobalRealm() && identity.user.emailVerifiedAt))) {
      throw new BadRequestException(isGlobalRealm() ? "请先在当前公众号中授权并验证邮箱或手机号" : "请先在当前公众号中授权并验证手机号");
    }
    return identity.openId;
  }

  async create(
    intent: IntentForProvider,
    context: {
      wechatOpenId?: string | null;
      clientIp?: string;
      appleProductId?: string | null;
    },
  ): Promise<Record<string, unknown>> {
    if (intent.channel === PaymentChannel.OFFLINE_MANUAL) throw new ServiceUnavailableException("线下收款只能由超级管理员在订单详情中确认");
    assertGlobalPaymentSupported(intent);
    // A direct service caller cannot bypass the public capability's credential checks.
    if (isGlobalRealm() && intent.channel !== PaymentChannel.APPLE_IAP) await this.identity(intent.channel);
    if (intent.channel === PaymentChannel.APPLE_IAP) {
      return this.appleInvoke(intent, context.appleProductId);
    }
    if (intent.channel.startsWith("WECHAT")) {
      return this.createWechat(intent, context);
    }
    return this.createAlipay(intent);
  }

  async refund(refund: RefundForProvider): Promise<ProviderRefundResult> {
    if (refund.channel === PaymentChannel.OFFLINE_MANUAL) {
      throw new ServiceUnavailableException("线下收款不会调用线上退款渠道；请先在线下完成退款并由财务登记");
    }
    if (refund.channel === PaymentChannel.APPLE_IAP) {
      throw new ServiceUnavailableException("苹果购买退款由App Store处理");
    }
    if (refund.channel.startsWith("WECHAT")) return this.refundWechat(refund);
    return this.refundAlipay(refund);
  }

  async closePayment(intent: PaymentForClose): Promise<Record<string, unknown>> {
    if (intent.channel === PaymentChannel.OFFLINE_MANUAL) {
      throw new BadRequestException("线下收款没有可关闭的在线支付");
    }
    if (intent.channel === PaymentChannel.APPLE_IAP) {
      throw new ServiceUnavailableException("苹果应用内购买不能由商城后台关单");
    }
    await this.assertIdentity(intent);
    return intent.channel.startsWith("WECHAT")
      ? this.closeWechatPayment(intent)
      : this.closeAlipayPayment(intent);
  }

  async queryWechatPayment(
    intent: WechatPaymentForQuery,
  ): Promise<Record<string, unknown>> {
    if (!intent.channel.startsWith("WECHAT")) {
      throw new BadRequestException("当前支付记录不是微信支付");
    }
    await this.assertConfigured("wechat_pay");
    const secrets = await this.wechatSecrets();
    const merchantId = secrets.merchantId ?? "";
    const serialNo = secrets.serialNo ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    if (!merchantId || !serialNo || !privateKeyPem) {
      throw new ServiceUnavailableException("微信支付暂时无法查询，请稍后再试");
    }
    if (!intent.providerMerchantId || intent.providerMerchantId !== merchantId) {
      throw new BadRequestException("原交易商户与当前微信支付配置不一致");
    }
    const paymentNo = providerText(intent.paymentNo, "微信支付单号");
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(paymentNo)}?mchid=${encodeURIComponent(merchantId)}`;
    return this.wechatRequest("GET", path, undefined, {
      merchantId,
      serialNo,
      privateKeyPem,
    });
  }

  async queryAlipayPayment(
    intent: AlipayPaymentForQuery,
  ): Promise<Record<string, unknown>> {
    if (!intent.channel.startsWith("ALIPAY")) {
      throw new BadRequestException("当前支付记录不是支付宝支付");
    }
    const publicConfig = await this.assertConfigured("alipay");
    const secrets = await this.alipaySecrets();
    const appId = secrets.appId ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    const publicKeyPem = secrets.publicKeyPem ?? "";
    if (!appId || !privateKeyPem || !publicKeyPem) {
      throw new ServiceUnavailableException("支付宝支付暂时无法查询，请稍后再试");
    }
    if (!intent.providerAppId || intent.providerAppId !== appId) {
      throw new BadRequestException("原交易应用与当前支付宝配置不一致");
    }
    const params: Record<string, string> = {
      app_id: appId,
      method: "alipay.trade.query",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayDate(new Date()),
      version: "1.0",
      biz_content: JSON.stringify({ out_trade_no: providerText(intent.paymentNo, "支付宝支付单号") }),
    };
    params.sign = rsaSign(canonical(params), privateKeyPem);
    const response = await fetch(
      trustedPaymentUrl(String(publicConfig.gateway ?? "https://openapi.alipay.com/gateway.do"), "alipay"),
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
      throw new ServiceUnavailableException("支付宝支付状态暂时无法查询，请稍后再试");
    }
    const result = safeObject(parsed.alipay_trade_query_response);
    const signature = String(parsed.sign ?? "");
    const signedContent = extractJsonObject(raw, "alipay_trade_query_response");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signedContent);
    if (!signature || !signedContent || !verifier.verify(publicKeyPem, signature, "base64")) {
      throw new BadRequestException("支付宝查单响应验证失败");
    }
    if (!response.ok) {
      throw new ServiceUnavailableException("支付宝支付状态暂时无法查询，请稍后再试");
    }
    if (String(result.code ?? "") === "10000") {
      await markIntegrationVerified(this.prisma, "alipay");
    }
    return result;
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
          : secrets.appIdOfficial ?? "";
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
      const payerOpenId = intent.channel === PaymentChannel.WECHAT_JSAPI
        ? (intent.userId ? await this.resolveOfficialPayer(intent.userId, appId) : null)
        : context.wechatOpenId;
      if (!payerOpenId) {
        throw new BadRequestException("当前账号未绑定微信，不能使用此支付方式");
      }
      body.payer = { openid: payerOpenId };
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
      const codeUrl = String(result.code_url ?? "");
      assertNativeCodeUrl(codeUrl);
      return { type: "QR", codeUrl, qrDataUrl: await QRCode.toDataURL(codeUrl, { width: 320, margin: 2 }) };
    }
    if (intent.channel === PaymentChannel.WECHAT_H5) {
      const url = trustedPaymentUrl(String(result.h5_url ?? ""), "wechat");
      if (intent.businessType === "COMMERCE_ORDER") url.searchParams.set("redirect_url", commercePaymentReturnUrl(intent.businessId));
      return { type: "REDIRECT", url: url.toString() };
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
        intent.businessType === "COMMERCE_ORDER"
          ? commerceAlipayReturnUrl(intent.businessId)
          : publicConfig.returnUrl ?? `${env("STOREFRONT_URL", requiredEnv("PUBLIC_BASE_URL"))}/#/orders`,
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
      url: trustedPaymentUrl(String(publicConfig.gateway ?? "https://openapi.alipay.com/gateway.do"), "alipay").toString(),
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
    return parseWechatRefundResponse(payload, refund);
  }

  private async closeWechatPayment(intent: PaymentForClose): Promise<Record<string, unknown>> {
    await this.assertConfigured("wechat_pay");
    const secrets = await this.wechatSecrets();
    const merchantId = secrets.merchantId ?? "";
    const serialNo = secrets.serialNo ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    if (!merchantId || !serialNo || !privateKeyPem) {
      throw new ServiceUnavailableException("微信支付暂时无法关单，请稍后再试");
    }
    if (!intent.providerMerchantId || intent.providerMerchantId !== merchantId) {
      throw new BadRequestException("原交易商户与当前微信支付配置不一致");
    }
    const paymentNo = providerText(intent.paymentNo, "微信支付单号");
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(paymentNo)}/close`;
    const bodyText = JSON.stringify({ mchid: merchantId });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const nonce = randomBytes(16).toString("hex");
    const message = `POST\n${path}\n${timestamp}\n${nonce}\n${bodyText}\n`;
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${rsaSign(message, privateKeyPem)}"`;
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization,
      },
      body: bodyText,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 204) {
      await response.text();
      throw new ServiceUnavailableException("微信支付关单未确认，请先查单并稍后重试");
    }
    await markIntegrationVerified(this.prisma, "wechat_pay");
    return { provider: "wechat", out_trade_no: paymentNo, closed: true };
  }

  private async closeAlipayPayment(intent: PaymentForClose): Promise<Record<string, unknown>> {
    const publicConfig = await this.assertConfigured("alipay");
    const secrets = await this.alipaySecrets();
    const appId = secrets.appId ?? "";
    const privateKeyPem = secrets.privateKeyPem ?? "";
    const publicKeyPem = secrets.publicKeyPem ?? "";
    if (!appId || !privateKeyPem || !publicKeyPem) {
      throw new ServiceUnavailableException("支付宝暂时无法关单，请稍后再试");
    }
    if (!intent.providerAppId || intent.providerAppId !== appId) {
      throw new BadRequestException("原交易应用与当前支付宝配置不一致");
    }
    const paymentNo = providerText(intent.paymentNo, "支付宝支付单号");
    const params: Record<string, string> = {
      app_id: appId,
      method: "alipay.trade.close",
      format: "JSON",
      charset: "utf-8",
      sign_type: "RSA2",
      timestamp: formatAlipayDate(new Date()),
      version: "1.0",
      biz_content: JSON.stringify({ out_trade_no: paymentNo }),
    };
    params.sign = rsaSign(canonical(params), privateKeyPem);
    const response = await fetch(
      trustedPaymentUrl(String(publicConfig.gateway ?? "https://openapi.alipay.com/gateway.do"), "alipay"),
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
      throw new ServiceUnavailableException("支付宝关单未确认，请先查单并稍后重试");
    }
    const result = safeObject(parsed.alipay_trade_close_response);
    const signature = String(parsed.sign ?? "");
    const signedContent = extractJsonObject(raw, "alipay_trade_close_response");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(signedContent);
    if (!signature || !signedContent || !verifier.verify(publicKeyPem, signature, "base64")) {
      throw new BadRequestException("支付宝关单响应验证失败");
    }
    if (!response.ok || String(result.code ?? "") !== "10000") {
      throw new ServiceUnavailableException("支付宝关单未确认，请先查单并稍后重试");
    }
    if (result.out_trade_no !== undefined && providerText(result.out_trade_no, "支付宝支付单号") !== paymentNo) {
      throw new BadRequestException("支付宝关单响应与原支付记录不匹配");
    }
    await markIntegrationVerified(this.prisma, "alipay");
    return { ...result, provider: "alipay", closed: true };
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
    const refundResult = parseAlipayRefundResponse(result, refund);
    await markIntegrationVerified(this.prisma, "alipay");
    return refundResult;
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
    body: unknown | undefined,
    credentials: { merchantId: string; serialNo: string; privateKeyPem: string },
  ): Promise<Record<string, unknown>> {
    const responseVerification = await this.wechatSecrets();
    if (!responseVerification.platformPublicKeyPem || !responseVerification.platformSerialNo) {
      throw new ServiceUnavailableException("微信响应验签配置缺失，不能发起交易请求");
    }
    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const nonce = randomBytes(16).toString("hex");
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyText}\n`;
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${credentials.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${credentials.serialNo}",signature="${rsaSign(message, credentials.privateKeyPem)}"`;
    const request: RequestInit = {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        accept: "application/json",
        authorization,
      },
      signal: AbortSignal.timeout(20_000),
    };
    if (body !== undefined) request.body = bodyText;
    const response = await fetch(`https://api.mch.weixin.qq.com${path}`, request);
    const raw = await response.text();
    if (!response.ok) {
      throw new ServiceUnavailableException("微信支付暂时无法使用，请稍后再试");
    }
    const result = verifyWechatResponse(raw, response.headers, responseVerification.platformPublicKeyPem, responseVerification.platformSerialNo);
    await markIntegrationVerified(this.prisma, "wechat_pay");
    return result;
  }
}

/** Parses only authenticated provider payloads; never substitutes expected money or transaction IDs. */
export function parseWechatRefundResponse(payload: Record<string, unknown>, request: RefundForProvider): ProviderRefundResult {
  const amount = safeObject(payload.amount);
  const amountCents = providerIntegerCents(amount.refund);
  const totalCents = providerIntegerCents(amount.total);
  const refundNo = providerText(payload.out_refund_no, "微信退款请求号");
  const paymentNo = providerText(payload.out_trade_no, "微信原支付单号");
  const providerTransactionId = providerText(payload.transaction_id, "微信原渠道交易号");
  const providerRefundId = providerText(payload.refund_id, "微信渠道退款号");
  const currency = providerText(amount.currency, "微信退款币种");
  const status = providerText(payload.status, "微信退款状态");
  if (!["SUCCESS", "PROCESSING", "CLOSED", "ABNORMAL"].includes(status)) throw new BadRequestException("微信退款响应状态未知，需核对原退款");
  assertRefundBinding(request, { refundNo, paymentNo, providerTransactionId, amountCents, currency });
  if (totalCents !== request.totalCents) throw new BadRequestException("微信退款响应原交易金额不一致");
  return { completed: status === "SUCCESS", amountCents, refundNo, paymentNo, providerTransactionId, providerRefundId, currency, payload };
}

export function parseAlipayRefundResponse(payload: Record<string, unknown>, request: RefundForProvider): ProviderRefundResult {
  if (payload.code !== "10000") throw new BadRequestException("支付宝退款响应不是成功结果");
  const amountCents = providerYuanToCents(payload.refund_fee);
  const paymentNo = providerText(payload.out_trade_no, "支付宝原支付单号");
  const providerTransactionId = providerText(payload.trade_no, "支付宝原渠道交易号");
  // This API may omit out_request_no. Its verified synchronous response is bound
  // to the exact request sent above; no money or original transaction is inferred.
  const refundNo = payload.out_request_no === undefined ? request.refundNo : providerText(payload.out_request_no, "支付宝退款请求号");
  const currency = payload.refund_currency === undefined ? null : providerText(payload.refund_currency, "支付宝退款币种");
  assertRefundBinding(request, { refundNo, paymentNo, providerTransactionId, amountCents, currency });
  return { completed: true, amountCents, refundNo, paymentNo, providerTransactionId,
    providerRefundId: `alipay:${encodeURIComponent(providerTransactionId)}:${encodeURIComponent(refundNo)}`, currency, payload };
}

function assertRefundBinding(request: RefundForProvider, result: Pick<ProviderRefundResult, "refundNo" | "paymentNo" | "providerTransactionId" | "amountCents" | "currency">) {
  if (result.refundNo !== request.refundNo || result.paymentNo !== request.paymentNo ||
    (request.providerTransactionId && result.providerTransactionId !== request.providerTransactionId)) throw new BadRequestException("退款响应与原退款请求或支付交易不匹配");
  if (result.amountCents !== request.amountCents) throw new BadRequestException("退款响应实际金额不一致");
  if (result.currency && result.currency !== request.currency) throw new BadRequestException("退款响应币种不一致");
}

export function trustedPaymentUrl(value: string, provider: "wechat" | "alipay"): URL {
  try {
    const url = new URL(value);
    const hosts = provider === "wechat" ? ["wx.tenpay.com", "payapp.weixin.qq.com"] :
      ["openapi.alipay.com", "openapi-sandbox.dl.alipaydev.com", "openapi.alipaydev.com"];
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") ||
        !hosts.includes(url.hostname) || (provider === "alipay" && url.pathname !== "/gateway.do")) throw new Error("untrusted");
    return url;
  } catch { throw new BadRequestException("支付渠道返回了不可信的跳转地址"); }
}

export function commercePaymentReturnUrl(orderId: string): string {
  try {
    const url = new URL(env("COMMERCE_STOREFRONT_URL", ""));
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:"))) throw new Error("untrusted");
    url.pathname = isGlobalRealm() ? "/global/saidian-mall/" : "/saidian-mall/";
    url.search = "";
    url.hash = `/pages/order-detail/index?id=${encodeURIComponent(orderId)}`;
    return url.toString();
  } catch { throw new ServiceUnavailableException("商城支付返回地址未配置"); }
}

export function commerceAlipayReturnUrl(orderId: string): string {
  try {
    const url = new URL(requiredEnv("PUBLIC_BASE_URL"));
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" &&
        !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:"))) throw new Error("untrusted");
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/saydian-app/v2/billing/payments/alipay/return/${encodeURIComponent(orderId)}`;
    return url.toString();
  } catch { throw new ServiceUnavailableException("支付宝支付返回地址未配置"); }
}

function assertNativeCodeUrl(value: string): void {
  try {
    const url = new URL(value);
    if (value.length > 2048 || url.protocol !== "weixin:" || url.hostname !== "wxpay" ||
        url.pathname !== "/bizpayurl" || url.username || url.password || url.hash) throw new Error("untrusted");
  } catch { throw new BadRequestException("微信支付二维码内容无效"); }
}

function providerText(value: unknown, label: string) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 256 || /\s/.test(value)) throw new BadRequestException(`${label}缺失或格式无效`);
  return value;
}

function providerIntegerCents(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new BadRequestException("供应商退款金额缺失或不是正整数分");
  return value;
}

function providerYuanToCents(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) throw new BadRequestException("支付宝实际退款金额缺失或格式无效");
  const [yuan, decimal = ""] = value.split(".");
  const cents = BigInt(yuan!) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (cents <= 0 || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException("支付宝实际退款金额超出范围");
  return Number(cents);
}

export function verifyWechatResponse(raw: string, headers: Headers, publicKey: string, serialNo: string): Record<string, unknown> {
  const verifiedHeaders = validateWechatNotificationHeaders({
    "wechatpay-timestamp": headers.get("Wechatpay-Timestamp") ?? undefined,
    "wechatpay-nonce": headers.get("Wechatpay-Nonce") ?? undefined,
    "wechatpay-signature": headers.get("Wechatpay-Signature") ?? undefined,
    "wechatpay-serial": headers.get("Wechatpay-Serial") ?? undefined,
  }, serialNo);
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${verifiedHeaders.timestamp}\n${verifiedHeaders.nonce}\n${raw}\n`);
  if (!verifier.verify(publicKey, verifiedHeaders.signature, "base64")) throw new BadRequestException("微信交易响应签名验证失败");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    return parsed as Record<string, unknown>;
  } catch { throw new BadRequestException("微信交易响应JSON无效"); }
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
