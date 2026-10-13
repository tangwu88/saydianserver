import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AdminAuthGuard } from "../admin/admin-auth";
import { PartnerAdminController } from "./partner-admin.controller";

describe("manual partner funds permissions", () => {
  it.each(["FINANCE", "COMMERCE_OPERATIONS", "READ_ONLY", "CUSTOMER_SERVICE"])(
    "denies %s on both manual money endpoints",
    async (role) => {
      for (const [handler, suffix] of [
        ["deposit", "deposit"],
        ["rechargeBalance", "balance-recharge"],
      ] as const) {
        const prisma = {
          adminSession: {
            findUnique: vi
              .fn()
              .mockResolvedValue({
                id: "session",
                expiresAt: new Date(Date.now() + 60000),
                revokedAt: null,
                admin: { id: "admin", active: true, role, roles: [role] },
              }),
          },
        };
        const request = {
          path: `/api/saydian-app/admin/v1/partner-finance/partner/${suffix}`,
          method: "POST",
          header: () => "Bearer synthetic",
        };
        const context = {
          getHandler: () => PartnerAdminController.prototype[handler],
          getClass: () => PartnerAdminController,
          switchToHttp: () => ({ getRequest: () => request }),
        };
        await expect(
          new AdminAuthGuard(prisma as any, new Reflector()).canActivate(
            context as any,
          ),
        ).rejects.toThrow("无权执行");
      }
    },
  );
  it("permits a verified SUPER_ADMIN on both endpoints", async () => {
    for (const handler of ["deposit", "rechargeBalance"] as const) {
      const prisma = {
        adminSession: {
          findUnique: vi
            .fn()
            .mockResolvedValue({
              id: "session",
              expiresAt: new Date(Date.now() + 60000),
              revokedAt: null,
              admin: {
                id: "admin",
                active: true,
                role: "SUPER_ADMIN",
                roles: ["SUPER_ADMIN"],
              },
            }),
        },
      };
      const request = {
        path: "/api/saydian-app/admin/v1/partner-finance/partner/deposit",
        method: "POST",
        header: () => "Bearer synthetic",
      };
      const context = {
        getHandler: () => PartnerAdminController.prototype[handler],
        getClass: () => PartnerAdminController,
        switchToHttp: () => ({ getRequest: () => request }),
      };
      await expect(
        new AdminAuthGuard(prisma as any, new Reflector()).canActivate(
          context as any,
        ),
      ).resolves.toBe(true);
    }
  });
});
