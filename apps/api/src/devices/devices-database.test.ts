import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { DevicesService } from "./devices.service";
import { RING_BINDING_DECISION_SCOPE } from "./ring-binding-decision";

// Only an explicitly enabled loopback fixture database; no real members/rings.
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")("first ring binding PostgreSQL acceptance", () => {
  let prisma: PrismaClient;
  let service: DevicesService;
  const users: string[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Non-local database refused");
    prisma = new PrismaClient(); service = new DevicesService(prisma as any);
  });
  afterAll(async () => {
    if (prisma) { await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
  });
  async function member() {
    const u = await prisma.user.create({ data: { nickname: `SYNTHETIC_FIRST_RING_${randomUUID()}` } });
    users.push(u.id); return u.id;
  }
  function ring(id: string, initialize = true) {
    return { deviceId: id, vendor: "CoolWear", model: "R7Pro", displayName: "SYNTHETIC_RING",
      ...(initialize ? { product: "say-ring", initializeFirstBinding: true } : {}) };
  }
  it("two concurrent first devices get exactly one grant; repeats get none", async () => {
    const id = await member();
    const results = await Promise.all([service.bind(id, ring("fixture:a")), service.bind(id, ring("fixture:b"))]);
    expect(results.filter(x => x.firstBindingInitialization?.shouldClear)).toHaveLength(1);
    expect((await service.bind(id, ring("fixture:a"))).firstBindingInitialization?.shouldClear).toBe(false);
    expect((await service.bindingHistoryStatus(id, "say-ring", "fixture:a")).priorBindingConfirmed).toBe(false);
    expect((await service.bindingHistoryStatus(id, "say-ring", "fixture:b")).priorBindingConfirmed).toBe(false);
  });
  it("unbound lifetime history and a new model still prevent clearing", async () => {
    const id = await member(); const old = await service.bind(id, ring("fixture:old", false));
    await service.unbind(id, old.id); expect(await service.list(id)).toEqual([]);
    expect((await service.bind(id, ring("fixture:new"))).firstBindingInitialization?.shouldClear).toBe(false);
  });
  it("an old client report is also serialized and protects its member", async () => {
    const id = await member(); await service.bind(id, ring("fixture:legacy", false));
    expect((await service.bind(id, ring("fixture:new"))).firstBindingInitialization?.shouldClear).toBe(false);
    expect((await service.bind(await member(), ring("fixture:other-member"))).firstBindingInitialization?.shouldClear).toBe(true);
  });

  it("recovers prior history read-only while a first, equal-time or foreign history stays unconfirmed", async () => {
    const id = await member();
    const old = await service.bind(id, ring("fixture:prior", false));
    const current = await service.bind(id, ring("fixture:current"));
    const before = new Date("2026-01-01T00:00:00.000Z");
    const after = new Date("2026-01-02T00:00:00.000Z");
    await prisma.deviceBinding.update({ where: { id: old.id }, data: { createdAt: before, unboundAt: before } });
    await prisma.deviceBinding.update({ where: { id: current.id }, data: { createdAt: after } });
    const events = await prisma.deviceConnectionEvent.count({ where: { deviceBindingId: current.id } });
    expect((await service.bindingHistoryStatus(id, "say-ring", "fixture:current")).priorBindingConfirmed).toBe(true);
    expect(await prisma.deviceConnectionEvent.count({ where: { deviceBindingId: current.id } })).toBe(events);
    await prisma.deviceBinding.update({ where: { id: old.id }, data: { createdAt: after } });
    expect((await service.bindingHistoryStatus(id, "say-ring", "fixture:current")).priorBindingConfirmed).toBe(false);
    const other = await member();
    await service.bind(other, ring("fixture:current"));
    expect((await service.bindingHistoryStatus(other, "say-ring", "fixture:current")).priorBindingConfirmed).toBe(false);
    expect((await service.bindingHistoryStatus(id, "say-ring", "fixture:missing")).priorBindingConfirmed).toBe(true);
  });

  it("one durable clear decision is committed under concurrent retries, and is never replayed", async () => {
    const id = await member(); const operationId = randomUUID();
    const body = { ...ring("fixture:durable-first"), initializationOperationId: operationId };
    const outcomes = await Promise.allSettled([
      service.firstBindingDecision(id, body), service.firstBindingDecision(id, body),
    ]);
    const successes = outcomes.filter(x => x.status === "fulfilled");
    expect(successes).toHaveLength(1);
    expect((successes[0] as PromiseFulfilledResult<any>).value.firstBindingInitialization.shouldClear).toBe(true);
    expect(outcomes.filter(x => x.status === "rejected")).toHaveLength(1);
    expect((await service.bindingInitializationStatus(id, "say-ring", body.deviceId, operationId)).decision).toBe("clear-issued");
    expect(await prisma.deviceBinding.count({ where: { userId: id } })).toBe(1);
    expect(await prisma.deviceConnectionEvent.count({ where: { deviceBinding: { userId: id } } })).toBe(1);
    expect(await prisma.idempotencyRecord.count({ where: { userId: id, scope: RING_BINDING_DECISION_SCOPE } })).toBe(1);
  });

  it("same-ring old member can read and repeat its preserve decision without duplicate writes", async () => {
    const id = await member(); const sourceId = "fixture:same-old-ring";
    await service.bind(id, ring(sourceId, false));
    const operationId = randomUUID();
    const body = { ...ring(sourceId), initializationOperationId: operationId };
    const results = await Promise.all([
      service.firstBindingDecision(id, body), service.firstBindingDecision(id, body),
    ]);
    expect(results.every(x => x.firstBindingInitialization?.shouldClear === false)).toBe(true);
    expect((await service.bindingInitializationStatus(id, "say-ring", sourceId, operationId)).decision).toBe("preserve");
    expect(await prisma.deviceConnectionEvent.count({ where: { deviceBinding: { userId: id } } })).toBe(2);
    await prisma.idempotencyRecord.updateMany({ where: { userId: id, scope: RING_BINDING_DECISION_SCOPE }, data: { expiresAt: new Date("2000-01-01") } });
    expect((await service.firstBindingDecision(id, body)).firstBindingInitialization?.shouldClear).toBe(false);
    expect(await prisma.deviceConnectionEvent.count({ where: { deviceBinding: { userId: id } } })).toBe(2);
  });

  it("receipt failure rolls back target and connection event so no grant can be consumed", async () => {
    const id = await member(); const operationId = randomUUID();
    // A transaction-local deliberate receipt failure validates actual PostgreSQL
    // rollback without touching production data or modifying the database schema.
    const failing = new DevicesService({
      $transaction: (fn: any, options: any) => prisma.$transaction(tx => fn({
        $queryRaw: tx.$queryRaw.bind(tx), deviceBinding: tx.deviceBinding,
        deviceConnectionEvent: tx.deviceConnectionEvent,
        idempotencyRecord: {
          findUnique: tx.idempotencyRecord.findUnique.bind(tx.idempotencyRecord),
          create: async () => { throw new Error("SYNTHETIC_RECEIPT_WRITE_FAILURE"); },
        },
      }), options),
    } as any);
    const body = { ...ring("fixture:atomic-receipt"), initializationOperationId: operationId };
    await expect(failing.firstBindingDecision(id, body)).rejects.toThrow("SYNTHETIC_RECEIPT_WRITE_FAILURE");
    expect(await prisma.deviceBinding.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.deviceConnectionEvent.count({ where: { deviceBinding: { userId: id } } })).toBe(0);
    expect((await service.bindingInitializationStatus(id, "say-ring", body.deviceId, operationId)).decision).toBe("not-found");
    expect((await service.firstBindingDecision(id, body)).firstBindingInitialization?.shouldClear).toBe(true);
  });
});
