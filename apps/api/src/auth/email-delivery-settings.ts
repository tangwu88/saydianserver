import { BadRequestException } from "@nestjs/common";
import { safeObject } from "../common/crypto";
import { emailAddress } from "./wecom-email";
import { aliyunEmailSettings } from "./aliyun-email";

/** Old acceptance must not survive a change of sender, provider or credentials. */
export function emailDeliverySettings(previous: unknown, next: unknown, credentialsChanged: boolean) {
  const before = safeObject(previous), config = { ...safeObject(next) };
  if (["smtpPassword", "accessKeyId", "accessKeySecret"].some(key => Object.hasOwn(config, key))) throw new BadRequestException("凭证必须加密保存，不能放入公开配置");
  if (config.provider === "wecom_smtp") config.fromAddress = emailAddress(config.fromAddress);
  if (config.provider === "aliyun_dm") Object.assign(config, aliyunEmailSettings(config));
  if (["provider", "fromAddress", "accountName", "regionId", "fromAlias"].some(key => before[key] !== config[key]) || credentialsChanged) {
    config.deliveryVerified = false;
  }
  return config;
}
