import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

function harness() {
  const actor = { id: "admin", role: "FINANCE" };
  const order: any = { id: "o", userId: "u", version: 3, status: "COMPLETED", executionOwner: "NEW_SYSTEM", sourceSystem: "canonical",
    pricingVersion: 1, pricingVerifiedAt: new Date(), paidAt: new Date(), receivedAt: new Date(), subtotalCents: 100, discountCents: 0,
    pointDiscountCents: 0, payableCents: 120, shippingCents: 20, items: [{ id: "i", quantity: 1, totalCents: 100,
      couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 0, cashPaidCentsSnapshot: 100 }], afterSales: [],
    paymentIntents: [{ id: "p", executionOwner: "NEW_SYSTEM", status: "SUCCEEDED", amountCents: 120, refunds: [] }] };
  const tx: any = { $queryRaw: vi.fn(),
    commerceOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue(order), update: vi.fn().mockImplementation(async () => { order.version++; }) },
    paymentRefund: { count: vi.fn().mockResolvedValue(0) },
    commerceIntegrationJob: { upsert: vi.fn() },
    commerceAfterSale: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => order.afterSales.find((row: any) => where.requestKey ? row.requestKey === where.requestKey : row.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }) => order.afterSales.find((row: any) => row.id === where.id)),
      create: vi.fn().mockImplementation(async ({ data }) => { const row = { id: "s", version: 0, executionOwner: "NEW_SYSTEM", ...data, order, items: [], refunds: [] }; order.afterSales.push(row); return row; }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }) => { const row = order.afterSales.find((item: any) => item.id === where.id && item.version === where.version); if (!row) return { count: 0 }; Object.assign(row, data, { version: row.version + 1 }); return { count: 1 }; }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async work => work(tx)) };
  return { actor, order, tx, service: new AdminService(prisma as any, {} as any) };
}
describe("admin shipping application and review", () => {
  it("creates a reserved APPLIED claim idempotently and requires explicit audited review", async () => {
    const { actor, tx, service } = harness();
    const input = { amountCents: 20, reason: "分批退货后退运费", requestKey: "shipping-test-key", orderVersion: 3 };
    const sale = await service.createShippingRefund("o", input, actor);
    await service.createShippingRefund("o", input, actor);
    expect(tx.commerceAfterSale.create).toHaveBeenCalledOnce();
    expect(sale).toMatchObject({ type: "SHIPPING_ONLY", status: "APPLIED", requestedByAdminId: "admin", shippingRefundCents: 20, pointReturnCents: 0 });
    await service.updateCommerceAfterSale(sale.id, { version: 0, status: "APPROVED" }, actor);
    expect(sale).toMatchObject({ status: "APPROVED", reviewedByAdminId: "admin", reviewedAt: expect.any(Date) });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
  });
  it("rejects missing finance authority, over-refunds, stale versions and changed idempotency parameters", async () => {
    const { actor, service, tx } = harness();
    const input = { amountCents: 20, reason: "审核退款", requestKey: "shipping-test-key", orderVersion: 3 };
    await expect(service.createShippingRefund("o", input, { id: "operator", role: "COMMERCE_OPERATIONS" })).rejects.toThrow("财务");
    await expect(service.createShippingRefund("o", { ...input, amountCents: 21 }, actor)).rejects.toThrow("超过");
    await expect(service.createShippingRefund("o", { ...input, orderVersion: 2 }, actor)).rejects.toThrow("已更新");
    expect(tx.commerceAfterSale.create).not.toHaveBeenCalled();
    await service.createShippingRefund("o", input, actor);
    await expect(service.createShippingRefund("o", { ...input, amountCents: 1 }, actor)).rejects.toThrow("不同参数");
    await expect(service.updateCommerceAfterSale("s", { version: 0, status: "APPROVED" }, { id: "operator", role: "CUSTOMER_SERVICE" })).rejects.toThrow("财务");
  });
});
