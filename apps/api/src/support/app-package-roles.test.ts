import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { expect, it, vi } from "vitest";
import { AdminAuthGuard } from "../admin/admin-auth";
import { AdminController } from "../admin/admin.controller";
it.each(["SUPER_ADMIN", "APP_OPERATIONS", "COMMERCE_OPERATIONS", "READ_ONLY", "FINANCE", "CUSTOMER_SERVICE"])("checks %s for every package session operation", async role => {
  for (const handler of ["startAppPackageUpload", "uploadAppPackagePart", "completeAppPackageUpload", "cancelAppPackageUpload"] as const) {
    const request = { path: "/api/saydian-app/admin/v1/app-packages/uploads/synthetic", method: "POST", header: () => "Bearer synthetic" };
    const prisma = { adminSession: { findUnique: vi.fn(async () => ({ id: "session", revokedAt: null, expiresAt: new Date(Date.now() + 60000), admin: { id: "admin", role, roles: [role], active: true } })) } };
    const context = { getHandler: () => AdminController.prototype[handler], getClass: () => AdminController, switchToHttp: () => ({ getRequest: () => request }) };
    const result = new AdminAuthGuard(prisma as any, new Reflector()).canActivate(context as any);
    if (["SUPER_ADMIN", "APP_OPERATIONS"].includes(role)) await expect(result).resolves.toBe(true);
    else await expect(result).rejects.toThrow();
  }
});
