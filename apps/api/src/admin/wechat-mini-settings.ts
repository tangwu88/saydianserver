import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { safeObject } from "../common/crypto";
import { globalPaymentConfigurationReady } from "../commerce/global-commerce-policy";

/** Validate before any write: the existing User OpenID supports one mini AppID. */
export async function validateWechatMiniSettings(prisma: PrismaService, secrets: IntegrationSecretsService, body: Record<string, unknown>, state: string) {
  const previous = await prisma.integrationConfig.findUnique({ where: { key: "wechat_mini" } });
  if ((body.secrets !== undefined || body.clearSecrets === true) && previous?.state === "CONFIGURED") throw new ConflictException("请先暂停小程序服务并保存，再替换或清除凭证");
  const config = safeObject(body.publicConfig), allowed = ["paymentEnabled", "requestDomains", "uploadDomains", "downloadDomains"];
  if (Object.keys(config).some(key => !allowed.includes(key))) throw new BadRequestException("小程序公开配置包含不支持的字段，凭证须加密保存");
  if (config.paymentEnabled != null && typeof config.paymentEnabled !== "boolean") throw new BadRequestException("小程序支付开关必须为布尔值");
  for (const key of allowed.slice(1)) {
    const domains = config[key];
    if (domains != null && (!Array.isArray(domains) || domains.length > 30 || domains.some(value => typeof value !== "string" || !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/i.test(value)))) throw new BadRequestException("合法域名请填写域名列表，不含协议、端口、路径或通配符");
  }
  const stored = await secrets.read("wechat_mini");
  const next = body.clearSecrets === true ? {} : body.secrets === undefined ? stored : safeObject(body.secrets);
  if (Object.keys(next).some(key => !["appId", "appSecret"].includes(key))) throw new BadRequestException("小程序凭证字段不正确");
  const appId = String(next.appId ?? process.env.WECHAT_MINI_APP_ID ?? "").trim(), appSecret = String(next.appSecret ?? process.env.WECHAT_MINI_APP_SECRET ?? "").trim();
  if ((state === "CONFIGURED" || body.secrets !== undefined) && (!/^wx[A-Za-z0-9]{8,64}$/.test(appId) || appSecret.length < 16)) throw new BadRequestException("请填写完整的小程序 AppID 和 AppSecret");
  if (appId && body.secrets !== undefined) {
    const oldAppId = String(stored.appId ?? process.env.WECHAT_MINI_APP_ID ?? "").trim();
    const legacy = oldAppId ? {} : await secrets.read("wechat_pay");
    const oldIdentity = oldAppId || String(legacy.appIdMini ?? process.env.WECHAT_PAY_APP_ID_MINI ?? "").trim();
    if (appId !== oldIdentity && await prisma.user.count({ where: { wechatOpenId: { not: null } } })) throw new ConflictException("已有小程序身份，不能更换 AppID；请先独立核验旧账号映射");
  }
  if (state === 'CONFIGURED' && config.paymentEnabled === true) {
    const pay = await prisma.integrationConfig.findUnique({ where: { key: 'wechat_pay' } });
    const merchant = await secrets.resolve('wechat_pay', {
      appIdMini: 'WECHAT_PAY_APP_ID_MINI', merchantId: 'WECHAT_PAY_MERCHANT_ID', serialNo: 'WECHAT_PAY_SERIAL_NO',
      platformSerialNo: 'WECHAT_PAY_PLATFORM_SERIAL_NO', apiV3Key: 'WECHAT_PAY_API_V3_KEY', privateKeyPem: 'WECHAT_PAY_PRIVATE_KEY_PEM', platformPublicKeyPem: 'WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM',
    });
    if (pay?.state !== 'CONFIGURED' || merchant.appIdMini !== appId || !globalPaymentConfigurationReady('WECHAT_MINI', safeObject(pay.publicConfig), merchant, process.env.PUBLIC_BASE_URL || '')) {
      throw new BadRequestException('请先配置同一 AppID 的微信支付商户和回调，再启用小程序支付');
    }
  }
}
