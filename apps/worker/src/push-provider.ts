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
    private readonly registrationProvider = "jpush",
    private readonly integrationKey = "push",
  ) {}

  async deliver(
    installations: PushInstallation[],
    payload: SafePushPayloadContract,
  ): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const item of installations.filter(item => item.provider === this.registrationProvider)) {
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
    if (this.prisma) await markWorkerIntegrationVerified(this.prisma, this.integrationKey);
  }
}

type RoutedPushTarget = {
  registrationProvider: string;
  provider: PushProvider;
};

export class RoutedPushProvider implements PushProvider {
  constructor(private readonly targets: RoutedPushTarget[]) {}

  async deliver(
    installations: PushInstallation[],
    payload: SafePushPayloadContract,
  ): Promise<void> {
    const deliveries = this.targets
      .map(target => ({
        target,
        installations: installations.filter(
          installation => installation.provider === target.registrationProvider,
        ),
      }))
      .filter(delivery => delivery.installations.length > 0);
    if (deliveries.length === 0 && installations.length > 0) {
      throw new Error("Push provider is unconfigured for this application");
    }
    for (const delivery of deliveries) {
      await delivery.target.provider.deliver(delivery.installations, payload);
    }
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
  const legacyIntegration = await prisma.integrationConfig.findUnique({
    where: { key: "push" },
  });
  const legacyProvider = String(
    asObject(legacyIntegration?.publicConfig).provider ??
      process.env.PUSH_PROVIDER ??
      "disabled",
  )
    .trim()
    .toLowerCase();
  if (legacyProvider === "mock") return new MockPushProvider();

  const targets: RoutedPushTarget[] = [];
  const legacyTarget = await configuredJPushTarget(
    prisma,
    "push",
    "jpush",
    "JPUSH_APP_KEY",
    "JPUSH_MASTER_SECRET",
    legacyIntegration,
  );
  if (legacyTarget) targets.push(legacyTarget);

  if (process.env.APP_REALM === "global") {
    const sayRingIntegration = await prisma.integrationConfig.findUnique({
      where: { key: "say_ring_push" },
    });
    const sayRingTarget = await configuredJPushTarget(
      prisma,
      "say_ring_push",
      "jpush_say_ring",
      "SAY_RING_JPUSH_APP_KEY",
      "SAY_RING_JPUSH_MASTER_SECRET",
      sayRingIntegration,
    );
    if (sayRingTarget) targets.push(sayRingTarget);
  }

  return targets.length > 0
    ? new RoutedPushProvider(targets)
    : new DisabledPushProvider();
}

async function configuredJPushTarget(
  prisma: PrismaClient,
  integrationKey: string,
  registrationProvider: string,
  appKeyEnvironment: string,
  masterSecretEnvironment: string,
  integration: {
    state: IntegrationState;
    publicConfig: unknown;
  } | null,
): Promise<RoutedPushTarget | null> {
  const provider = String(asObject(integration?.publicConfig).provider ?? "disabled")
    .trim()
    .toLowerCase();
  if (integration?.state !== IntegrationState.CONFIGURED || provider !== "jpush") {
    return null;
  }
  const secrets = await resolveWorkerSecrets(prisma, integrationKey, {
    appKey: appKeyEnvironment,
    masterSecret: masterSecretEnvironment,
  });
  const appKey = secrets.appKey ?? "";
  const masterSecret = secrets.masterSecret ?? "";
  if (!appKey || !masterSecret) {
    throw new Error(`${integrationKey} JPush credentials are unconfigured`);
  }
  return {
    registrationProvider,
    provider: new JPushProvider(
      appKey,
      masterSecret,
      prisma,
      registrationProvider,
      integrationKey,
    ),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
