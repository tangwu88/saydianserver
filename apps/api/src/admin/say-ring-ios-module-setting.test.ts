import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { sayRingIosModuleDisplayOrClosed, sayRingIosModuleSettingKey } from "@saydian/app-contracts";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { AdminAuthGuard } from "./admin-auth";
import { writeSayRingIosModuleDisplay } from "./say-ring-ios-module-setting";

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
const enabled = { schemaVersion: 1, modules: { health_library: true, mall: false } };
describe("module setting durable isolation and rollback", () => {
  it("saves and rolls back with independent actor and before/after audit", async () => {
    const h = harness();
    h.settings().set("say_ring_ios_health_display", { value: "untouched health marker" });
    const service = new AdminService(h.prisma, {} as any);
    const saved = await service.updateSetting(sayRingIosModuleSettingKey, { value: enabled, public: true, expectedUpdatedAt: null }, "synthetic-admin");
    expect(saved).toMatchObject({ key: sayRingIosModuleSettingKey, value: enabled, public: true });
    expect(h.audits()[0]).toMatchObject({ actorType: "ADMIN", actorId: "synthetic-admin", entityId: sayRingIosModuleSettingKey, action: "SAY_RING_IOS_MODULE_DISPLAY_UPDATED", beforeJson: sayRingIosModuleDisplayOrClosed(), afterJson: enabled });
    expect(h.audits()[0].createdAt).toEqual(saved.updatedAt);
    const restored = await service.rollbackSayRingIosModuleDisplay("synthetic-admin", { expectedUpdatedAt: saved.updatedAt.toISOString() });
    expect(restored.value).toEqual(sayRingIosModuleDisplayOrClosed());
    expect(h.audits()[1].action).toBe("SAY_RING_IOS_MODULE_DISPLAY_ROLLED_BACK");
    expect(h.settings().get("say_ring_ios_health_display")).toEqual({ value: "untouched health marker" });
    expect(h.tx.$executeRaw.mock.calls.every(call => call[1] === sayRingIosModuleSettingKey)).toBe(true);
  });
  it("does not save when audit fails or when the revision is stale", async () => {
    const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(writeSayRingIosModuleDisplay(h.prisma, "admin", { value: enabled, expectedUpdatedAt: null })).rejects.toThrow("audit unavailable");
    expect(h.settings().size).toBe(0);
    await writeSayRingIosModuleDisplay(h.prisma, "admin", { value: enabled, expectedUpdatedAt: null });
    for (const rollback of [false, true]) await expect(writeSayRingIosModuleDisplay(h.prisma, "admin", { value: enabled, expectedUpdatedAt: null }, rollback)).rejects.toThrow("已被更新");
  });
  it("rejects identity, schema, private publication, missing revision and fake previous state", async () => {
    const h = harness();
    await expect(writeSayRingIosModuleDisplay(h.prisma, undefined, {})).rejects.toThrow("登录");
    for (const body of [{ value: enabled }, { value: enabled, expectedUpdatedAt: null, public: false }, { value: { ...enabled, accountId: "reviewer" }, expectedUpdatedAt: null }])
      await expect(writeSayRingIosModuleDisplay(h.prisma, "admin", body)).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    await expect(writeSayRingIosModuleDisplay(h.prisma, "admin", { expectedUpdatedAt: null }, true)).rejects.toThrow("没有可恢复");
  });
  it("requires existing admin authentication and operator roles for save and rollback", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toContain(AdminAuthGuard);
    for (const method of [AdminController.prototype.updateSetting, AdminController.prototype.rollbackSayRingIosModuleDisplay])
      expect(Reflect.getMetadata("saydian.admin-roles", method)).toEqual(["SUPER_ADMIN", "APP_OPERATIONS"]);
  });
  it("does not normalize corrupted audit snapshots into a valid closed state", async () => {
    const h = harness();
    const saved = await writeSayRingIosModuleDisplay(h.prisma, "admin", { value: sayRingIosModuleDisplayOrClosed(), expectedUpdatedAt: null });
    h.audits()[0].afterJson = {};
    await expect(writeSayRingIosModuleDisplay(h.prisma, "admin", { expectedUpdatedAt: saved.updatedAt.toISOString() }, true)).rejects.toThrow("审计不一致");
    expect(h.tx.appSetting.upsert).toHaveBeenCalledOnce();
  });
});
