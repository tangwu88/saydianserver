import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

describe("commerce administration", () => {
  it("refuses editing ERP SKU authority through the local product form", async () => {
    const prisma = { commerceProduct: { findUnique: vi.fn().mockResolvedValue({ source: "ERP", name: "ERP watch", erpItemId: "E", skus: [] }) } };
    const service = new AdminService(prisma as any, {} as any);
    await expect(service.saveCommerceProduct("p", { skus: [{ salePriceCents: 1 }] })).rejects.toThrow("ERP");
    await expect(service.saveCommerceProduct(undefined, { source: "ERP" })).rejects.toThrow("同步");
  });
  it("quick-updates selected SKU prices and stock with stale-write protection", async () => {
    const updatedAt = new Date("2026-09-11T08:00:00.000Z");
    const product = { id: "p", source: "ERP", skus: [{ id: "s", updatedAt }] };
    const saved = { ...product, skus: [{ id: "s", salePriceCents: 149800, stock: 20, updatedAt: new Date() }] };
    const tx = {
      commerceSku: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      commerceProduct: { update: vi.fn().mockResolvedValue(product), findUniqueOrThrow: vi.fn().mockResolvedValue(saved) },
    };
    const prisma = {
      commerceProduct: { findUnique: vi.fn().mockResolvedValue(product) },
      $transaction: vi.fn().mockImplementation(async (run) => run(tx)),
    };
    const result = await new AdminService(prisma as any, {} as any).quickUpdateCommerceProductSkus("p", {
      skus: [{ id: "s", updatedAt: updatedAt.toISOString(), salePriceCents: 149800, stock: 20 }],
    });
    expect(tx.commerceSku.updateMany).toHaveBeenCalledWith({
      where: { id: "s", productId: "p", updatedAt },
      data: { salePriceCents: 149800, stock: 20 },
    });
    expect(tx.commerceProduct.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { updatedAt: expect.any(Date) } });
    expect(result).toBe(saved);
  });
  it("rejects foreign, duplicate, invalid and stale SKU adjustments", async () => {
    const updatedAt = new Date("2026-09-11T08:00:00.000Z");
    const product = { id: "p", source: "ERP", skus: [{ id: "s", updatedAt }] };
    const tx = {
      commerceSku: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      commerceProduct: { update: vi.fn(), findUniqueOrThrow: vi.fn() },
    };
    const prisma = {
      commerceProduct: { findUnique: vi.fn().mockResolvedValue(product) },
      $transaction: vi.fn().mockImplementation(async (run) => run(tx)),
    };
    const service = new AdminService(prisma as any, {} as any);
    const valid = { id: "s", updatedAt: updatedAt.toISOString(), salePriceCents: 100, stock: 0 };
    await expect(service.quickUpdateCommerceProductSkus("p", { skus: [{ ...valid, id: "foreign" }] })).rejects.toThrow("不属于");
    await expect(service.quickUpdateCommerceProductSkus("p", { skus: [valid, valid] })).rejects.toThrow("重复");
    await expect(service.quickUpdateCommerceProductSkus("p", { skus: [{ ...valid, salePriceCents: 0 }] })).rejects.toThrow("销售价格");
    await expect(service.quickUpdateCommerceProductSkus("p", { skus: [valid] })).rejects.toThrow("已被更新");
    expect(tx.commerceProduct.update).not.toHaveBeenCalled();
    expect(tx.commerceProduct.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("rejects stale order edits instead of silently overwriting a newer remark", async () => {
    const prisma = { commerceOrder: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const service = new AdminService(prisma as any, {} as any);
    await expect(service.updateCommerceOrder("o", { adminRemark: "旧表单", version: 2 })).rejects.toThrow("已更新");
    expect(prisma.commerceOrder.updateMany).toHaveBeenCalledWith({ where: { id: "o", version: 2, executionOwner: "NEW_SYSTEM" }, data: { adminRemark: "旧表单", version: { increment: 1 } } });
  });
  it("does not reopen completed refunds through a stale audit form", async () => {
    const tx = { $queryRaw: vi.fn(), commerceAfterSale: { findUnique: vi.fn().mockResolvedValue({ orderId: "order", status: "COMPLETED", executionOwner: "NEW_SYSTEM", order: { executionOwner: "NEW_SYSTEM" } }), updateMany: vi.fn() } };
    const prisma = { $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)) };
    await expect(new AdminService(prisma as any, {} as any).updateCommerceAfterSale("s", { status: "APPROVED", version: 0 })).rejects.toThrow("不能");
    expect(tx.commerceAfterSale.updateMany).not.toHaveBeenCalled();
  });
  it("requires explicit withdrawal limits and human review before enabling withdrawals", async () => {
    const service = new AdminService({} as any, {} as any);
    const base = { enabled: true, rateBps: 100, settlementDays: 7, withdrawalEnabled: true, reviewRequired: true };
    await expect(service.saveCommerceCommissionPlan(base)).rejects.toThrow("最低提现金额");
    await expect(service.saveCommerceCommissionPlan({ ...base, minimumWithdrawCents: 100, dailyWithdrawLimitCents: 99 })).rejects.toThrow("每日提现额度");
    await expect(service.saveCommerceCommissionPlan({ ...base, minimumWithdrawCents: 100, reviewRequired: false })).rejects.toThrow("人工审核");
  });
  it("normalizes a customer coupon code and stores it in the existing unique external-id slot", async () => {
    const saved = { id: "coupon", legacyId: "SAVE10" };
    const prisma = { commerceCoupon: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(saved) } };
    const result = await new AdminService(prisma as any, {} as any).saveCommerceCoupon(undefined, {
      name: "满 100 减 10", redemptionCode: " save10 ", status: "ACTIVE", value: 1000,
      minimumSpendCents: 10000, totalQuantity: 100, validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2026-10-01T00:00:00.000Z",
    });
    expect(result).toBe(saved);
    expect(prisma.commerceCoupon.create).toHaveBeenCalledWith({ data: expect.objectContaining({ legacyId: "SAVE10", value: 1000, minimumSpendCents: 10000 }) });
  });
  it("rejects malformed coupon codes before writing", async () => {
    const prisma = { commerceCoupon: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() } };
    await expect(new AdminService(prisma as any, {} as any).saveCommerceCoupon(undefined, {
      name: "测试券", redemptionCode: "含 空格", value: 100, minimumSpendCents: 0, totalQuantity: 1,
      validFrom: "2026-09-01T00:00:00.000Z", validUntil: "2026-10-01T00:00:00.000Z",
    })).rejects.toThrow("优惠码");
    expect(prisma.commerceCoupon.create).not.toHaveBeenCalled();
  });
});
