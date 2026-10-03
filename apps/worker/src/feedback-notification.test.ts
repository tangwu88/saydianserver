import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxWorker } from "./outbox-worker";

afterEach(() => vi.unstubAllEnvs());
function harness(enabled = true) {
  vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
  vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
  vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
  const event = {
    id: "outbox-1",
    eventId: "feedback-reply:synthetic-1",
    eventType: "system",
    aggregateType: "feedback",
    aggregateId: "feedback-1",
    status: "PENDING",
    attempts: 0,
    payload: {
      userId: "member-1",
      notificationId: "notification-1",
      deepLink: "/notifications",
    },
  };
  const prisma: any = {
    outboxEvent: {
      findMany: vi.fn(async () => [event]),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    userNotificationPreference: {
      findUnique: vi.fn(async () => ({ transactionalEnabled: enabled })),
    },
    pushInstallation: {
      findMany: vi.fn(async () => [
        {
          userId: "member-1",
          registrationId: "synthetic-device",
          provider: "jpush",
        },
      ]),
    },
  };
  const redis: any = { set: vi.fn(async () => "OK"), del: vi.fn() };
  const push = { deliver: vi.fn(async () => {}) };
  return { prisma, push, worker: new OutboxWorker(prisma, redis, push) };
}
describe("feedback reply push delivery", () => {
  it("uses the existing system notification route, targeting only the replying member with no content on the lock screen", async () => {
    const h = harness();
    await h.worker.runOnce();
    expect(h.prisma.pushInstallation.findMany).toHaveBeenCalledWith({
      where: { userId: "member-1", enabled: true },
    });
    expect(h.push.deliver).toHaveBeenCalledWith(expect.any(Array), {
      eventId: "feedback-reply:synthetic-1",
      type: "system",
      deepLink: "/notifications",
    });
  });
  it("respects disabled transactional push but leaves the stored inbox notification intact", async () => {
    const h = harness(false);
    await h.worker.runOnce();
    expect(h.push.deliver).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DELIVERED" }),
      }),
    );
  });
  it("retains an unconfigured push as retryable instead of claiming the phone received it", async () => {
    const h = harness();
    h.push.deliver.mockRejectedValueOnce(
      new Error("Push provider is unconfigured"),
    );
    await h.worker.runOnce();
    expect(h.prisma.outboxEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", attempts: 1 }),
      }),
    );
  });
});
