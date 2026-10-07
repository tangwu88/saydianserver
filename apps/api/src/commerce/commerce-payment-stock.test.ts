import { describe, expect, it, vi } from "vitest";
import { BillingService } from "../billing/billing.service";
import { cancelCommerceOrderInTransaction } from "./commerce-order-cancellation";
import { publicSku } from "./commerce-public-sku";

vi.mock("./commerce-finance", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  onCommerceOrderPaid: vi.fn(),
}));

function fixture(deferred = ["item"], stock = 1) {
  const intent: any = {
    id: "intent",
    paymentNo: "PAY",
    executionOwner: "NEW_SYSTEM",
    channel: "WECHAT_H5",
    businessType: "COMMERCE_ORDER",
    commerceOrderId: "order",
    amountCents: 100,
    status: "PENDING",
    currency: "CNY",
    providerMerchantId: "merchant",
    providerAppId: "app",
    providerTransactionId: null,
  };
  const order: any = {
    id: "order",
    status: "PENDING_PAYMENT",
    executionOwner: "NEW_SYSTEM",
    version: 1,
    pointDiscountCents: 0,
    items: [{ id: "item", skuId: "sku", quantity: 2 }],
  };
  const sku = { stock };
  const tx: any = {
    $queryRaw: vi.fn(),
    paymentIntent: {
      findUnique: vi.fn(async () => ({ ...intent })),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!where.status.in.includes(intent.status)) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      }),
    },
    commerceOrder: {
      findUniqueOrThrow: vi.fn(async () => order),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (order.status !== where.status) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      }),
    },
    commerceOrderItem: {
      findMany: vi.fn(async () => order.items),
      count: vi.fn().mockResolvedValue(1),
    },
    commerceSku: {
      update: vi.fn(async ({ data }: any) => {
        sku.stock += data.stock.increment ?? -data.stock.decrement;
        return { ...sku };
      }),
    },
    auditLog: {
      findMany: vi.fn(async () => deferred.map((entityId) => ({ entityId }))),
      create: vi.fn(),
    },
    commerceIntegrationJob: { upsert: vi.fn() },
    commerceCouponClaim: { updateMany: vi.fn() },
  };
  const prisma: any = {
    ...tx,
    $transaction: vi.fn(async (run: any) => run(tx)),
  };
  const billing = new BillingService(prisma, {} as any, {} as any);
  const pay = (amount = 100) =>
    billing.markPaid("PAY", "transaction", amount, {
      mchid: "merchant",
      appid: "app",
      amount: { currency: "CNY" },
    });
  return { tx, order, intent, sku, pay };
}

describe("payment-time stock and historical compatibility", () => {
  it("deducts only on a verified successful payment and ignores duplicate notifications", async () => {
    const h = fixture();
    await expect(h.pay(99)).rejects.toThrow("支付金额不一致");
    expect(h.sku.stock).toBe(1);
    await Promise.all([h.pay(), h.pay()]);
    await h.pay();
    expect(h.tx.commerceSku.update).toHaveBeenCalledOnce();
    expect(h.sku.stock).toBe(-1);
    expect(h.order.status).toBe("PAID");
    expect(h.intent.status).toBe("SUCCEEDED");
    expect(h.tx.commerceIntegrationJob.upsert).toHaveBeenCalledOnce();
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "COMMERCE_PAID_BACKORDER" }),
      }),
    );
  });
  it("does not deduct a historical checkout hold again at payment", async () => {
    const h = fixture([]);
    await h.pay();
    expect(h.tx.commerceSku.update).not.toHaveBeenCalled();
  });
  it("does not deduct stock for an order whose state no longer allows fulfillment", async () => {
    const h = fixture();
    h.order.status = "CANCELLED";
    await h.pay();
    expect(h.intent.status).toBe("SUCCEEDED");
    expect(h.tx.commerceSku.update).not.toHaveBeenCalled();
    expect(h.tx.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "cancellation restores only historical un-released stock (deferred=%s)",
    async (deferred) => {
      const h = fixture(deferred ? ["item"] : []);
      await cancelCommerceOrderInTransaction(h.tx, h.order);
      expect(h.sku.stock).toBe(deferred ? 1 : 3);
      expect(h.tx.commerceCouponClaim.updateMany).toHaveBeenCalledOnce();
    },
  );
  it("hides backorder debt from publicly purchasable stock", () => {
    expect(
      publicSku({
        id: "sku",
        specification: null,
        image: null,
        salePriceCents: 100,
        marketPriceCents: null,
        stock: -3,
        enabled: true,
      }).stock,
    ).toBe(0);
  });
});
