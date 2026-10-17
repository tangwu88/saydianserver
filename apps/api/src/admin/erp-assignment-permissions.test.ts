import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AdminAuthGuard } from "./admin-auth";
import { AdminController } from "./admin.controller";
describe("ERP assignment write permission", () => {
  it.each([
    "SUPER_ADMIN",
    "COMMERCE_OPERATIONS",
    "READ_ONLY",
    "FINANCE",
    "CUSTOMER_SERVICE",
  ])("checks %s for preview and apply", async (role) => {
    const prisma = {
      adminSession: {
        findUnique: vi.fn(async () => ({
          id: "session",
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60000),
          admin: { id: "admin", role, roles: [role], active: true },
        })),
      },
    };
    const request = {
      path: "/api/saydian-app/admin/v1/commerce-products/id/erp-assignment",
      method: "POST",
      header: () => "Bearer synthetic",
    };
    const context = {
      getHandler: () => AdminController.prototype.reconcileCommerceProduct,
      getClass: () => AdminController,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    const result = new AdminAuthGuard(
      prisma as any,
      new Reflector(),
    ).canActivate(context as any);
    if (["SUPER_ADMIN", "COMMERCE_OPERATIONS"].includes(role))
      await expect(result).resolves.toBe(true);
    else await expect(result).rejects.toThrow();
  });
});
