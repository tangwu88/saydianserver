import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

const orderId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const current = { id: "synthetic-admin", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };

function harness(paymentStatus?: string) {
  const state: any = {
    order: {
      id: orderId,
      orderNo: "SD-SYNTHETIC-001",
      userId,
      status: "PENDING_PAYMENT",
      sourceSystem: "canonical",
      executionOwner: "NEW_SYSTEM",
      version: 2,
      subtotalCents: 10_000,
      discountCents: 1_000,
      pointDiscountCents: 500,
      shippingCents: 600,
      payableCents: 9_100,
      pricingVersion: 1,
      pricingVerifiedAt: new Date("2026-09-11T00:00:00.000Z"),
      currency: "CNY",
      recipientMobile: "+8613812345678",
      adminRemark: null,
      paidAt: null,
      receivedAt: null,
      referralEmployeeId: null,
      commissionAccrual: null,
      items: [
        { id: "item-1", orderId, skuId: "sku-1", quantity: 1, unitPriceCents: 6_000, totalCents: 6_000, couponDiscountCentsSnapshot: 600, pointDiscountCentsSnapshot: 300, cashPaidCentsSnapshot: 5_100 },
        { id: "item-2", orderId, skuId: "sku-2", quantity: 2, unitPriceCents: 2_000, totalCents: 4_000, couponDiscountCentsSnapshot: 400, pointDiscountCentsSnapshot: 200, cashPaidCentsSnapshot: 3_400 },
      ],
      paymentIntents: paymentStatus ? [{ id: "online-intent", status: paymentStatus, channel: "WECHAT_H5" }] : [],
      shipments: [],
      afterSales: [],
    },
    keys: [] as any[],
    audits: [] as any[],
    jobs: [] as any[],
  };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commerceOrder: {
      findUnique: vi.fn(async () => state.order),
      findUniqueOrThrow: vi.fn(async () => state.order),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (state.order.id !== where.id || state.order.version !== where.version || state.order.status !== where.status || state.order.paidAt !== null) return { count: 0 };
        Object.assign(state.order, data, {
          version: state.order.version + Number(data.version?.increment ?? 0),
          updatedAt: new Date(),
        });
        return { count: 1 };
      }),
    },
    commerceOrderItem: {
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.order.items.find((item: any) => item.id === where.id), data)),
      count: vi.fn().mockResolvedValue(0),
    },
    paymentIntent: {
      create: vi.fn(async ({ data }: any) => {
        const record = { ...data, id: "offline-payment", createdAt: new Date(), updatedAt: new Date() };
        state.order.paymentIntents.push(record);
        return record;
      }),
    },
    commerceIntegrationJob: { upsert: vi.fn(async ({ create }: any) => { state.jobs.push(create); return create; }) },
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
  action: "ADJUST_PRICE",
  payableCents: 8_100,
  note: "客户专属优惠，已由运营负责人确认",
  orderVersion: 2,
  idempotencyKey: "synthetic-manual-order-0001",
  ...patch,
});

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

describe("super-admin pending-order manual payment", () => {
  it("adjusts only the payable amount, rewrites balanced item snapshots, and replays idempotently", async () => {
    const h = harness();
    const result = await h.service.manuallySettleCommerceOrder(orderId, input(), current, "request-1");
    expect(result).toMatchObject({ status: "PENDING_PAYMENT", payableCents: 8_100, discountCents: 2_000, version: 3, reused: false });
    expect(h.state.order.paidAt).toBeNull();
    expect(h.tx.paymentIntent.create).not.toHaveBeenCalled();
    expect(h.state.order.items.reduce((sum: number, item: any) => sum + item.couponDiscountCentsSnapshot, 0)).toBe(2_000);
    expect(h.state.order.items.reduce((sum: number, item: any) => sum + item.pointDiscountCentsSnapshot, 0)).toBe(500);
    expect(h.state.order.items.reduce((sum: number, item: any) => sum + item.cashPaidCentsSnapshot, 0) + h.state.order.shippingCents).toBe(8_100);
    expect(h.state.audits).toContainEqual(expect.objectContaining({
      action: "COMMERCE_ORDER_PRICE_ADJUSTED",
      requestId: "request-1",
      afterJson: expect.objectContaining({ payableCents: 8_100, note: "客户专属优惠，已由运营负责人确认" }),
    }));
    await expect(h.service.manuallySettleCommerceOrder(orderId, input(), current, "request-2")).resolves.toMatchObject({ version: 3, reused: true });
    expect(h.tx.commerceOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(h.state.audits).toHaveLength(1);
  });

  it("records verified offline receipt as a distinct succeeded payment and advances the order once", async () => {
    const h = harness();
    const result = await h.service.manuallySettleCommerceOrder(orderId, input({
      action: "CONFIRM_OFFLINE_PAID",
      payableCents: 9_000,
      note: "银行转账已到账，财务流水 SYNTHETIC-001",
      idempotencyKey: "synthetic-offline-order-0001",
    }), current, "request-paid");
    expect(result).toMatchObject({ status: "PAID", payableCents: 9_000, discountCents: 1_100, version: 3, reused: false });
    expect(result.paidAt).toBeInstanceOf(Date);
    expect(h.tx.paymentIntent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      channel: "OFFLINE_MANUAL",
      status: "SUCCEEDED",
      amountCents: 9_000,
      currency: "CNY",
      providerPayload: expect.objectContaining({ source: "SUPER_ADMIN_OFFLINE_CONFIRMATION", adminId: current.id }),
    }) });
    expect(h.state.audits).toContainEqual(expect.objectContaining({ action: "COMMERCE_ORDER_OFFLINE_PAYMENT_CONFIRMED" }));
    expect(h.state.order.adminRemark).toContain("银行转账已到账");
  });

  it("rejects non-super-admin, domestic, stale, unsupported, and unnoted operations", async () => {
    const h = harness();
    await expect(h.service.manuallySettleCommerceOrder(orderId, input(), { ...current, roles: ["FINANCE"] })).rejects.toMatchObject({ status: 403 });
    await expect(h.service.manuallySettleCommerceOrder(orderId, input({ orderVersion: 1 }), current)).rejects.toMatchObject({ status: 409 });
    await expect(h.service.manuallySettleCommerceOrder(orderId, input({ note: "x" }), current)).rejects.toMatchObject({ status: 400 });
    await expect(h.service.manuallySettleCommerceOrder(orderId, input({ action: "PAID" }), current)).rejects.toMatchObject({ status: 400 });
    vi.stubEnv("APP_REALM", "domestic");
    await expect(h.service.manuallySettleCommerceOrder(orderId, input(), current)).rejects.toMatchObject({ status: 404 });
    expect(h.tx.commerceOrder.updateMany).not.toHaveBeenCalled();
  });

  it.each(["CREATED", "PENDING"])("blocks an order while an online payment is %s", async status => {
    const h = harness(status);
    await expect(h.service.manuallySettleCommerceOrder(orderId, input(), current)).rejects.toThrow("支付处理中");
    expect(h.tx.commerceOrder.updateMany).not.toHaveBeenCalled();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with different parameters", async () => {
    const h = harness(); await h.service.manuallySettleCommerceOrder(orderId, input(), current);
    await expect(h.service.manuallySettleCommerceOrder(orderId, input({ note: "不同的备注" }), current)).rejects.toThrow("不同参数");
    expect(h.tx.commerceOrder.updateMany).toHaveBeenCalledTimes(1);
  });
});
