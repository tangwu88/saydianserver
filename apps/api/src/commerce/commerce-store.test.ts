import { describe, expect, it, vi } from "vitest";
import { CommerceStoreService } from "./commerce-store.service";

function fixture() {
  const order = { id: "order", userId: "user", status: "PAID", executionOwner: "NEW_SYSTEM", version: 1,
    sourceSystem: "canonical", pricingVersion: null as number | null, pricingVerifiedAt: null as Date | null,
    subtotalCents: 3000, discountCents: 300, payableCents: 2700, shippingCents: 0, pointDiscountCents: 0,
    items: [{ id: "a", quantity: 2, totalCents: 2000 }, { id: "b", quantity: 1, totalCents: 1000 }], afterSales: [] as any[] };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commerceOrder: { findFirst: vi.fn().mockResolvedValue(order), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commerceAfterSale: { create: vi.fn().mockImplementation(async (input) => ({ id: "sale", ...input.data })) },
    paymentIntent: { count: vi.fn().mockResolvedValue(0) },
    commerceSku: { update: vi.fn() }, commerceCouponClaim: { updateMany: vi.fn() },
  };
  const prisma = { ...tx, $transaction: vi.fn().mockImplementation(async (fn) => fn(tx)) };
  return { order, tx, service: new CommerceStoreService(prisma as any) };
}

describe("commerce transactional flows", () => {
  it("refunds only the selected quantity at its discounted paid amount", async () => {
    const { service, tx } = fixture();
    await expect(service.createAfterSale("user", "order", { type: "REFUND_ONLY", reason: "测试退货", orderItemId: "a", quantity: 1, requestedCents: 901 })).rejects.toThrow("超过");
    expect(tx.commerceAfterSale.create).not.toHaveBeenCalled();
    await service.createAfterSale("user", "order", { type: "REFUND_ONLY", reason: "测试退货", orderItemId: "a", quantity: 1, requestedCents: 900 });
    expect(tx.commerceAfterSale.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ items: { create: [{ orderItemId: "a", quantity: 1, amountCents: 900, pointReturnCents: 0 }] } }) }));
  });
  it("counts prior non-rejected quantities to prevent repeat refunds", async () => {
    const { order, service } = fixture();
    order.afterSales = [{ status: "COMPLETED", items: [{ orderItemId: "a", quantity: 2, amountCents: 1800 }] }];
    await expect(service.createAfterSale("user", "order", { type: "REFUND_ONLY", reason: "重复申请", orderItemId: "a", quantity: 1, requestedCents: 1 })).rejects.toThrow("剩余");
  });
  it("does not cancel and restock a payment with an uncertain provider result", async () => {
    const { order, tx, service } = fixture();
    order.status = "PENDING_PAYMENT";
    tx.paymentIntent.count.mockResolvedValue(1);
    await expect(service.cancelOrder("user", "order")).rejects.toThrow("支付结果尚未确认");
    expect(tx.commerceOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.commerceSku.update).not.toHaveBeenCalled();
  });
  it("does not restock twice when the cancellation version changed", async () => {
    const { order, tx, service } = fixture();
    order.status = "PENDING_PAYMENT";
    tx.commerceOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancelOrder("user", "order")).rejects.toThrow("已改变");
    expect(tx.commerceSku.update).not.toHaveBeenCalled();
  });
  it("reads a missing cart without creating rows while maintenance is enabled", async () => {
    const prisma = { commerceCart: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() } };
    expect(await new CommerceStoreService(prisma as any).cart("u")).toEqual({ id: null, userId: "u", items: [] });
    expect(prisma.commerceCart.upsert).not.toHaveBeenCalled();
  });
  it("supports remaining after-sales on a completed order and rejects stale quotes", async () => {
    const { order, service, tx } = fixture();
    order.status = "COMPLETED";
    const quote = await service.afterSaleQuote("user", "order", { items: [{ orderItemId: "a", quantity: 1 }] });
    expect(quote).toMatchObject({ orderVersion: 1, requestedCents: 900, pointReturnCents: 0, shippingRefundCents: 0 });
    await expect(service.createAfterSale("user", "order", { reason: "不满意", orderVersion: 0, items: [{ orderItemId: "a", quantity: 1 }] })).rejects.toThrow("订单已更新");
    expect(tx.commerceAfterSale.create).not.toHaveBeenCalled();
  });
  it("does not consume an unverified imported zero default as evidence of no points", async () => {
    const { order, service } = fixture();
    order.sourceSystem = "legacy_mall";
    await expect(service.afterSaleQuote("user", "order", { orderItemId: "a" })).rejects.toThrow("快照");
  });
});
