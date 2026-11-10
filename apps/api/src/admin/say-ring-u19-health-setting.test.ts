import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { sayRingU19HealthOrClosed, sayRingU19HealthSettingKey } from "@saydian/app-contracts";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { AdminAuthGuard } from "./admin-auth";
import { writeSayRingU19Health } from "./say-ring-u19-health-setting";

function harness() {
  let settings = new Map<string, any>(), audits: any[] = [];
  const tx = {
    $executeRaw: vi.fn(async (..._args: unknown[]) => 1),
    appSetting: {
      findUnique: vi.fn(async ({ where }: any) => settings.get(where.key) ?? null),
      upsert: vi.fn(async ({ where, create, update }: any) => { const saved = settings.has(where.key) ? { ...settings.get(where.key), ...update } : create; settings.set(where.key, saved); return saved; }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }),
      findFirst: vi.fn(async ({ where }: any) => audits.filter(a => a.entityId === where.entityId && where.action.in.includes(a.action)).at(-1) ?? null),
    },
  };
  const prisma: any = { $transaction: vi.fn(async (work: any) => {
    const snapshot = structuredClone({ settings, audits });
    try { return await work(tx); }
    catch (error) { settings = snapshot.settings; audits = snapshot.audits; throw error; }
  }) };
  return { prisma, tx, settings: () => settings, audits: () => audits };
}
const enabled = { schemaVersion: 1 as const, validForSeconds: 300 as const, readMetrics: ["blood_pressure", "heart_rate", "blood_oxygen"], manualMetrics: ["blood_pressure"] };
describe("U19 setting strict authorization and isolation", () => {
  it("rejects mixed scopes, excessive validity and manual metrics without reading", async () => {
    const h = harness();
    for (const value of [
      { ...enabled, schemaVersion: 2 }, { ...enabled, validForSeconds: 301 },
      { ...enabled, readMetrics: ["blood_pressure", "hrv"] },
      { ...enabled, readMetrics: [], manualMetrics: ["blood_pressure"] },
      { ...enabled, readMetrics: ["heart_rate", "heart_rate"] },
      { ...enabled, memberId: "special-account" },
    ]) await expect(writeSayRingU19Health(h.prisma, "admin", { value, expectedUpdatedAt: null })).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("saves only U19 with independent actor and before/after audit", async () => {
    const h = harness();
    h.settings().set("say_ring_ios_health_display", { value: "untouched health marker" });
    const service = new AdminService(h.prisma, {} as any);
    const saved = await service.updateSetting(sayRingU19HealthSettingKey, { value: enabled, public: true, expectedUpdatedAt: null }, "synthetic-admin");
    expect(saved).toMatchObject({ key: sayRingU19HealthSettingKey, value: enabled, public: true });
    expect(h.audits()[0]).toMatchObject({ actorType: "ADMIN", actorId: "synthetic-admin", entityId: sayRingU19HealthSettingKey, action: "SAY_RING_U19_HEALTH_UPDATED", beforeJson: sayRingU19HealthOrClosed(), afterJson: enabled });
    expect(h.audits()[0].createdAt).toEqual(saved.updatedAt);
    expect(h.settings().get("say_ring_ios_health_display")).toEqual({ value: "untouched health marker" });
    expect(h.tx.$executeRaw.mock.calls.every(call => call[1] === sayRingU19HealthSettingKey)).toBe(true);
  });
  it("does not save when audit fails or when the revision is stale", async () => {
    const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(writeSayRingU19Health(h.prisma, "admin", { value: enabled, expectedUpdatedAt: null })).rejects.toThrow("audit unavailable");
    expect(h.settings().size).toBe(0);
    await writeSayRingU19Health(h.prisma, "admin", { value: enabled, expectedUpdatedAt: null });
    await expect(writeSayRingU19Health(h.prisma, "admin", { value: enabled, expectedUpdatedAt: null })).rejects.toThrow("已被更新");
  });
  it("rejects identity, schema, private publication, missing revision and fake previous state", async () => {
    const h = harness();
    await expect(writeSayRingU19Health(h.prisma, undefined, {})).rejects.toThrow("登录");
    for (const body of [{ value: enabled }, { value: enabled, expectedUpdatedAt: null, public: false }, { value: { ...enabled, accountId: "reviewer" }, expectedUpdatedAt: null }])
      await expect(writeSayRingU19Health(h.prisma, "admin", body)).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();

  });
  it("requires existing admin authentication and operator roles for save", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toContain(AdminAuthGuard);
    for (const method of [AdminController.prototype.updateSetting])
      expect(Reflect.getMetadata("saydian.admin-roles", method)).toEqual(["SUPER_ADMIN", "APP_OPERATIONS"]);
  });
});
