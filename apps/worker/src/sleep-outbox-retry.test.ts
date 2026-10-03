import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HealthReportWorker,
  SleepProviderError,
  reportRetryPolicy,
} from "./health-report-worker";
import { OutboxWorker } from "./outbox-worker";
import { SLEEP_REPORT_TEMPLATE } from "@saydian/app-contracts";

afterEach(() => vi.unstubAllEnvs());
function retryHarness(
  attempts = 0,
  template = SLEEP_REPORT_TEMPLATE,
  error = new SleepProviderError("timeout"),
) {
  vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
  vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
  vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
  const event = {
    id: "synthetic-outbox",
    eventId: "synthetic-event",
    aggregateId: "synthetic-report",
    eventType: "health_report_generate",
    status: "PENDING",
    attempts,
  };
  const prisma: any = {
    outboxEvent: {
      findMany: vi.fn(async () => [event]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
  };
  const redis: any = { set: vi.fn(async () => "OK"), del: vi.fn() };
  const reports: any = {
    generate: vi.fn(async () => {
      throw error;
    }),
    retryPolicy: vi.fn(async (_id: string, count: number) =>
      reportRetryPolicy(template, count),
    ),
    failPermanently: vi.fn(),
    markWaitingForRetry: vi.fn(),
  };
  return {
    worker: new OutboxWorker(prisma, redis, {} as any, undefined, reports),
    prisma,
    redis,
    reports,
  };
}
describe("sleep outbox bounded retry", () => {
  it("marks a retry as queued and releases both claims", async () => {
    const h = retryHarness();
    const start = Date.now();
    await h.worker.runOnce();
    expect(h.reports.markWaitingForRetry).toHaveBeenCalledWith(
      "synthetic-report",
      expect.any(SleepProviderError),
    );
    expect(h.reports.failPermanently).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: "synthetic-outbox" },
      data: expect.objectContaining({
        attempts: 1,
        status: "PENDING",
        lockedAt: null,
        lastError: "sleep_ai:timeout",
      }),
    });
    const saved = h.prisma.outboxEvent.update.mock.calls[0][0].data;
    expect(saved.nextAttemptAt.getTime() - start).toBeGreaterThanOrEqual(
      15_000,
    );
    expect(h.redis.del).toHaveBeenCalledWith("saydian:outbox:synthetic-event");
  });
  it.each([2, 9])(
    "ends attempts including legacy backoff count %s",
    async (attempts) => {
      const h = retryHarness(attempts);
      await h.worker.runOnce();
      expect(h.reports.failPermanently).toHaveBeenCalledOnce();
      expect(h.reports.markWaitingForRetry).not.toHaveBeenCalled();
      expect(h.prisma.outboxEvent.update.mock.calls[0][0].data.status).toBe(
        "DEAD_LETTER",
      );
    },
  );
  it("does not repeat an invalid provider request", async () => {
    const h = retryHarness(
      0,
      SLEEP_REPORT_TEMPLATE,
      new SleepProviderError("provider_rejected", false),
    );
    await h.worker.runOnce();
    expect(h.reports.failPermanently).toHaveBeenCalledOnce();
    expect(h.reports.markWaitingForRetry).not.toHaveBeenCalled();
  });
  it("retains the generic health ten-attempt policy", async () => {
    const h = retryHarness(2, "wellness-report-v2");
    await h.worker.runOnce();
    expect(h.reports.failPermanently).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.update.mock.calls[0][0].data.status).toBe(
      "PENDING",
    );
  });
});

describe("existing timeout recovery without new uploads", () => {
  function recovery(
    template = SLEEP_REPORT_TEMPLATE,
    status = "GENERATING",
    claimed = 1,
  ) {
    const prisma: any = {
      outboxEvent: {
        findMany: vi.fn(async () => [
          { id: "synthetic-outbox", aggregateId: "synthetic-report" },
        ]),
        updateMany: vi.fn(async () => ({ count: claimed })),
        create: vi.fn(),
      },
      healthReport: {
        findUnique: vi.fn(async () => ({ templateVersion: template, status })),
        updateMany: vi.fn(),
      },
    };
    prisma.$transaction = vi.fn(async (run: any) => run(prisma));
    return { worker: new HealthReportWorker(prisma), prisma };
  }
  it("only reschedules the existing pending sleep timeout and preserves attempt counts", async () => {
    const h = recovery();
    await h.worker.recoverTimedOutSleepReports();
    expect(h.prisma.outboxEvent.findMany.mock.calls[0][0].where).toMatchObject({
      eventType: "health_report_generate",
      status: "PENDING",
    });
    expect(h.prisma.outboxEvent.updateMany.mock.calls[0][0].data).toEqual({
      nextAttemptAt: expect.any(Date),
    });
    expect(h.prisma.healthReport.updateMany.mock.calls[0][0].data).toEqual({
      status: "QUEUED",
      failureReason: "sleep_ai:timeout",
    });
    expect(h.prisma.outboxEvent.create).not.toHaveBeenCalled();
  });
  it.each(["READY", "REVOKED", "FAILED"])(
    "never revives terminal %s",
    async (status) => {
      const h = recovery(SLEEP_REPORT_TEMPLATE, status);
      await h.worker.recoverTimedOutSleepReports();
      expect(h.prisma.outboxEvent.updateMany).not.toHaveBeenCalled();
      expect(h.prisma.healthReport.updateMany).not.toHaveBeenCalled();
    },
  );
  it("leaves another App's report and an already claimed task alone", async () => {
    const other = recovery("wellness-report-v2");
    await other.worker.recoverTimedOutSleepReports();
    expect(other.prisma.outboxEvent.updateMany).not.toHaveBeenCalled();
    const claimed = recovery(SLEEP_REPORT_TEMPLATE, "GENERATING", 0);
    await claimed.worker.recoverTimedOutSleepReports();
    expect(claimed.prisma.healthReport.updateMany).not.toHaveBeenCalled();
  });
  it("retry status cannot overwrite terminal or another template", async () => {
    const h = recovery();
    await h.worker.markWaitingForRetry(
      "synthetic-report",
      new SleepProviderError("timeout"),
    );
    expect(h.prisma.healthReport.updateMany.mock.calls[0][0].where).toEqual({
      id: "synthetic-report",
      templateVersion: SLEEP_REPORT_TEMPLATE,
      status: { in: ["QUEUED", "GENERATING"] },
    });
  });
});
