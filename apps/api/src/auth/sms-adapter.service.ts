import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { env } from "../common/environment";

@Injectable()
export class SmsAdapterService {
  async send(mobile: string, code: string, usage: string): Promise<void> {
    const provider = env("SMS_PROVIDER", "disabled").toLowerCase();
    if (provider === "mock" && env("NODE_ENV", "development") !== "production") {
      process.stdout.write(
        `${JSON.stringify({
          level: "info",
          event: "mock_sms_accepted",
          mobileSuffix: mobile.slice(-4),
          usage,
        })}\n`,
      );
      return;
    }
    if (provider !== "webhook") {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
    const url = env("SMS_WEBHOOK_URL", "");
    const token = env("SMS_WEBHOOK_TOKEN", "");
    if (!url || !token) {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ mobile, code, usage }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new ServiceUnavailableException("短信服务暂时无法使用，请稍后再试");
    }
  }
}
