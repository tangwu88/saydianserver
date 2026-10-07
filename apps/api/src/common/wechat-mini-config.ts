import { ServiceUnavailableException } from "@nestjs/common";
import { IntegrationState } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { IntegrationSecretsService } from "./integration-secrets.service";
import { safeObject } from "./crypto";

export async function wechatMiniConfiguration(prisma: PrismaService, secrets: IntegrationSecretsService,
  suppliedRow?: { state: string; publicConfig: unknown } | null) {
  const row = suppliedRow === undefined ? await prisma.integrationConfig.findUnique({ where: { key: "wechat_mini" } }) : suppliedRow;
  if (row?.state !== IntegrationState.CONFIGURED) throw new ServiceUnavailableException("微信小程序尚未配置或已暂停");
  const credentials = await secrets.resolve("wechat_mini", { appId: "WECHAT_MINI_APP_ID", appSecret: "WECHAT_MINI_APP_SECRET" });
  const appId = credentials.appId ?? "", appSecret = credentials.appSecret ?? "";
  if (!/^wx[A-Za-z0-9]{8,64}$/.test(appId) || appSecret.length < 16) throw new ServiceUnavailableException("微信小程序 AppID 或 AppSecret 未配置完整");
  return { appId, appSecret, paymentEnabled: safeObject(row.publicConfig).paymentEnabled === true };
}

export async function assertWechatMiniPayment(prisma: PrismaService, secrets: IntegrationSecretsService, appId: string) {
  const mini = await wechatMiniConfiguration(prisma, secrets);
  if (!mini.paymentEnabled || mini.appId !== appId) throw new ServiceUnavailableException("小程序支付未启用或登录与支付 AppID 不一致");
}
