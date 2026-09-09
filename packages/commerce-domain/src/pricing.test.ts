import { describe, expect, it } from "vitest";
import { allocateLargestRemainder, priceOrder, cumulativeQuantitySlice, financialSnapshot, quoteAfterSale } from "./pricing";

describe("immutable order allocations", () => {
  it("uses stable largest remainders and conserves coupons, points and cash", () => {
    expect([...allocateLargestRemainder(2, [{ key: "b", amount: 1 }, { key: "a", amount: 1 }, { key: "c", amount: 1 }])]).toEqual([["b", 1], ["a", 1], ["c", 0]]);
    const quote = priceOrder({ items: [{ skuId: "b", unitPriceCents: 101, quantity: 2 }, { skuId: "a", unitPriceCents: 99, quantity: 1 }], couponDiscountCents: 31, pointDiscountCents: 100, shippingCents: 20, availablePointCents: 100 });
    expect(quote.payableCents).toBe(190);
    expect(quote.lines.reduce((n, row) => n + row.pointDiscountCentsSnapshot, 0)).toBe(100);
    expect(quote.lines.reduce((n, row) => n + row.couponDiscountCentsSnapshot, 0)).toBe(31);
    expect(quote.lines.reduce((n, row) => n + row.cashPaidCentsSnapshot, 0)).toBe(170);
  });
  it("does not cover shipping or allow zero cash and does not invent a balance", () => {
    const input = { items: [{ skuId: "a", quantity: 1, unitPriceCents: 100 }], couponDiscountCents: 0, pointDiscountCents: 100, shippingCents: 0, availablePointCents: 100 };
    expect(() => priceOrder(input)).toThrow("1分");
    expect(priceOrder({ ...input, shippingCents: 10 }).payableCents).toBe(10);
    expect(() => priceOrder({ ...input, pointDiscountCents: 101, shippingCents: 10, availablePointCents: 1000 })).toThrow();
    expect(() => priceOrder({ ...input, pointDiscountCents: 1, availablePointCents: null })).toThrow("核验");
  });
  it("cumulative quantity refunds release rounding residue on the last unit", () => {
    expect([0, 1, 2].map(previous => cumulativeQuantitySlice(2, 3, previous, 1))).toEqual([0, 1, 1]);
    expect(() => cumulativeQuantitySlice(100, 2, 2, 1)).toThrow("剩余");
  });
  const order = () => ({ sourceSystem: "canonical", pricingVersion: 1, pricingVerifiedAt: new Date(), subtotalCents: 300, discountCents: 0, pointDiscountCents: 2, shippingCents: 10, payableCents: 308,
    items: [{ id: "a", quantity: 3, totalCents: 300, couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 2, cashPaidCentsSnapshot: 298 }], afterSales: [] as any[] });
  it("reserves in-flight quantities and returns cash and points separately", () => {
    const value = order();
    const first = quoteAfterSale(value, [{ orderItemId: "a", quantity: 1 }], "REFUND_ONLY");
    expect(first).toMatchObject({ requestedCents: 99, pointReturnCents: 0, shippingRefundCents: 0 });
    value.afterSales = [{ id: "s", type: "REFUND_ONLY", status: "REFUNDING", items: first.items }];
    expect(() => quoteAfterSale(value, [{ orderItemId: "a", quantity: 1 }], "REFUND_ONLY")).toThrow("处理中");
    value.afterSales[0].status = "COMPLETED";
    expect(quoteAfterSale(value, [{ orderItemId: "a", quantity: 2 }], "REFUND_ONLY")).toMatchObject({ requestedCents: 199, pointReturnCents: 2, shippingRefundCents: 0 });
  });
  it("keeps whole-first shipping separate and requires verified imported snapshots", () => {
    expect(quoteAfterSale(order(), [{ orderItemId: "a", quantity: 3 }], "REFUND_ONLY")).toMatchObject({ merchandiseRefundCents: 298, shippingRefundCents: 10, requestedCents: 308, pointReturnCents: 2 });
    expect(() => financialSnapshot({ ...order(), pricingVersion: null, pricingVerifiedAt: null })).toThrow("快照");
    expect(() => financialSnapshot({ ...order(), sourceSystem: "legacy_app", pricingVersion: null, pricingVerifiedAt: null, pointDiscountCents: 0, payableCents: 310 })).toThrow("快照");
    expect(financialSnapshot({ ...order(), pricingVersion: null, pricingVerifiedAt: null, pointDiscountCents: 0, payableCents: 310 }).pricingVersion).toBe(0);
  });
});
