import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { sha256 } from "../common/crypto";
import { DevicesService } from "./devices.service";
import { RING_BINDING_DECISION_SCOPE } from "./ring-binding-decision";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const operationId = "11111111-2222-4333-8444-555555555555";
const sourceId = "qring:synthetic-r8";
const input = { product: "say-ring", initializeFirstBinding: true,
  initializationOperationId: operationId, deviceId: sourceId,
  vendor: "QRing", model: "R8", displayName: "SYNTHETIC_R8" };

function fixture(prior = false) {
  const records = new Map<string, any>();
  const bindings = new Map<string, any>();
  const events: any[] = [];
  if (prior) bindings.set("prior", { id: "prior", userId: owner, hardwareKey: "prior", unboundAt: new Date() });
  const recordKey = (v: any) => `${v.userId}|${v.scope}|${v.key}`;
  const lock = vi.fn(async () => []);
  const tx = {
    $queryRaw: lock,
    deviceBinding: {
      count: vi.fn(async ({ where }: any) => [...bindings.values()].filter(x => x.userId === where.userId).length),
      findFirst: vi.fn(async ({ where }: any) => [...bindings.values()].find(x => x.userId === where.userId && (!where.hardwareKey || x.hardwareKey === where.hardwareKey)) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = bindings.get(where.hardwareKey);
        const value = existing ? { ...existing, ...update } : { id: `binding-${bindings.size}`, ...create };
        bindings.set(where.hardwareKey, value); return value;
      }),
    },
    deviceConnectionEvent: { create: vi.fn(async ({ data }: any) => { events.push(data); return data; }) },
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: any) => records.get(recordKey(where.userId_scope_key)) ?? null),
      create: vi.fn(async ({ data }: any) => { records.set(recordKey(data), data); return data; }),
    },
  };
  const prisma = { ...tx, $transaction: async (fn: any) => fn(tx) };
  return { service: new DevicesService(prisma as any), tx, records, bindings, events, lock,
    record: () => records.get(`${owner}|${RING_BINDING_DECISION_SCOPE}|${operationId}`) };
}

describe("durable Say Ring first-binding decisions", () => {
  it("retains same-target lifetime history and recovers the exact no-clear operation", async () => {
    const f = fixture();
    await f.service.bind(owner, { deviceId: sourceId, vendor: "QRing", model: "R8", displayName: "SYNTHETIC_R8" });
    const result = await f.service.firstBindingDecision(owner, input);
    expect(result.firstBindingInitialization).toEqual({ product: "say-ring", deviceId: sourceId, operationId, shouldClear: false });
    expect(await f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId)).toEqual({ product: "say-ring", deviceId: sourceId, operationId, decision: "preserve" });
    const before = { events: f.events.length, writes: f.tx.deviceBinding.upsert.mock.calls.length };
    expect((await f.service.firstBindingDecision(owner, { ...input, firmware: "new-readback" })).firstBindingInitialization?.shouldClear).toBe(false);
    expect(f.events).toHaveLength(before.events);
    expect(f.tx.deviceBinding.upsert).toHaveBeenCalledTimes(before.writes);
    expect(f.record().responseBody.ownerId).toBe(owner);
    expect(f.record().responseBody.hardwareKey).toBe(sha256(`${owner}:${sourceId}`));
  });

  it("an operation absent after an authentication failure may be decided once later", async () => {
    const f = fixture(true);
    expect((await f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId)).decision).toBe("not-found");
    expect(f.tx.deviceBinding.upsert).not.toHaveBeenCalled();
    expect((await f.service.firstBindingDecision(owner, input)).firstBindingInitialization?.shouldClear).toBe(false);
    expect((await f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId)).decision).toBe("preserve");
  });

  it("a new member receives one clear grant, but GET and POST retries never replay it", async () => {
    const f = fixture();
    expect((await f.service.firstBindingDecision(owner, input)).firstBindingInitialization?.shouldClear).toBe(true);
    const readback = await f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId);
    expect(readback.decision).toBe("clear-issued");
    expect(readback).not.toHaveProperty("shouldClear");
    await expect(f.service.firstBindingDecision(owner, input)).rejects.toMatchObject({ response: { errorKey: "RING_INITIALIZATION_ALREADY_ISSUED" } });
    expect(f.events).toHaveLength(1);
    expect(f.tx.deviceBinding.count).toHaveBeenCalledTimes(1);
    expect(f.tx.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("expired durable receipt retains its original decision (existing member=%s)", async prior => {
    const f = fixture(prior);
    await f.service.firstBindingDecision(owner, input);
    f.record().expiresAt = new Date("2000-01-01T00:00:00Z");
    expect((await f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId)).decision).toBe(prior ? "preserve" : "clear-issued");
    if (prior) expect((await f.service.firstBindingDecision(owner, input)).firstBindingInitialization?.shouldClear).toBe(false);
    else await expect(f.service.firstBindingDecision(owner, input)).rejects.toBeInstanceOf(ConflictException);
    expect(f.tx.deviceBinding.count).toHaveBeenCalledTimes(1);
  });

  it("operation reuse for a different target is a conflict, not a fresh no-clear result", async () => {
    const f = fixture(true); await f.service.firstBindingDecision(owner, input);
    await expect(f.service.firstBindingDecision(owner, { ...input, deviceId: "qring:other-target" })).rejects.toMatchObject({ response: { errorKey: "RING_INITIALIZATION_OPERATION_CONFLICT" } });
    await expect(f.service.bindingInitializationStatus(owner, "say-ring", "qring:other-target", operationId)).rejects.toBeInstanceOf(ConflictException);
    expect(f.events).toHaveLength(1);
  });

  it("another owner cannot read the original decision; owner scopes may independently use the same UUID", async () => {
    const f = fixture(true); await f.service.firstBindingDecision(owner, input);
    expect((await f.service.bindingInitializationStatus(other, "say-ring", sourceId, operationId)).decision).toBe("not-found");
    expect((await f.service.firstBindingDecision(other, input)).firstBindingInitialization?.shouldClear).toBe(true);
    expect((await f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId)).decision).toBe("preserve");
  });

  it.each(["wrong owner", "wrong target", "wrong operation", "invalid decision", "extra keys", "invalid version", "invalid response code"]) (
    "a malformed saved receipt fails closed: %s", async kind => {
      const f = fixture(true); await f.service.firstBindingDecision(owner, input);
      const record = f.record();
      if (kind === "wrong owner") record.responseBody.ownerId = other;
      if (kind === "wrong target") record.responseBody.deviceId = "qring:other";
      if (kind === "wrong operation") record.responseBody.operationId = "other";
      if (kind === "invalid decision") record.responseBody.decision = false;
      if (kind === "extra keys") record.responseBody.shouldClear = false;
      if (kind === "invalid version") record.responseBody.schemaVersion = 2;
      if (kind === "invalid response code") record.responseCode = 201;
      await expect(f.service.bindingInitializationStatus(owner, "say-ring", sourceId, operationId)).rejects.toBeInstanceOf(ConflictException);
      await expect(f.service.firstBindingDecision(owner, input)).rejects.toBeInstanceOf(ConflictException);
      expect(f.tx.deviceBinding.count).toHaveBeenCalledTimes(1);
    },
  );

  it("does not parse client-supplied receipt fields as trusted server decisions", async () => {
    const f = fixture();
    const result = await f.service.firstBindingDecision(owner, { ...input, responseBody: { decision: "preserve" }, shouldClear: false });
    expect(result.firstBindingInitialization?.shouldClear).toBe(true);
    expect(f.record().responseBody.decision).toBe("clear-issued");
  });

  it.each([undefined, "", "not-a-uuid", "11111111-2222-3333-8444-555555555555"]) (
    "requires a canonical UUIDv4 operation before any binding writes: %s", async value => {
      const f = fixture();
      await expect(f.service.firstBindingDecision(owner, { ...input, initializationOperationId: value })).rejects.toBeInstanceOf(BadRequestException);
      expect(f.tx.deviceBinding.upsert).not.toHaveBeenCalled();
    },
  );

  it("the old bind route rejects new protocol fields instead of consuming a grant", async () => {
    const f = fixture();
    await expect(f.service.bind(owner, input)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.tx.deviceBinding.upsert).not.toHaveBeenCalled();
  });

  it("an unavailable receipt write aborts the transaction rather than returning a grant", async () => {
    const f = fixture(); f.tx.idempotencyRecord.create.mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(f.service.firstBindingDecision(owner, input)).rejects.toThrow("receipt unavailable");
  });
});
