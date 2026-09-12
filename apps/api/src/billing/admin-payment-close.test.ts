import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessType, CommerceOrderStatus, PaymentChannel, PaymentStatus } from "@prisma/client";
import { BillingService } from "./billing.service";

const orderId = "11111111-1111-4111-8111-111111111111";
const paymentId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const current = { id: "44444444-4444-4444-8444-444444444444", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };

function harness() {
  const state: any = {
    order: {
      id: orderId,
      userId,
      status: CommerceOrderStatus.PENDING_PAYMENT,
      paidAt: null,
      version: 4,
      executionOwner: "NEW_SYSTEM",
      adminRemark: null,
      paymentIntents: [{
        id: paymentId,
        userId,
        businessType: BusinessType.COMMERCE_ORDER,
        businessId: orderId,
        commerceOrderId: orderId,
        paymentNo: "PAY-SYNTHETIC-1",
        channel: PaymentChannel.ALIPAY_WAP,
        status: PaymentStatus.PENDING,
        amountCents: 980,
        currency: "CNY",
        description: "synthetic",
        providerMerchantId: null,
        providerAppId: "app-1",
        providerPayload: { invoke: "original" },
        executionOwner: "NEW_SYSTEM",
        createdAt: new Date(),
      }],
    },
    keys: [] as any[],
    audits: [] as any[],
  };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commerceOrder: {
      findUnique: vi.fn(async () => state.order),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (state.order.id !== where.id || state.order.status !== where.status || state.order.paidAt !== null) return { count: 0 };
        state.order.adminRemark = data.adminRemark;
        state.order.version += Number(data.version?.increment ?? 0);
        return { count: 1 };
      }),
    },
    paymentIntent: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const intent = state.order.paymentIntents[0];
        if (intent.id !== where.id || !where.status.in.includes(intent.status)) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      }),
    },
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: any) => state.keys.find((item: any) => item.userId === where.userId_scope_key.userId && item.scope === where.userId_scope_key.scope && item.key === where.userId_scope_key.key)),
      create: vi.fn(async ({ data }: any) => { state.keys.push(data); return data; }),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => { state.audits.push(data); return data; }) },
  };
  const prisma: any = {
    ...tx,
    $transaction: vi.fn((run: any) => run(tx)),
  };
  const providers = { closePayment: vi.fn().mockResolvedValue({ provider: "alipay", closed: true }) };
  const service = new BillingService(prisma, providers as any, {} as any);
  vi.spyOn(service, "payment").mockResolvedValue({} as any);
  return { state, tx, prisma, providers, service };
}

const input = (patch: Record<string, unknown> = {}) => ({
  note: "客户要求改价，已核对尚未付款",
  orderVersion: 4,
  idempotencyKey: "synthetic-payment-close-1",
  ...patch,
});

beforeEach(() => {
  vi.stubEnv("APP_REALM", "global");
  vi.stubEnv("PAUSE_WORKERS", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("super-admin online payment close", () => {
  it("persists CLOSED only after the provider confirms and enables the next order action", async () => {
    const h = harness();
    const result = await h.service.closeCommerceOrderPayment(orderId, paymentId, input(), current, "request-1");
    expect(h.providers.closePayment).toHaveBeenCalledWith(expect.objectContaining({ id: paymentId, paymentNo: "PAY-SYNTHETIC-1" }));
    expect(result).toMatchObject({ orderId, paymentId, paymentStatus: PaymentStatus.CLOSED, orderVersion: 5, reused: false });
    expect(h.state.order.paymentIntents[0]).toMatchObject({ status: PaymentStatus.CLOSED, providerPayload: expect.objectContaining({ closedByAdminId: current.id }) });
    expect(h.state.order.adminRemark).toContain("客户要求改价");
    expect(h.state.audits).toContainEqual(expect.objectContaining({ action: "COMMERCE_ORDER_ONLINE_PAYMENT_CLOSED", requestId: "request-1" }));
    await expect(h.service.closeCommerceOrderPayment(orderId, paymentId, input(), current)).resolves.toMatchObject({ reused: true, orderVersion: 5 });
    expect(h.providers.closePayment).toHaveBeenCalledTimes(1);
  });

  it("does not change local payment or order state when the provider does not confirm closure", async () => {
    const h = harness();
    h.providers.closePayment.mockRejectedValueOnce(new Error("渠道关单未确认"));
    await expect(h.service.closeCommerceOrderPayment(orderId, paymentId, input(), current)).rejects.toThrow("关单未确认");
    expect(h.state.order.paymentIntents[0].status).toBe(PaymentStatus.PENDING);
    expect(h.tx.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(h.tx.commerceOrder.updateMany).not.toHaveBeenCalled();
  });

  it("rejects non-super-admin, stale versions, unsupported fields, and a reconciled paid result", async () => {
    const h = harness();
    await expect(h.service.closeCommerceOrderPayment(orderId, paymentId, input(), { ...current, roles: ["FINANCE"] })).rejects.toMatchObject({ status: 403 });
    await expect(h.service.closeCommerceOrderPayment(orderId, paymentId, input({ orderVersion: 3 }), current)).rejects.toMatchObject({ status: 409 });
    await expect(h.service.closeCommerceOrderPayment(orderId, paymentId, input({ extra: true }), current)).rejects.toMatchObject({ status: 400 });
    vi.mocked(h.service.payment).mockImplementationOnce(async () => {
      h.state.order.status = CommerceOrderStatus.PAID;
      h.state.order.paidAt = new Date();
      h.state.order.paymentIntents[0].status = PaymentStatus.SUCCEEDED;
      return {} as any;
    });
    await expect(h.service.closeCommerceOrderPayment(orderId, paymentId, input(), current)).rejects.toThrow("渠道结果已变化");
    expect(h.providers.closePayment).not.toHaveBeenCalled();
  });
});
