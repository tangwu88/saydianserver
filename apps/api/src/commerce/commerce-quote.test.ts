import { afterEach, describe, expect, it, vi } from "vitest";
import { CommerceStoreService } from "./commerce-store.service";
import { CommerceService } from "./commerce.service";
import { commerceQuoteFingerprint } from "./commerce-quote";
import { priceOrder, quoteAfterSale } from "./commerce-finance";

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  vi.stubEnv("APP_REALM", "domestic");
  const input = { addressId: "address", items: [{ skuId: "a", quantity: 3 }, { skuId: "b", quantity: 1 }], couponClaimId: "claim", pointCents: 901, idempotencyKey: "conditional-order-key" };
  const skus = ["a", "b"].map(id => ({ id, enabled: true, stock: 10, salePriceCents: id === "a" ? 1001 : 999,
    productId: "product-" + id, product: { id: "product-" + id, name: "Synthetic", status: "PUBLISHED", localArchived: false, displayName: null } }));
  const shipping = { enabled: true, value: { amountCents: 50 } }, account = { balanceCents: 2000 };
  const claim = { id: "claim", coupon: { status: "ACTIVE", validFrom: new Date(0), validUntil: new Date("2099-01-01"), minimumSpendCents: 0, value: 300 } };
  let saved: any;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "member" }) },
    commerceAddress: { findFirst: vi.fn().mockResolvedValue({ id: "address", name: "Synthetic", mobile: "00000000000" }) },
    commerceSku: { findMany: vi.fn().mockImplementation(async () => skus), update: vi.fn().mockResolvedValue({}) },
    commerceBusinessConfig: { findUnique: vi.fn().mockImplementation(async () => shipping) },
    commercePointAccount: { findUnique: vi.fn().mockImplementation(async () => account), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commerceCouponClaim: { findFirst: vi.fn().mockImplementation(async () => claim), update: vi.fn().mockResolvedValue({}) },
    commercePointLedger: { create: vi.fn().mockResolvedValue({}) },
    commerceCart: { findUnique: vi.fn().mockResolvedValue({ id: "cart" }) },
    commerceCartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commerceOrder: { findUnique: vi.fn().mockImplementation(async () => saved ?? null), create: vi.fn().mockImplementation(async ({ data }: any) => {
      saved = { id: "order", sourceSystem: "canonical", ...data, items: data.items.create.map((item: any) => ({ id: "item-" + item.skuId, ...item })) };
      return saved;
    }) },
  };
  const prisma = { ...tx, $transaction: vi.fn().mockImplementation(async (callback: any) => callback(tx)) };
  const writes = [tx.commerceSku.update, tx.commercePointAccount.updateMany, tx.commerceCouponClaim.update,
    tx.commercePointLedger.create, tx.commerceCartItem.deleteMany, tx.commerceOrder.create];
  return { input, skus, shipping, account, claim, tx, prisma, writes, service: new CommerceStoreService(prisma as any) };
}

describe("conditional commerce quotation", () => {
  it("returns a stable fingerprint independent of line order, display copy and unused account balance", async () => {
    const h = fixture(), first = await h.service.previewOrder("member", h.input);
    expect(first.quote.fingerprint).toMatch(/^q1:[a-f0-9]{64}$/);
    h.skus.reverse(); h.skus[0]!.product.name = "Changed display"; h.account.balanceCents += 1000;
    expect((await h.service.previewOrder("member", h.input)).quote.fingerprint).toBe(first.quote.fingerprint);
    expect(first.quote.fingerprint).toBe(commerceQuoteFingerprint(first.quote));
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it("binds every monetary, pricing-version and line-allocation field even at equal cash totals", () => {
    const quote = priceOrder({ items: [{ skuId: "a", quantity: 2, unitPriceCents: 1000 }], couponDiscountCents: 100, pointDiscountCents: 100, shippingCents: 50, availablePointCents: 500 });
    for (const key of ["pricingVersion", "subtotalCents", "couponDiscountCents", "pointDiscountCents", "shippingCents", "payableCents"] as const) {
      expect(commerceQuoteFingerprint({ ...quote, [key]: quote[key] + 1 })).not.toBe(commerceQuoteFingerprint(quote));
    }
    for (const key of ["quantity", "unitPriceCents", "totalCents", "couponDiscountCentsSnapshot", "pointDiscountCentsSnapshot", "cashPaidCentsSnapshot"] as const) {
      const line = quote.lines[0]!;
      expect(commerceQuoteFingerprint({ ...quote, lines: [{ ...line, [key]: line[key] + 1 }] })).not.toBe(commerceQuoteFingerprint(quote));
    }
    expect(commerceQuoteFingerprint({ ...quote, lines: [{ ...quote.lines[0]!, skuId: "another-sku" }] })).not.toBe(commerceQuoteFingerprint(quote));
  });

  it.each(["price", "shipping", "coupon"])("rejects a changed %s inside the transaction before any order or asset write", async kind => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input);
    if (kind === "price") h.skus[0]!.salePriceCents += 100;
    if (kind === "shipping") h.shipping.value.amountCents += 100;
    if (kind === "coupon") h.claim.coupon.value += 100;
    await expect(h.service.createOrder("member", { ...h.input, expectedQuote: preview.quote.fingerprint })).rejects.toMatchObject({ status: 409, response: { errorKey: "quote_changed" } });
    expect(h.prisma.$transaction).toHaveBeenCalledOnce();
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it("accepts the original quote, then replays an already-created order before re-quoting or writing", async () => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input), body = { ...h.input, expectedQuote: preview.quote.fingerprint };
    const first = await h.service.createOrder("member", body);
    expect(first.payableCents).toBe(preview.quote.payableCents);
    h.skus[0]!.salePriceCents += 200; h.account.balanceCents = 0; h.skus[0]!.stock = 0;
    const replay = await h.service.createOrder("member", body);
    expect(replay.id).toBe(first.id); expect(h.prisma.$transaction).toHaveBeenCalledOnce();
    expect(h.tx.commerceOrder.create).toHaveBeenCalledOnce(); expect(h.tx.commercePointAccount.updateMany).toHaveBeenCalledOnce();
    await expect(h.service.createOrder("member", { ...body, expectedQuote: "q1:" + "0".repeat(64) })).rejects.toThrow("不同结算参数");
  });

  it("retains old calls without expectedQuote and rejects malformed supplied conditions without writes", async () => {
    const h = fixture();
    for (const expectedQuote of [null, "", "old", 3, "q1:" + "f".repeat(63)]) {
      await expect(h.service.createOrder("member", { ...h.input, expectedQuote } as any)).rejects.toMatchObject({ status: 400 });
    }
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    const order = await h.service.createOrder("member", h.input);
    expect(order.payableCents).toBe(2851); expect(h.tx.commerceOrder.create).toHaveBeenCalledOnce();
  });

  it("recovers a same-key winner committed between the outer lookup and the locked transaction", async () => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input), body = { ...h.input, expectedQuote: preview.quote.fingerprint };
    const winner = await h.service.createOrder("member", body);
    vi.clearAllMocks(); h.skus[0]!.stock = 0;
    h.tx.commerceOrder.findUnique.mockResolvedValueOnce(null);
    expect((await h.service.createOrder("member", body)).id).toBe(winner.id);
    expect(h.tx.$queryRaw).toHaveBeenCalledOnce(); expect(h.tx.user.findUniqueOrThrow).not.toHaveBeenCalled();
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it("returns a committed winner after a stale transaction snapshot rejects its quote", async () => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input), body = { ...h.input, expectedQuote: preview.quote.fingerprint };
    const winner = await h.service.createOrder("member", body);
    vi.clearAllMocks(); h.skus[0]!.salePriceCents += 100;
    h.tx.commerceOrder.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect((await h.service.createOrder("member", body)).id).toBe(winner.id);
    expect(h.tx.commerceOrder.findUnique).toHaveBeenCalledTimes(3);
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it("keeps an overlapping still-running same-key attempt recoverable without quoting or writing", async () => {
    const h = fixture(); h.tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
    await expect(h.service.createOrder("member", h.input)).rejects.toMatchObject({ status: 503, response: { errorKey: "order_in_progress" } });
    expect(h.tx.user.findUniqueOrThrow).not.toHaveBeenCalled();
    for (const write of h.writes) expect(write).not.toHaveBeenCalled();
  });

  it("keeps original discount and point allocations usable for repeated partial after-sales", async () => {
    const h = fixture(), preview = await h.service.previewOrder("member", h.input);
    const order = await h.service.createOrder("member", { ...h.input, expectedQuote: preview.quote.fingerprint });
    const first = quoteAfterSale({ ...order, afterSales: [] }, [{ orderItemId: "item-a", quantity: 1 }], "REFUND_ONLY");
    const next = quoteAfterSale({ ...order, afterSales: [{ id: "sale", type: "REFUND_ONLY", status: "COMPLETED", items: first.items, shippingRefundCents: 0 }] }, [{ orderItemId: "item-a", quantity: 1 }], "REFUND_ONLY");
    const item = order.items.find((row: any) => row.id === "item-a")!;
    expect(first.requestedCents + next.requestedCents).toBe(Math.floor(item.cashPaidCentsSnapshot! * 2 / 3));
    expect(first.pointReturnCents + next.pointReturnCents).toBe(Math.floor(item.pointDiscountCentsSnapshot! * 2 / 3));
  });

  it("normalizes the optional create condition through the actual mall service while preview stays read-only", async () => {
    const store = { createOrder: vi.fn().mockResolvedValue({ id: "order" }), previewOrder: vi.fn().mockResolvedValue({ quote: {} }) };
    const prisma = { commerceOrder: { findFirst: vi.fn().mockResolvedValue(null) }, legacyIdMap: { findMany: vi.fn().mockResolvedValue([]) }, legacyOrderProjection: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new CommerceService(prisma as any, store as any, {} as any), expectedQuote = "q1:" + "a".repeat(64);
    const body = { address_id: "address", items: [{ sku_id: "sku", num: 1 }], expectedQuote, referralCode: "TEAM-B" };
    await service.forUser("member", "POST", "/orders", body, "request-key");
    expect(store.createOrder).toHaveBeenLastCalledWith("member", expect.objectContaining({ expectedQuote, referralCode: "TEAM-B", addressId: "address", items: [{ skuId: "sku", quantity: 1 }] }));
    await service.forUser("member", "POST", "/orders/preview", body);
    expect(store.previewOrder.mock.calls[0]![1]).not.toHaveProperty("expectedQuote");
    await expect(service.forUser("member", "POST", "/orders", { ...body, expectedQuote: null }, "request-key")).rejects.toMatchObject({ status: 400 });
    await expect(service.forUser("member", "POST", "/orders", { ...body, referralCode: "bad code" }, "request-key")).rejects.toMatchObject({ status: 400 });
  });
});
