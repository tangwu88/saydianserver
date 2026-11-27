import { afterEach, describe, expect, it, vi } from "vitest";
import { OutboxWorker } from "./outbox-worker";

afterEach(() => vi.unstubAllEnvs());
function harness(enabled = true, shareId?: string, product?: string) {
  vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
  vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
  vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
  const event = {
    id: "outbox-1",
    eventId: shareId ? "ring-share:synthetic-1" : "feedback-reply:synthetic-1",
    eventType: "system",
    aggregateType: shareId ? "ring_share" : "feedback",
    aggregateId: shareId ?? "feedback-1",
    status: "PENDING",
    attempts: 0,
    payload: {
      ...(product ? {product} : {}),
      userId: "member-1",
      notificationId: "notification-1",
      deepLink: shareId ? "/ring/shares/" + shareId : "/notifications",
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
    ringShare: {
      findFirst: vi.fn(async () => shareId ? {id: shareId} : null),
    },
    pushInstallation: {
      findMany: vi.fn(async () => [
        {
          userId: "member-1",
          registrationId: "synthetic-device",
          provider: product === "saydian-app-cn" ? "jpush_saydian_cn" : shareId ? "jpush_say_ring" : "jpush",
        },
      ]),
    },
  };
  const redis: any = { set: vi.fn(async () => "OK"), del: vi.fn() };
  const push = { deliver: vi.fn(async () => {}) };
  return { prisma, push, event, worker: new OutboxWorker(prisma, redis, push) };
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

describe("Say Ring share response push delivery", () => {
  const shareId = "4633cb02-6115-48e7-a352-2a8bfaeb8b44";

  it("selects only CN registrations for CN shares and care messages", async () => {
    const h=harness(true,shareId,"saydian-app-cn");
    await h.worker.runOnce();
    expect(h.prisma.pushInstallation.findMany).toHaveBeenCalledWith({where:{userId:"member-1",enabled:true,provider:"jpush_saydian_cn"}});
    expect(h.prisma.ringShare.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({product:"saydian-app-cn"})}));
    const care=harness(true,shareId,"saydian-app-cn");
    care.event.aggregateType="ring_care";
    care.event.payload.deepLink="/care/interactions/"+shareId;
    care.prisma.careRelationship={findFirst:vi.fn(async()=>({id:shareId}))};
    await care.worker.runOnce();
    expect(care.prisma.pushInstallation.findMany).toHaveBeenCalledWith({where:{userId:"member-1",enabled:true,provider:"jpush_saydian_cn"}});
  });

  it("rejects an unknown product rather than using another application's channel", async () => {
    const h=harness(true,shareId,"unknown");
    await h.worker.runOnce();
    expect(h.push.deliver).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"PENDING",attempts:1})}));
  });

  it("delivers only to Say Ring installations owned by the sharer", async () => {
    const h = harness(true, shareId);
    await h.worker.runOnce();
    expect(h.prisma.ringShare.findFirst).toHaveBeenCalledWith({
      where: { id: shareId, ownerId: "member-1", product: "say-ring", owner: { status: "ACTIVE" } },
      select: { id: true },
    });
    expect(h.prisma.pushInstallation.findMany).toHaveBeenCalledWith({
      where: { userId: "member-1", enabled: true, provider: "jpush_say_ring" },
    });
    expect(h.push.deliver).toHaveBeenCalledWith(expect.any(Array), {
      eventId: "ring-share:synthetic-1", type: "system", deepLink: "/ring/shares", entityId: shareId,
    });
  });

  it("does not send a share push after preference opt-out or removal", async () => {
    const optedOut = harness(false, shareId);
    await optedOut.worker.runOnce();
    expect(optedOut.push.deliver).not.toHaveBeenCalled();
    const removed = harness(true, shareId);
    removed.prisma.ringShare.findFirst.mockResolvedValue(null);
    await removed.worker.runOnce();
    expect(removed.push.deliver).not.toHaveBeenCalled();
  });
});
