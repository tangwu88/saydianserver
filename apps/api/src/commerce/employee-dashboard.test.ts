import "reflect-metadata";
import { describe, expect, it, vi, afterEach } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { employeeDashboardQuery } from "./employee-dashboard-query";
import { EmployeePromotionService } from "./employee-promotion.service";
import { CommerceEmployeeController } from "./commerce-employee.controller";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
const now = new Date("2026-09-09T05:00:00Z");
afterEach(() => vi.unstubAllEnvs());

describe("employee dashboard filters", () => {
  it("uses Beijing calendar boundaries and actual pagination", () => {
    const q = employeeDashboardQuery({ range: "7d", page: "3", pageSize: "5" }, now);
    expect(q.start.toISOString()).toBe("2026-09-02T16:00:00.000Z");
    expect(q.end.toISOString()).toBe("2026-09-09T16:00:00.000Z");
    expect(q.skip).toBe(10); expect(q.pageSize).toBe(5);
    const custom = employeeDashboardQuery({ from: "2026-09-01", to: "2026-09-01" }, now);
    expect(custom.end.valueOf() - custom.start.valueOf()).toBe(86400000);
  });
  it.each([
    { range: "unexpected" }, { range: "today", from: "2026-09-01" },
    { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-09-01" },
    { from: "2020-01-01", to: "2026-09-01" }, { page: "-1" }, { pageSize: "101" },
  ])("rejects invalid filters instead of silently broadening the data scope", query => {
    expect(() => employeeDashboardQuery(query, now)).toThrow();
  });
  it("forwards query filters but always uses the authenticated employee ID", () => {
    const dashboard = vi.fn();
    new CommerceEmployeeController({ dashboard } as unknown as EmployeePromotionService)
      .dashboard({ id: "guard-employee" }, { range: "today", page: "2" });
    expect(dashboard).toHaveBeenCalledWith("guard-employee", { range: "today", page: "2" });
  });
  it("scopes every order/refund query to employee and range, keeps unknown wallet/trend unknown", async () => {
    const db = {
      commerceEmployee: { findFirstOrThrow: vi.fn(async () => ({ id: "employee-1" })) },
      commerceOrder: { aggregate: vi.fn(async () => ({ _count: 0, _sum: { payableCents: null } })),
        findMany: vi.fn(async () => []), count: vi.fn(async () => 42) },
      paymentRefund: { aggregate: vi.fn(async () => ({ _sum: { amountCents: null } })) },
      commerceCommissionPlan: { findUnique: vi.fn(async () => null) },
      commerceCommissionAccrual: { findMany: vi.fn(async () => []) },
    };
    const withdrawals = { employeeSummary: vi.fn(async () => ({ wallet: null, plan: { enabled: false, minimumWithdrawCents: null,
      dailyWithdrawLimitCents: null }, withdrawals: [], canApply: false, identity: { verified: false }, pendingCount: 0,
      dailyUsedCents: 0, dailyRemainingCents: null, availableAmountCents: null, payoutMode: "MANUAL_RECEIPT_ONLY" })) };
    const service = new EmployeePromotionService(db as unknown as PrismaService, {} as IntegrationSecretsService, withdrawals as unknown as CommerceWithdrawalService);
    vi.spyOn(service, "promotion").mockRejectedValue(new ServiceUnavailableException("未配置"));
    const result = await service.dashboard("employee-1", { from: "2026-09-01", to: "2026-09-02", page: "2", pageSize: "5" });
    expect(db.commerceOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { referralEmployeeId: "employee-1",
      createdAt: { gte: new Date("2026-08-31T16:00:00Z"), lt: new Date("2026-09-02T16:00:00Z") } }, skip: 5, take: 5 }));
    expect(db.paymentRefund.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      paymentIntent: { commerceOrder: { is: { referralEmployeeId: "employee-1" } } } }) }));
    expect(result.pagination).toEqual({ page: 2, pageSize: 5, total: 42, hasMore: true });
    expect(result.bonus.wallet).toBeNull(); expect(result.bonus.plan).toBeNull();
    expect(result.trend).toBeNull(); expect(result.promotionStatus).toBe("UNCONFIGURED");
    expect(result.salesCents).toBe(0); // verified empty SQL aggregate, not an unavailable wallet
  });
  it("generates promotion without fetching enterprise-WeChat credentials", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("COMMERCE_STOREFRONT_URL", "http://127.0.0.1:5174/saidian-mall");
    const db = { commerceEmployee: { findFirstOrThrow: async () => ({ name: "演示员工", referralCode: "DEMO" }) },
      integrationConfig: { findUnique: async () => ({ state: "UNCONFIGURED", publicConfig: {} }) } };
    const resolve = vi.fn();
    const service = new EmployeePromotionService(db as unknown as PrismaService, { resolve } as unknown as IntegrationSecretsService, {} as CommerceWithdrawalService);
    const promotion = await service.promotion("employee-1");
    expect(promotion.linkUrl).toContain("http://127.0.0.1:5174/saidian-mall/?ref=DEMO");
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("employee withdrawal summary agrees with application limits", () => {
  it("does not advertise eligibility when the remaining daily allowance is below the minimum", async () => {
    const db = {
      commerceEmployeeWallet: { findUnique: async () => ({ availableCents: 1000, debtCents: 0 }) },
      commerceEmployeePayoutIdentity: { findUnique: async () => ({ verifiedAt: now, verificationEvidence: "test",
        openId: "do-not-expose", authorizationId: "test-authorization", authorizationStatus: "ACTIVE" }) },
      commerceWithdrawal: { findMany: async () => [], count: async () => 0, aggregate: async () => ({ _sum: { amountCents: 450 } }) },
      commerceCommissionPlan: { findUnique: async () => ({ enabled: true, withdrawalEnabled: true, minimumWithdrawCents: 100,
        dailyWithdrawLimitCents: 500, settlementDays: 7 }) },
    };
    const result = await new CommerceWithdrawalService(db as unknown as PrismaService).employeeSummary("employee-1");
    expect(result.dailyRemainingCents).toBe(50); expect(result.availableAmountCents).toBe(50);
    expect(result.canApply).toBe(false); expect(JSON.stringify(result)).not.toContain("do-not-expose");
  });
});
