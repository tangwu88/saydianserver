import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancelAccountDeletion } from "./account-deletion-cancellation";

describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")("account deletion cancellation PostgreSQL acceptance", () => {
  let prisma: PrismaClient;
  const owners: string[] = [];
  const actor = { id: "synthetic-cancellation-admin", role: "SUPER_ADMIN" };
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/test/i.test(url.pathname)) throw new Error("Only a loopback test database is allowed");
    prisma = new PrismaClient();
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.auditLog.deleteMany({ where: { actorId: actor.id, entityId: { in: owners } } });
    await prisma.user.deleteMany({ where: { id: { in: owners } } });
    await prisma.$disconnect();
  });
  async function fixture() {
    const user = await prisma.user.create({ data: { nickname: "Synthetic deletion fixture", status: "DELETION_PENDING", wechatAppOpenId: `synthetic-${randomUUID()}`, mobileVerifiedAt: new Date() } });
    owners.push(user.id);
    const request = await prisma.accountDeletionRequest.create({ data: { userId: user.id, executeAfter: new Date(Date.now() - 1000) } });
    const input = { expectedUserId: user.id, expectedRequestedAt: request.requestedAt.toISOString(), confirm: true, reason: "合成测试会员确认撤销注销" };
    return { user, request, run: (db: any = prisma) => cancelAccountDeletion(db, actor, request.id, input, "synthetic-request") };
  }
  it("preserves health and WeChat identity, keeps old sessions revoked, and fences worker claims", async () => {
    const f = await fixture();
    const originalSession = await prisma.userSession.create({ data: { userId: f.user.id, accessJti: randomUUID(), refreshTokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000), revokedAt: new Date() } });
    const health = await prisma.healthRecord.create({ data: { userId: f.user.id, clientRecordId: randomUUID(), metric: "HEART_RATE", observedAt: new Date(), timezoneOffsetMinutes: 480, values: { bpm: 70 }, sourcePlatform: "synthetic-test" } });
    const installation = await prisma.pushInstallation.create({ data: { userId: f.user.id, installationId: randomUUID(), provider: "synthetic", registrationId: randomUUID(), platform: "android", appVersion: "1", buildNumber: "1", enabled: false } });
    await prisma.accountDeletionRequest.create({ data: { userId: f.user.id, executeAfter: new Date() } });
    let entered!: () => void; let release!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const db = { $transaction: (run: any, options: any) => prisma.$transaction(async tx => {
      const proxy = new Proxy(tx, { get(target, key) {
        if (key === "accountDeletionRequest") return { ...target.accountDeletionRequest, updateMany: async (args: any) => { const result = await target.accountDeletionRequest.updateMany(args); entered(); await proceed; return result; } };
        return Reflect.get(target, key);
      } });
      return run(proxy);
    }, options) };
    const cancel = f.run(db);
    await locked;
    const workerClaim = prisma.accountDeletionRequest.updateMany({ where: { id: f.request.id, status: "REQUESTED" }, data: { status: "PROCESSING" } });
    const worker = Promise.resolve(workerClaim); // Start a second connection while the cancellation owns the task lock.
    release();
    expect(await cancel).toMatchObject({ status: "CANCELLED", userStatus: "ACTIVE" });
    expect(await worker).toEqual({ count: 0 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).toMatchObject({ status: "ACTIVE", wechatAppOpenId: f.user.wechatAppOpenId, mobileVerifiedAt: f.user.mobileVerifiedAt });
    expect(await prisma.healthRecord.findUnique({ where: { id: health.id } })).toEqual(health);
    expect(await prisma.userSession.findUnique({ where: { id: originalSession.id } })).toEqual(originalSession);
    expect(await prisma.pushInstallation.findUnique({ where: { id: installation.id } })).toEqual(installation);
    expect(await prisma.accountDeletionRequest.count({ where: { userId: f.user.id, status: "CANCELLED" } })).toBe(2);
    expect(await f.run()).toMatchObject({ alreadyCancelled: true });
    expect(await prisma.auditLog.count({ where: { actorId: actor.id, entityId: f.user.id, action: "ACCOUNT_DELETION_CANCELLED" } })).toBe(1);
  });
  it("does not restore when the worker claims first", async () => {
    const f = await fixture();
    await prisma.accountDeletionRequest.updateMany({ where: { id: f.request.id, status: "REQUESTED" }, data: { status: "PROCESSING" } });
    await expect(f.run()).rejects.toMatchObject({ status: 409 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).status).toBe("DELETION_PENDING");
  });
  it("rolls back the restored user and cancelled tasks if the audit insert fails", async () => {
    const f = await fixture();
    const db = { $transaction: (run: any, options: any) => prisma.$transaction(tx => run(new Proxy(tx, { get(target, key) {
      if (key === "auditLog") return { create: async () => { throw new Error("synthetic audit failure"); } };
      return Reflect.get(target, key);
    } })), options) };
    await expect(f.run(db)).rejects.toThrow("synthetic audit failure");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).status).toBe("DELETION_PENDING");
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: f.request.id } })).status).toBe("REQUESTED");
  });
});
