import { BadRequestException } from "@nestjs/common";
import { safeObject } from "../common/crypto";
import { emailAddress } from "./wecom-email";

/** Old acceptance must not survive a change of sender, provider or credentials. */
export function emailDeliverySettings(previous: unknown, next: unknown, credentialsChanged: boolean) {
  const before = safeObject(previous), config = { ...safeObject(next) };
  if (Object.hasOwn(config, "smtpPassword")) throw new BadRequestException("客户端专用密码必须加密保存，不能放入公开配置");
  if (config.provider === "wecom_smtp") config.fromAddress = emailAddress(config.fromAddress);
  if (before.provider !== config.provider || before.fromAddress !== config.fromAddress || credentialsChanged) {
    config.deliveryVerified = false;
  }
  return config;
}
