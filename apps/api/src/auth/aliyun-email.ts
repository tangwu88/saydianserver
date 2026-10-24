import { BadRequestException } from "@nestjs/common";
import { createHmac, randomUUID } from "node:crypto";
import { emailAddress } from "./wecom-email";

// Fixed official endpoints: configuration can never redirect credentials to an arbitrary host.
export const aliyunMailEndpoints: Record<string, string> = {
  "cn-hangzhou": "https://dm.aliyuncs.com/",
  "ap-southeast-1": "https://dm.ap-southeast-1.aliyuncs.com/",
  "ap-southeast-2": "https://dm.ap-southeast-2.aliyuncs.com/",
  "us-east-1": "https://dm.us-east-1.aliyuncs.com/",
  "eu-central-1": "https://dm.eu-central-1.aliyuncs.com/",
};
export type AliyunEmailConfig = {
  accessKeyId: string; accessKeySecret: string; accountName: string;
  regionId: string; fromAlias: string;
};
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export function aliyunMailSignature(params: Record<string, string>, secret: string): string {
  const canonical = Object.keys(params).filter(key => key !== "Signature").sort()
    .map(key => `${encode(key)}=${encode(params[key]!)}`).join("&");
  return createHmac("sha1", `${secret}&`).update(`POST&%2F&${encode(canonical)}`).digest("base64");
}
export function aliyunEmailSettings(config: Record<string, unknown>) {
  const regionId = String(config.regionId ?? "cn-hangzhou");
  const fromAlias = String(config.fromAlias ?? "Say Ring").trim();
  if (!Object.hasOwn(aliyunMailEndpoints, regionId) || !fromAlias || [...fromAlias].length >= 15 || /[\r\n<>]/.test(fromAlias)) {
    throw new BadRequestException("请检查阿里云邮件区域及发信人名称（1至14个字符）");
  }
  return { regionId, fromAlias, accountName: emailAddress(config.accountName) };
}
export async function deliverAliyunEmail(config: AliyunEmailConfig,
  input: { recipient: string; code?: string; locale?: string; test?: boolean }): Promise<void> {
  const settings = aliyunEmailSettings(config);
  const recipient = emailAddress(input.recipient);
  if (!config.accessKeyId || !config.accessKeySecret || (!input.test && !/^\d{6}$/.test(input.code ?? ""))) {
    throw new BadRequestException("邮件发送参数不完整");
  }
  const english = input.locale?.startsWith("en") === true;
  const params: Record<string, string> = {
    Action: "SingleSendMail", Version: "2015-11-23", Format: "JSON",
    AccessKeyId: config.accessKeyId, SignatureMethod: "HMAC-SHA1", SignatureVersion: "1.0",
    SignatureNonce: randomUUID(), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    RegionId: settings.regionId, AccountName: settings.accountName, AddressType: "1",
    ReplyToAddress: "false", ToAddress: recipient, FromAlias: settings.fromAlias,
    Subject: input.test ? "Say Ring 邮箱连接测试" : english ? "Your Say Ring verification code" : "Say Ring 邮箱验证码",
    TextBody: input.test ? "这是一封连接测试邮件，不是登录验证码。确认收到后请在后台完成投递验收。"
      : english ? `Your verification code is ${input.code}. It expires in 5 minutes. Do not share it.`
        : `您的验证码是 ${input.code}，5分钟内有效，请勿向他人透露。如非本人操作，请忽略本邮件。`,
  };
  params.Signature = aliyunMailSignature(params, config.accessKeySecret);
  // No raw provider errors, credentials, recipient or code may escape to logs/clients.
  try {
    const response = await fetch(aliyunMailEndpoints[settings.regionId]!, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(), redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { RequestId?: unknown; EnvId?: unknown; Code?: unknown };
    if (!response.ok || result.Code != null || typeof result.RequestId !== "string" || !result.RequestId ||
      typeof result.EnvId !== "string" || !result.EnvId) throw new Error("Unconfirmed submission");
  } catch {
    throw new Error("Aliyun email submission failed");
  }
}
