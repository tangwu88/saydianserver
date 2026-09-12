import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

const orderId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const current = { id: "33333333-3333-4333-8333-333333333333", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };

function harness(activePayments = 0) {
  const state: any = {
    order: {
      id: orderId,
      orderNo: "SD-SYNTHETIC-CLOSE",
      userId,
      status: "PENDING_PAYMENT",
      sourceSystem: "canonical",
      executionOwner: "NEW_SYSTEM",
      version: 2,
      subtotalCents: 1_000,
      discountCents: 100,
      pointDiscountCents: 200,
      shippingCents: 0,
      payableCents: 700,
      pricingVersion: 1,
      pricingVerifiedAt: new Date(),
      adminRemark: null,
      recipientMobile: "+8613812345678",
      items: [{ id: "item-1", skuId: "sku-1", quantity: 2, totalCents: 1_000, couponDiscountCentsSnapshot: 100, pointDiscountCentsSnapshot: 200, cashPaidCentsSnapshot: 700 }],
      user: { id: userId, nickname: "Synthetic", mobile: "+8613900000000" },
      referralEmployee: null,
      paymentIntents: [],
      shipments: [],
      afterSales: [],
    },
    keys: [] as any[],
    audits: [] as any[],
  };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commerceOrder: {
      findUnique: vi.fn(async () => state.order),
      findUniqueOrThrow: vi.fn(async () => state.order),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (state.order.id !== where.id || state.order.version !== where.version || state.order.status !== where.status) return { count: 0 };
        Object.assign(state.order, data, { version: state.order.version + Number(data.version?.increment ?? 0) });
        return { count: 1 };
      }),
    },
    paymentIntent: { count: vi.fn().mockResolvedValue(activePayments) },
    commerceSku: { update: vi.fn().mockResolvedValue({}) },
    commerceCouponClaim: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    commercePointAccount: { update: vi.fn().mockResolvedValue({}) },
    commercePointLedger: { create: vi.fn().mockResolvedValue({}) },
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: any) => state.keys.find((item: any) => item.userId === where.userId_scope_key.userId && item.scope === where.userId_scope_key.scope && item.key === where.userId_scope_key.key)),
      create: vi.fn(async ({ data }: any) => { state.keys.push(data); return data; }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { state.audits.push(data); return data; }) },
  };
  const prisma: any = { ...tx, $transaction: vi.fn((run: any) => run(tx)) };
  return { state, tx, service: new AdminService(prisma, {} as any) };
}

const input = (patch: Record<string, unknown> = {}) => ({
  note: "客户确认取消购买",
  orderVersion: 2,
  idempotencyKey: "synthetic-order-close-1",
  ...patch,
});

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

describe("super-admin order close", () => {
  it("cancels once and restores inventory, coupon, and points with an audit trail", async () => {
    const h = harness();
    const result = await h.service.closeCommerceOrder(orderId, input(), current, "request-close");
    expect(result).toMatchObject({ status: "CANCELLED", version: 3, recipientMobile: "+8613812345678", reused: false });
    expect(h.tx.commerceSku.update).toHaveBeenCalledWith({ where: { id: "sku-1" }, data: { stock: { increment: 2 } } });
    expect(h.tx.commerceCouponClaim.updateMany).toHaveBeenCalledWith({ where: { orderId }, data: { orderId: null, usedAt: null } });
    expect(h.tx.commercePointAccount.update).toHaveBeenCalledWith({ where: { userId }, data: { balanceCents: { increment: 200 }, version: { increment: 1 } } });
    expect(h.state.audits).toContainEqual(expect.objectContaining({ action: "COMMERCE_ORDER_CLOSED", requestId: "request-close" }));
    await expect(h.service.closeCommerceOrder(orderId, input(), current)).resolves.toMatchObject({ reused: true, version: 3 });
    expect(h.tx.commerceSku.update).toHaveBeenCalledTimes(1);
  });

  it("requires the online payment to be closed first and makes no inventory change", async () => {
    const h = harness(1);
    await expect(h.service.closeCommerceOrder(orderId, input(), current)).rejects.toThrow("支付渠道关单");
    expect(h.tx.commerceOrder.updateMany).not.toHaveBeenCalled();
    expect(h.tx.commerceSku.update).not.toHaveBeenCalled();
  });

  it("rejects stale, unnoted, non-super-admin, and domestic requests", async () => {
    const h = harness();
    await expect(h.service.closeCommerceOrder(orderId, input({ orderVersion: 1 }), current)).rejects.toMatchObject({ status: 409 });
    await expect(h.service.closeCommerceOrder(orderId, input({ note: "x" }), current)).rejects.toMatchObject({ status: 400 });
    await expect(h.service.closeCommerceOrder(orderId, input(), { ...current, roles: ["FINANCE"] })).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("APP_REALM", "domestic");
    await expect(h.service.closeCommerceOrder(orderId, input(), current)).rejects.toMatchObject({ status: 404 });
    expect(h.tx.commerceOrder.updateMany).not.toHaveBeenCalled();
  });
});
