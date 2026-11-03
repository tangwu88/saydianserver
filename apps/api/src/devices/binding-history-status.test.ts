import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DevicesService } from "./devices.service";

const owner = "member-one";
const deviceId = "qring:SYNTHETIC_R8";
const hardwareKey = createHash("sha256").update(`${owner}:${deviceId}`).digest("hex");
const targetDate = new Date("2026-11-02T03:00:00.000Z");
type Row = { id: string; userId: string; hardwareKey: string; createdAt: Date; unboundAt?: Date };
const target: Row = { id: "target", userId: owner, hardwareKey, createdAt: targetDate };
const prior: Row = { id: "prior", userId: owner, hardwareKey: "different-ring", createdAt: new Date("2026-11-01T03:00:00.000Z") };

function fixture(rows: Row[]) {
  const findFirst = vi.fn(async ({ where }: any) => rows.find(row =>
    row.userId === where.userId &&
    (!where.hardwareKey || row.hardwareKey === where.hardwareKey) &&
    (!where.id?.not || row.id !== where.id.not) &&
    (!where.createdAt?.lt || row.createdAt < where.createdAt.lt)
  ) ?? null);
  const lock = vi.fn(async () => []);
  const tx = { deviceBinding: { findFirst }, $queryRaw: lock };
  return { service: new DevicesService({ $transaction: async (fn: any) => fn(tx) } as any), findFirst, lock };
}

describe("Say Ring read-only binding history recovery", () => {
  it("confirms older lifetime history including unbound rings without writing", async () => {
    const rows = [{ ...prior, unboundAt: new Date() }, target];
    const before = JSON.stringify(rows);
    const f = fixture(rows);
    expect(await f.service.bindingHistoryStatus(owner, "say-ring", deviceId)).toEqual({
      product: "say-ring", deviceId, priorBindingConfirmed: true,
    });
    expect(JSON.stringify(rows)).toBe(before);
    expect(f.findFirst.mock.calls.every(([args]) => !args.where.unboundAt)).toBe(true);
  });

  it.each([
    ["first device only", [target]],
    ["another account's older ring", [{ ...prior, userId: "member-two" }, target]],
    ["a later bound ring", [{ ...prior, createdAt: new Date("2026-11-03T03:00:00Z") }, target]],
    ["equal timestamps", [{ ...prior, createdAt: targetDate }, target]],
    ["overlapping first-binding transaction window", [{ ...prior, createdAt: new Date(targetDate.getTime() - 4_000) }, target]],
    ["confirmation window boundary", [{ ...prior, createdAt: new Date(targetDate.getTime() - 30_000) }, target]],
    ["no target or lifetime history", []],
    ["missing target and only another member history", [{ ...prior, userId: "member-two" }]],
  ])("keeps %s unconfirmed", async (_name, rows) => {
    const f = fixture(rows as Row[]);
    expect((await f.service.bindingHistoryStatus(owner, "say-ring", deviceId)).priorBindingConfirmed).toBe(false);
  });

  it.each([["saydian-global", deviceId], ["say-ring", ""], ["say-ring", "x".repeat(513)]])(
    "rejects invalid product/target before querying",
    async (product, id) => {
      const f = fixture([prior, target]);
      await expect(f.service.bindingHistoryStatus(owner, product, id)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.findFirst).not.toHaveBeenCalled();
    },
  );

  it("recovers an old member whose exact target report was never committed", async () => {
    const f = fixture([{ ...prior, unboundAt: new Date() }]);
    expect((await f.service.bindingHistoryStatus(owner, "say-ring", deviceId)).priorBindingConfirmed).toBe(true);
    expect(f.lock.mock.invocationCallOrder[0]!).toBeLessThan(f.findFirst.mock.invocationCallOrder[0]!);
    expect(f.findFirst).toHaveBeenCalledTimes(2);
  });
});
