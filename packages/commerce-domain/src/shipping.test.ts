import { describe, expect, it, vi } from "vitest";
import { computeShippingRefundCapacity } from "./shipping";
import { allItemsReturned, quoteAfterSale } from "./pricing";
import { settleAfterSalePoints } from "./points";

function fixture() {
  const a = { id: "a", afterSaleId: "first", status: "SUCCEEDED", amountCents: 70 };
  const b = { id: "b", afterSaleId: "second", status: "SUCCEEDED", amountCents: 140 };
  const order: any = { id: "o", userId: "u", executionOwner: "NEW_SYSTEM", sourceSystem: "canonical", pricingVersion: 1, pricingVerifiedAt: new Date(),
    paidAt: new Date(), subtotalCents: 300, discountCents: 0, pointDiscountCents: 90, shippingCents: 100, payableCents: 310,
    items: [{ id: "item", quantity: 3, totalCents: 300, couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 90, cashPaidCentsSnapshot: 210 }],
    paymentIntents: [{ id: "p", executionOwner: "NEW_SYSTEM", status: "PARTIAL_REFUNDED", amountCents: 310, refunds: [a, b] }],
    afterSales: [
      { id: "first", type: "REFUND_ONLY", status: "COMPLETED", pricingVersion: 1, requestedCents: 70, shippingRefundCents: 0, refunds: [a], items: [{ orderItemId: "item", quantity: 1, amountCents: 70, pointReturnCents: 30 }] },
      { id: "second", type: "REFUND_ONLY", status: "COMPLETED", pricingVersion: 1, requestedCents: 140, shippingRefundCents: 0, refunds: [b], items: [{ orderItemId: "item", quantity: 2, amountCents: 140, pointReturnCents: 60 }] },
    ],
  };
  return order;
}
describe("separately reviewed shipping refunds", () => {
  it("retains shipping after multiple goods refunds and bounds later partial shipping concessions", () => {
    const order = fixture();
    expect(computeShippingRefundCapacity(order)).toMatchObject({ shippingRemainingCents: 100, cashRemainingCents: 100, maximumCents: 100 });
    const refund = { id: "r", afterSaleId: "shipping", status: "SUCCEEDED", amountCents: 30 };
    order.afterSales.push({ id: "shipping", type: "SHIPPING_ONLY", status: "COMPLETED", pricingVersion: 1, requestedCents: 30, shippingRefundCents: 30, refunds: [refund], items: [] });
    order.paymentIntents[0].refunds.push(refund);
    expect(computeShippingRefundCapacity(order).maximumCents).toBe(70);
    expect(allItemsReturned(order)).toBe(true);
  });
  it("holds pending and processing freight claims, including duplicate attempts", () => {
    const order = fixture();
    const shipping = { id: "shipping", type: "SHIPPING_ONLY", status: "APPLIED", pricingVersion: 1, requestedCents: 50, shippingRefundCents: 50, refunds: [], items: [] };
    order.afterSales.push(shipping);
    expect(() => computeShippingRefundCapacity(order)).toThrow("处理中");
    shipping.status = "REFUNDING";
    expect(() => computeShippingRefundCapacity(order)).toThrow("处理中");
    expect(computeShippingRefundCapacity(order, "shipping").maximumCents).toBe(100);
  });
  it("will not guess old cash/transport allocations or ignore orphan refunds", () => {
    const order = fixture();
    order.afterSales[0].shippingRefundCents = null;
    expect(() => computeShippingRefundCapacity(order)).toThrow("尚未核验");
    order.afterSales[0].shippingRefundCents = 0;
    order.paymentIntents[0].refunds.push({ id: "orphan", status: "PROCESSING", amountCents: 1, afterSaleId: null });
    expect(() => computeShippingRefundCapacity(order)).toThrow("独立现金退款");
  });
  it("forbids customer SHIPPING_ONLY and never auto-adds shipping already claimed by staff", () => {
    const order = fixture();
    expect(() => quoteAfterSale(order, [], "SHIPPING_ONLY")).toThrow("后台财务");
    order.afterSales = [{ id: "shipping", type: "SHIPPING_ONLY", status: "APPROVED", items: [] }];
    const quote = quoteAfterSale(order, [{ orderItemId: "item", quantity: 3 }], "REFUND_ONLY");
    expect(quote).toMatchObject({ shippingRefundCents: 0, requestedCents: 210, pointReturnCents: 90 });
  });
  it("confirms cash freight without touching a point account or point ledger", async () => {
    const order = fixture(), refund = { id: "r", afterSaleId: "shipping", status: "SUCCEEDED", amountCents: 100 };
    const sale: any = { id: "shipping", orderId: "o", order, executionOwner: "NEW_SYSTEM", type: "SHIPPING_ONLY", status: "COMPLETED",
      pricingVersion: 1, requestedCents: 100, shippingRefundCents: 100, pointReturnCents: 0, items: [], refunds: [refund], reviewedAt: new Date(), reviewedByAdminId: "admin", settledAt: null };
    order.afterSales.push(sale); order.paymentIntents[0].refunds.push(refund);
    const tx: any = { commerceAfterSale: { findUniqueOrThrow: vi.fn().mockResolvedValue(sale), update: vi.fn() },
      commerceOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue(order) }, commercePointAccount: { updateMany: vi.fn() }, commercePointLedger: { create: vi.fn() } };
    await settleAfterSalePoints(tx, "shipping", "r");
    expect(tx.commercePointAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.commercePointLedger.create).not.toHaveBeenCalled();
    expect(tx.commerceAfterSale.update).toHaveBeenCalledWith(expect.objectContaining({ data: { settledAt: expect.any(Date) } }));
    sale.reviewedAt = null;
    await expect(settleAfterSalePoints(tx, "shipping", "r")).rejects.toThrow("审核");
  });
});
