import { BadRequestException } from "@nestjs/common";
import { isEmail } from "class-validator";
import nodemailer from "nodemailer";

export type WecomEmailConfig = { fromAddress: string; smtpPassword: string };

export function emailAddress(value: unknown): string {
  const address = typeof value === "string" ? value.trim() : "";
  if (address.length > 254 || /[\r\n]/.test(address) || !isEmail(address)) {
    throw new BadRequestException("请填写完整、有效的邮箱地址");
  }
  return address;
}

/** Fixed Tencent endpoint: no arbitrary SMTP hosts, sender headers or attachments. */
export async function deliverWecomEmail(
  config: WecomEmailConfig,
  input: { recipient: string; code?: string; locale?: string; test?: boolean },
): Promise<void> {
  const sender = emailAddress(config.fromAddress);
  const recipient = emailAddress(input.recipient);
  if (!config.smtpPassword || (!input.test && !/^\d{6}$/.test(input.code ?? ""))) {
    throw new BadRequestException("邮件发送参数不完整");
  }
  const english = input.locale?.startsWith("en") === true;
  const transport = nodemailer.createTransport({
    host: "smtp.exmail.qq.com",
    port: 465,
    secure: true,
    auth: { user: sender, pass: config.smtpPassword },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    dnsTimeout: 10_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: { name: "SAYDIAN 赛电", address: sender },
      to: [{ address: recipient, name: "" }],
      envelope: { from: sender, to: [recipient] },
      subject: input.test ? "赛电邮箱连接测试" : english ? "Your SAYDIAN verification code" : "赛电邮箱验证码",
      text: input.test
        ? "这是一封赛电邮箱服务连接测试邮件，不是登录验证码。收到本邮件后，请在管理后台确认投递验收，再开启邮箱登录。"
        : english
          ? `Your SAYDIAN verification code is ${input.code}. It expires in 5 minutes. Do not share this code. If you did not request it, ignore this email.`
          : `您的赛电验证码是 ${input.code}，5 分钟内有效。请勿向他人透露。如非本人操作，请忽略本邮件。`,
    });
    if (!result.accepted?.length || result.rejected?.length) throw new Error("Recipient rejected");
  } finally {
    transport.close();
  }
}
