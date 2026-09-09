import { IntegrationState, type PrismaClient, type PushInstallation } from "@prisma/client";
import type { SafePushPayloadContract } from "@saydian/app-contracts";
import {
  markWorkerIntegrationVerified,
  resolveWorkerSecrets,
} from "./integration-secrets";
import { globalPushAlert } from "./global-push-locale";

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
    private readonly prisma?: PrismaClient,
  ) {}

  async deliver(
    installations: PushInstallation[],
    payload: SafePushPayloadContract,
  ): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const item of installations.filter(item => item.provider === "jpush")) {
      const alert = process.env.APP_REALM === "global" ? globalPushAlert(item.locale) : "Saydian赛电有一条新消息";
      groups.set(alert, [...(groups.get(alert) ?? []), item.registrationId]);
    }
    if (groups.size === 0) return;
    const authorization = Buffer.from(
      `${this.appKey}:${this.masterSecret}`,
    ).toString("base64");
    for (const [alert, registrationIds] of groups) {
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
          alert,
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
    if (this.prisma) await markWorkerIntegrationVerified(this.prisma, "push");
  }
}

export class DisabledPushProvider implements PushProvider {
  async deliver(): Promise<void> {
    throw new Error("Push provider is unconfigured");
  }
}

export async function pushProviderFromConfiguration(
  prisma: PrismaClient,
): Promise<PushProvider> {
  const integration = await prisma.integrationConfig.findUnique({
    where: { key: "push" },
  });
  const publicConfig = asObject(integration?.publicConfig);
  const provider = String(
    publicConfig.provider ?? process.env.PUSH_PROVIDER ?? "disabled",
  )
    .trim()
    .toLowerCase();
  if (provider === "mock") return new MockPushProvider();
  if (integration?.state !== IntegrationState.CONFIGURED) {
    return new DisabledPushProvider();
  }
  if (provider === "jpush") {
    const secrets = await resolveWorkerSecrets(prisma, "push", {
      appKey: "JPUSH_APP_KEY",
      masterSecret: "JPUSH_MASTER_SECRET",
    });
    const appKey = secrets.appKey ?? "";
    const masterSecret = secrets.masterSecret ?? "";
    if (!appKey || !masterSecret) {
      throw new Error("JPush selected but credentials are unconfigured");
    }
    return new JPushProvider(appKey, masterSecret, prisma);
  }
  return new DisabledPushProvider();
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
