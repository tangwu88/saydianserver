import { describe, expect, it, vi } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { sayRingIosHealthDisplayOrClosed } from "@saydian/app-contracts";
import { AdminController } from "./admin.controller";
import { AdminAuthGuard } from "./admin-auth";
import { AdminService } from "./admin.service";
import { writeCnDisplaySetting } from "./cn-display-setting";

const cnHealthKey = "cn_health_display";
function harness() {
  let current: any = null, audits: any[] = [], tick = 0;
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    appSetting: {
      findUnique: vi.fn(async () => current),
      upsert: vi.fn(async ({ create, update }: any) => current = { ...(current ? { ...current, ...update } : create), updatedAt: new Date(Date.UTC(2026, 9, 18, 0, 0, ++tick)) }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => { audits.push(data); return data; }),
      findFirst: vi.fn(async () => audits.at(-1)),
    },
  };
  const prisma: any = { $transaction: vi.fn(async (work: any) => {
    const snapshot = structuredClone({ current, audits });
    try { return await work(tx); }
    catch (error) { current = snapshot.current; audits = snapshot.audits; throw error; }
  }) };
  return { prisma, tx, current: () => current, audits: () => audits };
}
const enabled = () => ({ schemaVersion: 1, metrics: { ...sayRingIosHealthDisplayOrClosed().metrics, heart_rate: true, hrv: true, blood_oxygen: true } });
describe("auditable independent iOS display setting", () => {
  it("saves only this key with actor and reversible snapshots in the same transaction", async () => {
    const h = harness();
    const saved = await new AdminService(h.prisma, {} as any).updateSetting(cnHealthKey, { value: enabled(), expectedUpdatedAt: null }, "synthetic-admin");
    expect(saved.key).toBe(cnHealthKey);
    expect(saved.value).toEqual(enabled());
    expect(h.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(h.audits()[0]).toMatchObject({ actorId: "synthetic-admin", beforeJson: sayRingIosHealthDisplayOrClosed(), afterJson: enabled() });
    expect(h.audits()[0].createdAt).toEqual(saved.updatedAt);
    const restored = await writeCnDisplaySetting(h.prisma, "synthetic-admin", "cn_health_display", { expectedUpdatedAt: saved.updatedAt.toISOString() }, true);
    expect(restored.value).toEqual(sayRingIosHealthDisplayOrClosed());
    expect(h.audits()[1].action).toBe("CN_HEALTH_DISPLAY_ROLLED_BACK");
  });
  it("audits and restores the independent CN module key", async()=>{
    const h=harness();const value={schemaVersion:1,modules:{health_library:true,mall:false}};
    const saved=await new AdminService(h.prisma,{} as any).updateSetting("cn_module_display",{value,expectedUpdatedAt:null},"admin");
    expect(saved.key).toBe("cn_module_display");expect(h.audits()[0].entityId).toBe("cn_module_display");
    const restored=await writeCnDisplaySetting(h.prisma,"admin","cn_module_display",{expectedUpdatedAt:saved.updatedAt.toISOString()},true);
    expect(restored.value).toEqual({schemaVersion:1,modules:{health_library:false,mall:false}});
    expect(h.audits()[1].action).toBe("CN_MODULE_DISPLAY_ROLLED_BACK");
  });
  it("rolls back the setting if durable audit persistence fails", async () => {
    const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error("synthetic audit failure"));
    await expect(writeCnDisplaySetting(h.prisma, "admin", "cn_health_display", { value: enabled(), expectedUpdatedAt: null })).rejects.toThrow("audit failure");
    expect(h.current()).toBeNull(); expect(h.audits()).toEqual([]);
  });
  it("rejects stale edits and rollbacks before writing", async () => {
    const h = harness(); await writeCnDisplaySetting(h.prisma, "admin", "cn_health_display", { value: enabled(), expectedUpdatedAt: null });
    for (const rollback of [false, true]) await expect(writeCnDisplaySetting(h.prisma, "admin", "cn_health_display", { value: enabled(), expectedUpdatedAt: null }, rollback)).rejects.toThrow("已被更新");
    expect(h.tx.appSetting.upsert).toHaveBeenCalledOnce();
  });
  it("rejects missing identity, revision, private publication and unsupported features", async () => {
    const h = harness();
    await expect(writeCnDisplaySetting(h.prisma, undefined, "cn_health_display", {})).rejects.toThrow("登录");
    for (const body of [{ value: enabled() }, { value: enabled(), expectedUpdatedAt: null, public: false }, { value: { ...enabled(), ai: true }, expectedUpdatedAt: null }])
      await expect(writeCnDisplaySetting(h.prisma, "admin", "cn_health_display", body)).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("does not invent a previous version", async () => {
    const h = harness();
    await expect(writeCnDisplaySetting(h.prisma, "admin", "cn_health_display", { expectedUpdatedAt: null }, true)).rejects.toThrow("没有可恢复");
    expect(h.tx.appSetting.upsert).not.toHaveBeenCalled();
  });
  it("keeps both save and rollback behind the admin guard and existing operator roles", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toContain(AdminAuthGuard);
    for (const method of [AdminController.prototype.updateSetting, AdminController.prototype.rollbackSayRingIosHealthDisplay])
      expect(Reflect.getMetadata("saydian.admin-roles", method)).toEqual(["SUPER_ADMIN", "APP_OPERATIONS"]);
  });
});
