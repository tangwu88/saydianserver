import { describe, expect, it, vi } from "vitest";
import { afterSaleSettlementSnapshot, settleAfterSalePoints, settlePointOnlyAfterSale } from "./points";
import { allItemsReturned, quoteAfterSale } from "./pricing";

function fixture() {
  const order: any = { id: "o", userId: "u", sourceSystem: "canonical", executionOwner: "NEW_SYSTEM",
    pricingVersion: 1, pricingVerifiedAt: new Date(), subtotalCents: 300, discountCents: 0, pointDiscountCents: 2,
    payableCents: 298, shippingCents: 0, paidAt: new Date(), receivedAt: new Date(), shippedAt: null,
    items: [{ id: "item", quantity: 3, totalCents: 300, couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 2, cashPaidCentsSnapshot: 298 }],
    afterSales: [] as any[] };
  const first = quoteAfterSale(order, [{ orderItemId: "item", quantity: 1 }], "REFUND_ONLY");
  order.afterSales.push({ id: "first", type: "REFUND_ONLY", status: "COMPLETED", settledAt: new Date(), ...first });
  const quote = quoteAfterSale(order, [{ orderItemId: "item", quantity: 2 }], "REFUND_ONLY");
  const sale: any = { id: "sale", orderId: "o", order, executionOwner: "NEW_SYSTEM", type: "REFUND_ONLY", status: "COMPLETED", settledAt: null, ...quote,
    refunds: [{ id: "refund", status: "SUCCEEDED", amountCents: 199 }] };
  order.afterSales.push(sale);
  let written: any = null;
  const tx: any = {
    $queryRaw: vi.fn(),
    commerceAfterSale: { findUniqueOrThrow: vi.fn().mockResolvedValue(sale), count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation(async ({ data }) => Object.assign(sale, data)) },
    commerceOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue(order), update: vi.fn() },
    paymentRefund: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 298 } }), create: vi.fn() },
    commercePointAccount: { findUnique: vi.fn().mockResolvedValue({ balanceCents: 10 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commercePointLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { deltaCents: 0 } }),
      findUnique: vi.fn().mockImplementation(async () => written),
      create: vi.fn().mockImplementation(async ({ data }) => { written = data; return data; }) },
  };
  return { order, sale, tx };
}

describe("quantity-level point settlement", () => {
  it("does not impose new full-claim cash rules on historical canonical cash-only refunds", async () => {
    const { order, sale, tx } = fixture();
    Object.assign(order, { pricingVersion: null, pricingVerifiedAt: null, pointDiscountCents: 0, payableCents: 300 });
    Object.assign(sale, { pricingVersion: null, requestedCents: 200, pointReturnCents: null });
    sale.refunds[0].amountCents = 100;
    await settleAfterSalePoints(tx, "sale", "refund");
    expect(tx.commercePointAccount.updateMany).not.toHaveBeenCalled();
    expect(tx.commercePointLedger.create).not.toHaveBeenCalled();
  });
  it("returns only the selected cumulative difference and ignores repeated cash callbacks", async () => {
    const { sale, tx } = fixture();
    await settleAfterSalePoints(tx, sale.id, "refund");
    await settleAfterSalePoints(tx, sale.id, "refund");
    expect(tx.commercePointAccount.updateMany).toHaveBeenCalledOnce();
    expect(tx.commercePointLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      deltaCents: 2, afterSaleId: "sale", refundId: "refund", idempotencyKey: "points-after-sale:sale",
    }) });
  });
  it("will not return points before successful exact cash confirmation", async () => {
    const { sale, tx } = fixture();
    sale.refunds[0].status = "PROCESSING";
    await expect(settleAfterSalePoints(tx, "sale", "refund")).rejects.toThrow("未确认");
    expect(tx.commercePointAccount.updateMany).not.toHaveBeenCalled();
    sale.refunds[0].status = "SUCCEEDED"; sale.refunds[0].amountCents = 198;
    await expect(settleAfterSalePoints(tx, "sale", "refund")).rejects.toThrow("未确认");
  });
  it("validates the account and cumulative old return cap before money moves", async () => {
    const { tx } = fixture();
    tx.commercePointAccount.findUnique.mockResolvedValue(null);
    await expect(afterSaleSettlementSnapshot(tx, "sale")).rejects.toThrow("禁止先向渠道");
    tx.commercePointAccount.findUnique.mockResolvedValue({ balanceCents: 10 });
    tx.commercePointLedger.aggregate.mockResolvedValue({ _sum: { deltaCents: 1 } });
    await expect(settleAfterSalePoints(tx, "sale", "refund")).rejects.toThrow("累计返还");
    expect(tx.commercePointAccount.updateMany).not.toHaveBeenCalled();
  });
  it("settles a point-only item locally with no zero-value provider refund", async () => {
    const { order, sale, tx } = fixture();
    Object.assign(order, { subtotalCents: 201, pointDiscountCents: 200, payableCents: 1,
      items: [
        { id: "item", quantity: 1, totalCents: 200, couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 200, cashPaidCentsSnapshot: 0 },
        { id: "cash", quantity: 1, totalCents: 1, couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 0, cashPaidCentsSnapshot: 1 },
      ], afterSales: [] });
    Object.assign(sale, { status: "APPROVED", requestedCents: 0, merchandiseRefundCents: 0, shippingRefundCents: 0, pointReturnCents: 200, refunds: [],
      items: [{ orderItemId: "item", quantity: 1, amountCents: 0, pointReturnCents: 200 }] });
    order.afterSales.push(sale);
    const result = await settlePointOnlyAfterSale(tx, "sale");
    expect(result).toMatchObject({ status: "COMPLETED", cashRefundCents: 0, pointReturnCents: 200 });
    expect(tx.paymentRefund.create).not.toHaveBeenCalled();
    expect(tx.commerceOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
    expect(allItemsReturned(order)).toBe(false);
    await settlePointOnlyAfterSale(tx, "sale");
    expect(tx.commercePointAccount.updateMany).toHaveBeenCalledOnce();
  });
  it("blocks unknown imported snapshots and tampered per-item refunds", async () => {
    const { order, sale, tx } = fixture();
    sale.items[0].pointReturnCents = 1; sale.pointReturnCents = 1;
    await expect(afterSaleSettlementSnapshot(tx, "sale")).rejects.toThrow("累计退还范围");
    order.pricingVersion = null; order.pricingVerifiedAt = null; order.sourceSystem = "legacy_app";
    await expect(afterSaleSettlementSnapshot(tx, "sale")).rejects.toThrow("快照");
  });
});
