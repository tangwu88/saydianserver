import {
  OutboxStatus,
  PrismaClient,
  type OutboxEvent,
} from "@prisma/client";
import { buildSafePushPayload } from "@saydian/app-contracts";
import Redis from "ioredis";
import type { AccountDeletionWorker } from "./account-deletion-worker";
import type { PushProvider } from "./push-provider";

export class OutboxWorker {
  private stopping = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
    private readonly push: PushProvider,
    private readonly accountDeletions?: AccountDeletionWorker,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async run(): Promise<void> {
    await this.recoverStaleClaims();
    while (!this.stopping) {
      const processed = await this.runOnce();
      if (!processed) await delay(1000);
    }
  }

  async runOnce(): Promise<boolean> {
    const deletionProcessed = await this.accountDeletions?.runOnce();
    const candidates = await this.prisma.outboxEvent.findMany({
      where: {
        status: OutboxStatus.PENDING,
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (candidates.length === 0) return deletionProcessed ?? false;
    for (const event of candidates) await this.claimAndProcess(event);
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
      const deadLetter = attempts >= 10;
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

  private async recoverStaleClaims(): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        status: OutboxStatus.PROCESSING,
        lockedAt: { lt: new Date(Date.now() - 5 * 60_000) },
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
