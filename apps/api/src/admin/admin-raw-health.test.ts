import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";

const superAdmin = { id: "admin-id", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };
const auditor = { id: "auditor-id", role: "HEALTH_AUDITOR", roles: ["HEALTH_AUDITOR"] };
function harness() {
  const healthRecord = { findMany: vi.fn().mockResolvedValue([{ id: "synthetic-record" }]) };
  const auditLog = { create: vi.fn().mockResolvedValue({}) };
  return { healthRecord, auditLog, service: new AdminService({ healthRecord, auditLog } as any, {} as any) };
}
beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

describe("raw health access without a manual super-admin reason", () => {
  it.each([superAdmin, { ...superAdmin, role: "HEALTH_AUDITOR", roles: ["HEALTH_AUDITOR", "SUPER_ADMIN"] }, { id: "admin-id", role: "SUPER_ADMIN" }])("allows a verified super-admin role and still audits before returning", async current => {
    const h = harness();
    expect(await h.service.rawHealth(current, "member-id", "request-id", "  ")).toEqual([{ id: "synthetic-record" }]);
    expect(h.auditLog.create).toHaveBeenCalledExactlyOnceWith({ data: {
      actorType: "ADMIN", actorId: "admin-id", action: "HEALTH_RAW_READ", entityType: "USER", entityId: "member-id", requestId: "request-id",
      afterJson: { recordCount: 1, reason: "超级管理员直接查看（免填原因）", reasonSource: "SUPER_ADMIN_EXEMPTION" },
    } });
  });

  it.each(["", "short".slice(0, 4), "x".repeat(301)])("requires a valid auditor reason: %s", async reason => {
    const h = harness();
    await expect(h.service.rawHealth(auditor, "member-id", "request-id", reason)).rejects.toThrow("5至300字");
    expect(h.healthRecord.findMany).not.toHaveBeenCalled(); expect(h.auditLog.create).not.toHaveBeenCalled();
  });

  it("preserves a supplied reason, including for super administrators", async () => {
    for (const current of [superAdmin, auditor]) {
      const h = harness();
      await h.service.rawHealth(current, "member-id", "request-id", "  合成记录排障验证  ", 999);
      expect(h.healthRecord.findMany).toHaveBeenCalledWith({ where: { userId: "member-id" }, orderBy: { observedAt: "desc" }, take: 500 });
      expect(h.auditLog.create.mock.calls[0]?.[0].data.afterJson).toEqual({ recordCount: 1, reason: "合成记录排障验证", reasonSource: "PROVIDED" });
    }
  });

  it("does not treat an obsolete primary role as super-admin when current roles are restricted", async () => {
    const h = harness();
    await expect(h.service.rawHealth({ ...superAdmin, roles: ["HEALTH_AUDITOR"] }, "member-id", "r", "")).rejects.toThrow("5至300字");
    await expect(h.service.rawHealth({ ...superAdmin, roles: ["READ_ONLY"] }, "member-id", "r", "valid reason")).rejects.toThrow("无权查看");
    expect(h.healthRecord.findMany).not.toHaveBeenCalled();
  });

  it("does not release records when audit persistence fails", async () => {
    const h = harness(); h.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(h.service.rawHealth(superAdmin, "member-id", "request-id", "")).rejects.toThrow("audit unavailable");
  });

  it("does not change the domestic reason policy or audit shape", async () => {
    vi.stubEnv("APP_REALM", "domestic"); const h = harness();
    await expect(h.service.rawHealth(superAdmin, "member-id", "r", "")).rejects.toThrow("5至300字");
    await h.service.rawHealth(superAdmin, "member-id", "r", "已有人工审核原因");
    expect(h.auditLog.create.mock.calls[0]?.[0].data.afterJson).toEqual({ recordCount: 1, reason: "已有人工审核原因" });
  });

  it("takes authorization roles only from the authenticated context, not request query claims", () => {
    const admin = { rawHealth: vi.fn() };
    const controller = new AdminController(admin as any, {} as any, {} as any);
    controller.rawHealth(auditor, "member-id", { requestId: "r", query: { role: "SUPER_ADMIN", reasonExempt: "true" } } as any);
    expect(admin.rawHealth).toHaveBeenCalledExactlyOnceWith(auditor, "member-id", "r", "", 100);
  });
});
