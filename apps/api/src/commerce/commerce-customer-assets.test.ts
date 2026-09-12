import { describe, expect, it, vi } from "vitest";
import { CommerceStoreService } from "./commerce-store.service";

const member = "synthetic-member", otherMember = "other-synthetic-member";

function couponFixture() {
  const coupon = { id: "coupon", legacyId: "SAVE10", status: "ACTIVE", employeeDistributable: false,
    validFrom: new Date(0), validUntil: new Date("2099-01-01"),
    totalQuantity: 2 as number | null, claimedQuantity: 0, reservedGiftQuantity: 0 };
  const claims: any[] = [], events: string[] = [];
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (sql: TemplateStringsArray, id: string) => {
      expect(sql.join("?")).toContain('"CommerceCoupon"'); expect(sql.join("?")).toContain("FOR UPDATE");
      expect(id).toBe(coupon.id); events.push("lock"); return [{ id }];
    }),
    commerceCouponClaim: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        events.push("existing"); const owner = where.couponId_userId;
        return claims.find(row => row.couponId === owner.couponId && row.userId === owner.userId) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        events.push("claim"); const row = { id: "claim-" + claims.length, ...data };
        claims.push(row); return row;
      }),
    },
    commerceCoupon: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        events.push("eligibility");
        const distributionAllowed = where.employeeDistributable === undefined || where.employeeDistributable === coupon.employeeDistributable;
        return where.id === coupon.id && where.status === coupon.status && distributionAllowed &&
          coupon.validFrom <= where.validFrom.lte && coupon.validUntil >= where.validUntil.gte ? { ...coupon } : null;
      }),
      update: vi.fn().mockImplementation(async ({ data }: any) => {
        events.push("increment"); coupon.claimedQuantity += data.claimedQuantity.increment; return { ...coupon };
      }),
    },
  };
  // A serialized unit fixture verifies rechecking under the requested row lock;
  // PostgreSQL lock/SSI scheduling is covered by the separate isolated DB run.
  let pending: Promise<unknown> = Promise.resolve();
  const prisma = { commerceCoupon: { findUnique: vi.fn().mockImplementation(async ({ where }: any) =>
      where.legacyId === coupon.legacyId ? { id: coupon.id } : null) }, $transaction: vi.fn().mockImplementation((callback: any) => {
    const result = pending.then(async () => {
      const before = claims.length, quantity = coupon.claimedQuantity;
      try { return await callback(tx); }
      catch (error) { claims.splice(before); coupon.claimedQuantity = quantity; throw error; }
    });
    pending = result.catch(() => undefined); return result;
  }) };
  return { coupon, claims, events, tx, prisma, service: new CommerceStoreService(prisma as any) };
}

function afterSaleFixture() {
  const order: any = { id: "order", userId: member, version: 3, status: "COMPLETED", executionOwner: "NEW_SYSTEM",
    sourceSystem: "canonical", pricingVersion: 1, pricingVerifiedAt: new Date(),
    subtotalCents: 400, discountCents: 0, pointDiscountCents: 2, shippingCents: 10, payableCents: 408,
    items: ["item-a", "item-b"].map(id => ({ id, quantity: 2, totalCents: 200,
      couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 1, cashPaidCentsSnapshot: 199, review: null })),
    paymentIntents: [], shipments: [] };
  const sales: any[] = [], events: string[] = [];
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async (sql: TemplateStringsArray, id: string) => {
      expect(sql.join("?")).toContain('"CommerceOrder"'); expect(sql.join("?")).toContain("FOR UPDATE");
      expect(id).toBe(order.id); events.push("lock"); return [{ id }];
    }),
    commerceAfterSale: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        events.push("lookup");
        return sales.find(row => row.orderId === where.orderId && order.userId === where.order.userId &&
          row.requestKey?.startsWith(where.requestKey.startsWith)) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        events.push("create"); const row = { id: "sale-" + sales.length, status: "APPLIED", ...data, items: data.items.create };
        sales.push(row); return row;
      }),
    },
    commerceOrder: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        events.push("quote"); return where.id === order.id && where.userId === order.userId ?
          { ...order, afterSales: [...sales] } : null;
      }),
      updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
        events.push("update"); if (where.id !== order.id || where.version !== order.version) return { count: 0 };
        order.version += data.version.increment; order.status = data.status; return { count: 1 };
      }),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn().mockImplementation(async (callback: any) => {
    const before = sales.length, version = order.version, status = order.status;
    try { return await callback(tx); }
    catch (error) { sales.splice(before); order.version = version; order.status = status; throw error; }
  }) };
  const input = { idempotencyKey: "synthetic-after-sale-key", orderVersion: 3, type: "REFUND_ONLY", reason: "Synthetic reason",
    items: [{ orderItemId: "item-a", quantity: 1 }], evidenceImages: [] as string[] };
  return { order, sales, events, tx, prisma, input, service: new CommerceStoreService(prisma as any) };
}

describe("customer public coupon assets", () => {
  it("returns public coupon availability with owner-scoped claims and server pagination only", async () => {
    const publicFields = { name: "Synthetic coupon", type: "FIXED", value: 100, minimumSpendCents: 500,
      validFrom: new Date(0), validUntil: new Date("2099-01-01") };
    const rows = [
      { ...publicFields, id: "full", totalQuantity: 2, claimedQuantity: 1, reservedGiftQuantity: 1, claims: [{ id: "mine" }] },
      { ...publicFields, id: "available", totalQuantity: 3, claimedQuantity: 1, reservedGiftQuantity: 1, claims: [] },
      { ...publicFields, id: "unlimited", totalQuantity: null, claimedQuantity: 500, reservedGiftQuantity: 500, claims: [] },
    ];
    const prisma = { commerceCoupon: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn().mockResolvedValue(43) },
      $transaction: vi.fn().mockImplementation(async queries => Promise.all(queries)) };
    const result = await new CommerceStoreService(prisma as any).availableCoupons(member, 2);
    const query = prisma.commerceCoupon.findMany.mock.calls[0]![0];
    expect(query).toMatchObject({ skip: 20, take: 20, orderBy: [{ validUntil: "asc" }, { id: "asc" }],
      where: { status: "ACTIVE", employeeDistributable: false, validFrom: { lte: expect.any(Date) }, validUntil: { gte: expect.any(Date) } },
      select: { claims: { where: { userId: member }, select: { id: true } } } });
    expect(prisma.commerceCoupon.count).toHaveBeenCalledWith({ where: query.where });
    expect(result.pagination).toEqual({ page: 2, pageSize: 20, total: 43, hasMore: true });
    expect(result.items.map(row => ({ id: row.id, claimed: row.claimed, available: row.available }))).toEqual([
      { id: "full", claimed: true, available: false }, { id: "available", claimed: false, available: true },
      { id: "unlimited", claimed: false, available: true },
    ]);
    for (const row of result.items) for (const key of ["claims", "totalQuantity", "claimedQuantity", "reservedGiftQuantity", "employeeGrants", "gifts"])
      expect(row).not.toHaveProperty(key);
  });

  it("locks before checking and counts a first successful claim only once", async () => {
    const h = couponFixture(), first = await h.service.claimCoupon(member, h.coupon.id);
    expect(first).toMatchObject({ userId: member, couponId: h.coupon.id });
    expect(h.events).toEqual(["lock", "existing", "eligibility", "claim", "increment"]);
    expect(h.coupon.claimedQuantity).toBe(1); expect(h.claims).toHaveLength(1);
  });

  it("redeems a normalized admin-configured code through the same locked claim path", async () => {
    const h = couponFixture();
    const claim = await h.service.claimCouponByCode(member, { code: " save10 " });
    expect(h.prisma.commerceCoupon.findUnique).toHaveBeenCalledWith({ where: { legacyId: "SAVE10" }, select: { id: true } });
    expect(claim).toMatchObject({ userId: member, couponId: h.coupon.id });
    expect(h.events).toEqual(["lock", "existing", "eligibility", "claim", "increment"]);
  });

  it("redeems a configured customer code even when employees may distribute the same coupon", async () => {
    const h = couponFixture(); h.coupon.employeeDistributable = true;
    const claim = await h.service.claimCouponByCode(member, { code: "save10" });
    expect(claim).toMatchObject({ userId: member, couponId: h.coupon.id });
    expect(h.tx.commerceCoupon.findFirst.mock.calls[0]![0].where).not.toHaveProperty("employeeDistributable");
    expect(h.coupon.claimedQuantity).toBe(1);
  });

  it.each(["", "abc", "not valid", "missing-code"])("does not reveal coupon details for invalid or unavailable code %s", async code => {
    const h = couponFixture();
    await expect(h.service.claimCouponByCode(member, { code })).rejects.toMatchObject({ status: 400,
      response: expect.objectContaining({ errorKey: expect.stringMatching(/^coupon_code_/) }) });
    expect(h.claims).toEqual([]); expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(["expired", "disabled", "full"])("replays an existing claim after the coupon becomes %s without incrementing again", async condition => {
    const h = couponFixture(), first = await h.service.claimCoupon(member, h.coupon.id);
    if (condition === "expired") h.coupon.validUntil = new Date(0);
    if (condition === "disabled") h.coupon.status = "DISABLED";
    if (condition === "full") h.coupon.totalQuantity = 1;
    h.events.length = 0;
    expect(await h.service.claimCoupon(member, h.coupon.id)).toEqual(first);
    expect(h.events).toEqual(["lock", "existing"]); expect(h.tx.commerceCouponClaim.create).toHaveBeenCalledOnce();
    expect(h.tx.commerceCoupon.update).toHaveBeenCalledOnce(); expect(h.coupon.claimedQuantity).toBe(1);
  });

  it.each(["expired", "future", "disabled", "employee-only"])("rejects a new public claim for %s coupons without changing assets", async condition => {
    const h = couponFixture();
    if (condition === "expired") h.coupon.validUntil = new Date(0);
    if (condition === "future") h.coupon.validFrom = new Date("2099-01-01");
    if (condition === "disabled") h.coupon.status = "DISABLED";
    if (condition === "employee-only") h.coupon.employeeDistributable = true;
    await expect(h.service.claimCoupon(member, h.coupon.id)).rejects.toMatchObject({ status: 400 });
    expect(h.claims).toEqual([]); expect(h.tx.commerceCoupon.update).not.toHaveBeenCalled();
  });

  it("does not consume reserved gifts and rejects a different member after the last public slot", async () => {
    const h = couponFixture(); h.coupon.reservedGiftQuantity = 1;
    await h.service.claimCoupon(member, h.coupon.id);
    await expect(h.service.claimCoupon(otherMember, h.coupon.id)).rejects.toMatchObject({ status: 400 });
    expect(h.coupon.claimedQuantity).toBe(1); expect(h.coupon.reservedGiftQuantity).toBe(1);
    expect(h.claims).toHaveLength(1); expect(h.tx.commerceCouponClaim.create).toHaveBeenCalledOnce();
  });

  it("rechecks finite quota and same-user duplication in serialized competing transactions", async () => {
    const h = couponFixture(); h.coupon.totalQuantity = 1;
    const results = await Promise.allSettled([h.service.claimCoupon(member, h.coupon.id), h.service.claimCoupon(otherMember, h.coupon.id)]);
    expect(results.map(row => row.status)).toEqual(["fulfilled", "rejected"]);
    expect(h.coupon.claimedQuantity).toBe(1); expect(h.claims).toHaveLength(1);
    const duplicate = couponFixture();
    const [first, second] = await Promise.all([duplicate.service.claimCoupon(member, duplicate.coupon.id), duplicate.service.claimCoupon(member, duplicate.coupon.id)]);
    expect(second).toEqual(first); expect(duplicate.coupon.claimedQuantity).toBe(1);
  });

  it("rolls back the claim if its quantity update fails", async () => {
    const h = couponFixture(); h.tx.commerceCoupon.update.mockRejectedValueOnce(new Error("Synthetic DB failure"));
    await expect(h.service.claimCoupon(member, h.coupon.id)).rejects.toThrow("Synthetic DB failure");
    expect(h.claims).toEqual([]); expect(h.coupon.claimedQuantity).toBe(0);
  });
});

describe("customer after-sale immutable request recovery", () => {
  it("saves one scoped hashed request and recovers the original response despite stale version and occupied quantity", async () => {
    const h = afterSaleFixture(), first = await h.service.createAfterSale(member, h.order.id, h.input);
    expect(first).toMatchObject({ requestedCents: 99, pointReturnCents: 0, shippingRefundCents: 0,
      items: [{ orderItemId: "item-a", quantity: 1, amountCents: 99, pointReturnCents: 0 }] });
    expect(first.requestKey).toMatch(/^customer-as:[a-f0-9]{64}:[a-f0-9]{64}$/);
    expect(first.requestKey).not.toContain(h.input.idempotencyKey); expect(first.requestKey).not.toContain(h.input.reason);
    expect(h.events).toEqual(["lookup", "lock", "lookup", "quote", "create", "update"]);
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(h.order.version).toBe(4);
    expect(await h.service.createAfterSale(member, h.order.id, h.input)).toEqual(first);
    expect(h.tx.commerceAfterSale.create).toHaveBeenCalledOnce(); expect(h.tx.commerceOrder.updateMany).toHaveBeenCalledOnce();
  });

  it("canonicalizes object key order without changing the frozen payload", async () => {
    const h = afterSaleFixture(), first = await h.service.createAfterSale(member, h.order.id, h.input);
    const replay = { reason: h.input.reason, evidenceImages: [], items: [{ quantity: 1, orderItemId: "item-a" }],
      type: h.input.type, orderVersion: 3, idempotencyKey: h.input.idempotencyKey };
    expect(await h.service.createAfterSale(member, h.order.id, replay)).toEqual(first);
    expect(h.sales).toHaveLength(1);
  });

  it.each(["reason", "quantity", "version", "images"])("rejects same-key changed %s before any second write", async field => {
    const h = afterSaleFixture(); await h.service.createAfterSale(member, h.order.id, h.input);
    const changed = { ...h.input, ...(field === "reason" ? { reason: "Changed" } : field === "quantity" ? { items: [{ orderItemId: "item-a", quantity: 2 }] }
      : field === "version" ? { orderVersion: 4 } : { evidenceImages: ["https://example.invalid/synthetic.png"] }) };
    await expect(h.service.createAfterSale(member, h.order.id, changed)).rejects.toMatchObject({ status: 409 });
    expect(h.sales).toHaveLength(1); expect(h.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("does not reveal or change another member's request even with the same order and raw key", async () => {
    const h = afterSaleFixture(); await h.service.createAfterSale(member, h.order.id, h.input);
    await expect(h.service.createAfterSale(otherMember, h.order.id, h.input)).rejects.toMatchObject({ status: 404 });
    expect(h.sales).toHaveLength(1); expect(h.order.version).toBe(4);
    expect(h.tx.commerceOrder.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: h.order.id, userId: otherMember } }));
    for (const call of h.tx.commerceAfterSale.findFirst.mock.calls.slice(2)) {
      expect(call[0].where.order.userId).toBe(otherMember);
    }
  });

  it("scopes the same raw key to its member and order instead of imposing global uniqueness", async () => {
    const h = afterSaleFixture(), first = await h.service.createAfterSale(member, h.order.id, h.input);
    h.order.id = "other-order"; h.order.userId = otherMember; h.order.version = 3; h.sales.length = 0;
    const second = await h.service.createAfterSale(otherMember, h.order.id, h.input);
    expect(second.requestKey).not.toBe(first.requestKey);
  });

  it("returns the winner committed after the outer lookup without re-quoting under the order lock", async () => {
    const h = afterSaleFixture(), first = await h.service.createAfterSale(member, h.order.id, h.input);
    vi.clearAllMocks(); h.tx.commerceAfterSale.findFirst.mockResolvedValueOnce(null);
    expect(await h.service.createAfterSale(member, h.order.id, h.input)).toEqual(first);
    expect(h.tx.$queryRaw).toHaveBeenCalledOnce(); expect(h.tx.commerceOrder.findFirst).not.toHaveBeenCalled();
    expect(h.tx.commerceAfterSale.create).not.toHaveBeenCalled();
  });

  it("recovers a committed same-key winner after a serialization error", async () => {
    const h = afterSaleFixture(), first = await h.service.createAfterSale(member, h.order.id, h.input);
    vi.clearAllMocks(); h.tx.commerceAfterSale.findFirst.mockResolvedValueOnce(null);
    h.tx.$queryRaw.mockRejectedValueOnce(new Error("Synthetic serialization failure"));
    expect(await h.service.createAfterSale(member, h.order.id, h.input)).toEqual(first);
    expect(h.tx.commerceAfterSale.findFirst).toHaveBeenCalledTimes(2); expect(h.tx.commerceAfterSale.create).not.toHaveBeenCalled();
  });

  it("does not mask transaction errors without a winner and rolls back a failed version update", async () => {
    const h = afterSaleFixture(); h.tx.commerceOrder.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(h.service.createAfterSale(member, h.order.id, h.input)).rejects.toMatchObject({ status: 409 });
    expect(h.sales).toEqual([]); expect(h.order.version).toBe(3); expect(h.order.status).toBe("COMPLETED");
  });

  it("retains no-key legacy calls without inventing a request key or bypassing the existing amount rules", async () => {
    const h = afterSaleFixture(), { idempotencyKey: _key, orderVersion: _version, ...body } = h.input;
    const first = await h.service.createAfterSale(member, h.order.id, body);
    expect(first).not.toHaveProperty("requestKey"); expect(h.tx.commerceAfterSale.findFirst).not.toHaveBeenCalled();
    await expect(h.service.createAfterSale(member, h.order.id, body)).rejects.toMatchObject({ status: 409 });
    const second = await h.service.createAfterSale(member, h.order.id, { ...body, items: [{ orderItemId: "item-b", quantity: 1 }] });
    expect(second).not.toHaveProperty("requestKey"); expect(h.sales).toHaveLength(2);
  });

  it.each([null, "", "short", "with spaces", 5, "a".repeat(129)])("rejects malformed supplied request key %s before reads or writes", async idempotencyKey => {
    const h = afterSaleFixture();
    await expect(h.service.createAfterSale(member, h.order.id, { ...h.input, idempotencyKey })).rejects.toMatchObject({ status: 400 });
    expect(h.tx.commerceAfterSale.findFirst).not.toHaveBeenCalled(); expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("owned order review projection", () => {
  it("returns the customer's existing unpublished review and keeps unreviewed items distinguishable", async () => {
    const h = afterSaleFixture();
    const review = { id: "review", rating: 4, content: "Synthetic review", published: false, createdAt: new Date(0) };
    h.order.items[0].review = review;
    const result = await h.service.order(member, h.order.id);
    expect(h.tx.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: h.order.id, userId: member },
      include: expect.objectContaining({ items: { include: { review: { select: { id: true, rating: true, content: true, published: true, createdAt: true } } } } }) }));
    expect(result.items[0]!.review).toEqual(review); expect(result.items[1]!.review).toBeNull();
    expect(result.allowedActions).toContain("APPLY_AFTER_SALE"); expect(result.afterSaleEligibleItems).toHaveLength(2);
  });

  it("rejects a different member without returning the order or its review", async () => {
    const h = afterSaleFixture();
    await expect(h.service.order(otherMember, h.order.id)).rejects.toMatchObject({ status: 404 });
    expect(h.tx.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: h.order.id, userId: otherMember } }));
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
