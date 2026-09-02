import type { PushInstallation } from "@prisma/client";
import type { SafePushPayloadContract } from "@saydian/app-contracts";

export interface PushProvider {
  deliver(
    installations: PushInstallation[],
    payload: SafePushPayloadContract,
  ): Promise<void>;
}

export class MockPushProvider implements PushProvider {
  async deliver(
    installations: PushInstallation[],
    payload: SafePushPayloadContract,
  ): Promise<void> {
    process.stdout.write(
      `${JSON.stringify({
        level: "info",
        event: "mock_push_delivered",
        eventId: payload.eventId,
        type: payload.type,
        installations: installations.length,
      })}\n`,
    );
  }
}

export class JPushProvider implements PushProvider {
  constructor(
    private readonly appKey: string,
    private readonly masterSecret: string,
  ) {}

  async deliver(
    installations: PushInstallation[],
    payload: SafePushPayloadContract,
  ): Promise<void> {
    const registrationIds = installations
      .filter((item) => item.provider === "jpush")
      .map((item) => item.registrationId);
    if (registrationIds.length === 0) return;
    const authorization = Buffer.from(
      `${this.appKey}:${this.masterSecret}`,
    ).toString("base64");
    const response = await fetch("https://api.jpush.cn/v3/push", {
      method: "POST",
      headers: {
        authorization: `Basic ${authorization}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        platform: "all",
        audience: { registration_id: registrationIds },
        notification: {
          alert: "Saydian赛电有一条新消息",
          android: { extras: payload },
          ios: { extras: payload, sound: "default" },
        },
        message: {
          msg_content: JSON.stringify(payload),
          extras: payload,
        },
        options: { apns_production: process.env.NODE_ENV === "production" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`JPush delivery failed with HTTP ${response.status}`);
    }
  }
}

export function pushProviderFromEnvironment(): PushProvider {
  const provider = process.env.PUSH_PROVIDER?.trim().toLowerCase() || "disabled";
  if (provider === "mock") return new MockPushProvider();
  if (provider === "jpush") {
    const appKey = process.env.JPUSH_APP_KEY?.trim() ?? "";
    const masterSecret = process.env.JPUSH_MASTER_SECRET?.trim() ?? "";
    if (!appKey || !masterSecret) {
      throw new Error("JPush selected but credentials are unconfigured");
    }
    return new JPushProvider(appKey, masterSecret);
  }
  throw new Error("Push provider is unconfigured");
}
