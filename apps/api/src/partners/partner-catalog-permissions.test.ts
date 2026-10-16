import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AdminAuthGuard } from "../admin/admin-auth";
import { PartnerAdminController } from "./partner-admin.controller";

describe("partner catalog write roles", () => {
  it.each(["SUPER_ADMIN", "COMMERCE_OPERATIONS", "READ_ONLY", "FINANCE", "CUSTOMER_SERVICE"])("checks %s for import and removal", async role => {
    for (const handler of ["importPrices", "deletePrices"] as const) {
      const request = { path: "/api/saydian-app/admin/v1/partner-prices/level/" + handler, method: "POST", header: () => "Bearer synthetic" };
      const prisma = { adminSession: { findUnique: vi.fn(async () => ({ id: "session", revokedAt: null, expiresAt: new Date(Date.now() + 60000), admin: { id: "admin", role, roles: [role], active: true } })) } };
      const context = { getHandler: () => PartnerAdminController.prototype[handler], getClass: () => PartnerAdminController, switchToHttp: () => ({ getRequest: () => request }) };
      const result = new AdminAuthGuard(prisma as any, new Reflector()).canActivate(context as any);
      if (["SUPER_ADMIN", "COMMERCE_OPERATIONS"].includes(role)) await expect(result).resolves.toBe(true);
      else await expect(result).rejects.toThrow();
    }
  });
});
