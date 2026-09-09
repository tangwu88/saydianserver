import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AdminAuthGuard } from "./admin-auth";

function fixture(role: string, roles: string[] | undefined, path: string, method = "GET", required?: string[]) {
  const request = { path: `/api/saydian-app/admin/v1/${path}`, method, header: () => "Bearer test", authAdmin: undefined as any };
  const prisma = { adminSession: { findUnique: vi.fn().mockResolvedValue({ id: "s", revokedAt: null, expiresAt: new Date(Date.now() + 60000), admin: { id: "a", role, roles, active: true } }) } };
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(required) };
  const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => null, getClass: () => null } as unknown as ExecutionContext;
  return { guard: new AdminAuthGuard(prisma as any, reflector as any), context, request };
}

describe("administrator authentication and resource authorization", () => {
  it("accepts the union of stored roles for route-specific financial actions", async () => {
    const state = fixture("COMMERCE_OPERATIONS", ["COMMERCE_OPERATIONS", "FINANCE"], "commerce-after-sales/s/refunds", "POST", ["SUPER_ADMIN", "FINANCE"]);
    await expect(state.guard.canActivate(state.context)).resolves.toBe(true);
    expect(state.request.authAdmin.roles).toEqual(["COMMERCE_OPERATIONS", "FINANCE"]);
  });
  it("keeps legacy primary-role sessions working and prevents arbitrary sensitive GETs", async () => {
    const legacy = fixture("FINANCE", undefined, "payments");
    await expect(legacy.guard.canActivate(legacy.context)).resolves.toBe(true);
    const restricted = fixture("CONTENT_EDITOR", ["CONTENT_EDITOR"], "members");
    await expect(restricted.guard.canActivate(restricted.context)).rejects.toThrow("业务模块");
  });
  it("does not let resource-level membership bypass a narrower raw-health guard", async () => {
    const state = fixture("APP_OPERATIONS", ["APP_OPERATIONS"], "members/u/health-records", "GET", ["SUPER_ADMIN", "HEALTH_AUDITOR"]);
    await expect(state.guard.canActivate(state.context)).rejects.toThrow("无权执行");
  });
});
