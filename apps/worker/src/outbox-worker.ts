import {
  OutboxStatus,
  PrismaClient,
  type OutboxEvent,
} from "@prisma/client";
import {
  buildSafePushPayload,
  businessWritesPaused,
  healthReportWorkerEnabled,
  jushuitanWorkerEnabled,
  shouldPauseWorkers,
} from "@saydian/app-contracts";
import Redis from "ioredis";
import type { AccountDeletionWorker } from "./account-deletion-worker";
import type { PushProvider } from "./push-provider";
import {
  HealthReportWorker,
  PermanentTaskError,
} from "./health-report-worker";
import {
  NotificationCampaignWorker,
  PermanentCampaignError,
} from "./notification-campaign-worker";
import type { CommerceJobWorker } from "./commerce-job-worker";

export class OutboxWorker {
  private stopping = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly push: PushProvider,
    private readonly accountDeletions?: AccountDeletionWorker,
    private readonly healthReports?: HealthReportWorker,
    private readonly notificationCampaigns?: NotificationCampaignWorker,
    private readonly commerceJobs?: CommerceJobWorker,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    while (!this.stopping) {
      const processed = await this.runOnce();
      if (!processed) await delay(1000);
    }
  }

  async runOnce(): Promise<boolean> {
    if (businessWritesPaused(process.env)) return false;
    const generalEnabled = !shouldPauseWorkers(process.env);
    const reportsEnabled = healthReportWorkerEnabled(process.env);
    const commerceEnabled = jushuitanWorkerEnabled(process.env);
    if (!generalEnabled && !reportsEnabled && !commerceEnabled) return false;
    if (generalEnabled || reportsEnabled) {
      await this.recoverStaleClaims(generalEnabled ? undefined : "health_report_generate");
    }
    const deletionProcessed = generalEnabled
      ? await this.accountDeletions?.runOnce()
      : false;
    const commerceProcessed = generalEnabled || commerceEnabled
      ? await this.commerceJobs?.runOnce()
      : false;
    if (!generalEnabled && !reportsEnabled) {
      return Boolean(deletionProcessed || commerceProcessed);
    }
    const candidates = await this.prisma.outboxEvent.findMany({
      where: {
        status: OutboxStatus.PENDING,
        nextAttemptAt: { lte: new Date() },
        ...(generalEnabled ? {} : { eventType: "health_report_generate" }),
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (candidates.length === 0) {
      return Boolean(deletionProcessed || commerceProcessed);
    }
    for (const event of candidates) {
      if (businessWritesPaused(process.env)) break;
      if (event.eventType === "health_report_generate") {
        if (!healthReportWorkerEnabled(process.env)) break;
      } else if (shouldPauseWorkers(process.env)) {
        break;
      }
      await this.claimAndProcess(event);
    }
    return true;
  }

  private async claimAndProcess(candidate: OutboxEvent): Promise<void> {
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id: candidate.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.PROCESSING, lockedAt: new Date() },
    });
    if (claimed.count !== 1) return;
    const redisKey = `saydian:outbox:${candidate.eventId}`;
    const locked = await this.redis.set(redisKey, "1", "PX", 300_000, "NX");
    if (!locked) {
      await this.prisma.outboxEvent.update({
        where: { id: candidate.id },
        data: { status: OutboxStatus.PENDING, lockedAt: null },
      });
      return;
    }
    try {
      await this.deliver(candidate);
      await this.prisma.outboxEvent.update({
        where: { id: candidate.id },
        data: {
          status: OutboxStatus.DELIVERED,
          deliveredAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = candidate.attempts + 1;
      const deadLetter =
        attempts >= 10 ||
        error instanceof PermanentTaskError ||
        error instanceof PermanentCampaignError;
      if (deadLetter && candidate.eventType === "health_report_generate") {
        await this.healthReports?.failPermanently(candidate.aggregateId, error);
      }
      if (deadLetter && candidate.eventType === "notification_campaign_dispatch") {
        await this.notificationCampaigns?.failPermanently(
          candidate.aggregateId,
          error,
        );
      }
      await this.prisma.outboxEvent.update({
        where: { id: candidate.id },
        data: {
          attempts,
          status: deadLetter ? OutboxStatus.DEAD_LETTER : OutboxStatus.PENDING,
          nextAttemptAt: new Date(
            Date.now() + Math.min(2 ** attempts * 30_000, 6 * 3600_000),
          ),
          lockedAt: null,
          lastError: sanitizeError(error),
        },
      });
    } finally {
      await this.redis.del(redisKey);
    }
  }

  private async deliver(event: OutboxEvent): Promise<void> {
    if (event.eventType === "health_report_generate") {
      if (!this.healthReports) throw new Error("Health report worker is unavailable");
      await this.healthReports.generate(event.aggregateId);
      return;
    }
    if (event.eventType === "notification_campaign_dispatch") {
      if (!this.notificationCampaigns) {
        throw new Error("Notification campaign worker is unavailable");
      }
      await this.notificationCampaigns.dispatch(event.aggregateId);
      return;
    }
    const payload = asObject(event.payload);
    const userId = String(payload.userId ?? "");
    if (!userId) throw new Error("Outbox event has no target user");
    const installations = await this.prisma.pushInstallation.findMany({
      where: { userId, enabled: true },
    });
    if (installations.length === 0) return;
    await this.push.deliver(
      installations,
      buildSafePushPayload({
        eventId: event.eventId,
        type: event.eventType,
        deepLink: typeof payload.deepLink === "string" ? payload.deepLink : null,
      }),
    );
  }

  private async recoverStaleClaims(eventType?: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: OutboxStatus.PROCESSING,
        lockedAt: { lt: new Date(Date.now() - 5 * 60_000) },
        ...(eventType ? { eventType } : {}),
      },
      data: { status: OutboxStatus.PENDING, lockedAt: null },
    });
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "delivery failed";
  return message.replace(/[\r\n]/g, " ").slice(0, 500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
