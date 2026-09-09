import { describe, expect, it, vi } from "vitest";
import { HealthService } from "./health.service";
import type { PrismaService } from "../common/prisma.service";

const userId = "11111111-1111-4111-a111-111111111111";
const foreignId = "22222222-2222-4222-a222-222222222222";
function harness() {
  let rows: any[] = [
    { userId, metric: "HEART_RATE", highThreshold: 120, enabled: true },
    { userId: foreignId, metric: "HEART_RATE", highThreshold: 140, enabled: true },
  ];
  let failMetric: string | undefined;
  const tx: any = { healthWarningRule: {
    upsert: vi.fn(async ({ where, create, update }: any) => {
      const key = where.userId_metric;
      if (key.metric === failMetric) throw new Error("synthetic write failure");
      const index = rows.findIndex(row => row.userId === key.userId && row.metric === key.metric);
      if (index < 0) { rows.push(create); return create; }
      rows[index] = { ...rows[index], ...update }; return rows[index];
    }),
    findMany: vi.fn(async ({ where }: any) => rows.filter(row => row.userId === where.userId)),
  } };
  const prisma: any = {
    healthWarningRule: { upsert: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(async (work: any) => {
      const before = structuredClone(rows);
      try { return await work(tx); } catch (error) { rows = before; throw error; }
    }),
  };
  return { service: new HealthService(prisma as PrismaService), prisma, tx,
    rows: () => structuredClone(rows), failOn: (metric: string) => { failMetric = metric; } };
}
describe("health warning-rule batch atomicity", () => {
  it("does not write the earlier valid rule when a later metric is invalid", async () => {
    const h = harness(), before = h.rows();
    await expect(h.service.saveWarningRules(userId, { rules: [
      { metric: "heart_rate", highThreshold: 130 }, { metric: "unsupported", highThreshold: 1 },
    ] })).rejects.toThrow("预警指标不正确");
    expect(h.rows()).toEqual(before); expect(h.tx.healthWarningRule.upsert).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("validates thresholds of every rule before any write", async () => {
    for (const invalid of [
      { metric: "blood_pressure", lowThreshold: 150, highThreshold: 100 },
      { metric: "blood_pressure", secondaryHighThreshold: "not-a-number" },
    ]) {
      const h = harness(), before = h.rows();
      await expect(h.service.saveWarningRules(userId, { rules: [{ metric: "heart_rate", highThreshold: 130 }, invalid] })).rejects.toThrow();
      expect(h.rows()).toEqual(before); expect(h.tx.healthWarningRule.upsert).not.toHaveBeenCalled();
    }
  });
  it("rolls back an earlier saved rule if a subsequent storage operation fails", async () => {
    const h = harness(), before = h.rows(); h.failOn("STEPS");
    await expect(h.service.saveWarningRules(userId, { rules: [
      { metric: "heart_rate", highThreshold: 130 }, { metric: "steps", highThreshold: 10000 },
    ] })).rejects.toThrow("synthetic write failure");
    expect(h.tx.healthWarningRule.upsert).toHaveBeenCalledTimes(2);
    expect(h.rows()).toEqual(before);
    expect(h.prisma.healthWarningRule.upsert).not.toHaveBeenCalled();
  });
  it("commits the complete valid batch and reads its response inside that transaction", async () => {
    const h = harness();
    const result = await h.service.saveWarningRules(userId, { rules: [
      { metric: "heart_rate", highThreshold: 130, secondaryHighThreshold: 999, enabled: false },
      { metric: "blood_pressure", lowThreshold: null, highThreshold: 140, secondaryHighThreshold: 90, shareWithCare: true },
    ] });
    expect(result).toHaveLength(2);
    expect(result.find((row: any) => row.metric === "HEART_RATE")).toMatchObject({ highThreshold: 130, secondaryHighThreshold: null, enabled: false });
    expect(result.find((row: any) => row.metric === "BLOOD_PRESSURE")).toMatchObject({ secondaryHighThreshold: 90, lowThreshold: null, shareWithCare: true });
    expect(h.rows().find(row => row.userId === foreignId)?.highThreshold).toBe(140);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.healthWarningRule.findMany).toHaveBeenCalledWith({ where: { userId } });
    expect(h.prisma.healthWarningRule.findMany).not.toHaveBeenCalled();
  });
  it("preserves the existing empty-batch behavior without writing", async () => {
    const h = harness(), before = h.rows();
    expect(await h.service.saveWarningRules(userId, { rules: [] })).toHaveLength(1);
    expect(h.rows()).toEqual(before); expect(h.tx.healthWarningRule.upsert).not.toHaveBeenCalled();
  });
  it("rejects oversized batches before starting a transaction", async () => {
    const h = harness();
    await expect(h.service.saveWarningRules(userId, { rules: Array.from({ length: 21 }, () => ({ metric: "heart_rate" })) })).rejects.toThrow("数量过多");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
