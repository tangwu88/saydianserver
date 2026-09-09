import { describe, expect, it, vi } from "vitest";
import { CommerceJobWorker, jstSign, mapJstProduct } from "./commerce-job-worker";

describe("integrated Jushuitan adapter", () => {
  it("uses the migrated deterministic signature algorithm", () => {
    expect(jstSign({ app_key: "app", timestamp: "1", biz: "{}" }, "secret"))
      .toMatch(/^[0-9a-f]{32}$/);
    expect(jstSign({ timestamp: "1", biz: "{}", app_key: "app" }, "secret"))
      .toBe(jstSign({ app_key: "app", timestamp: "1", biz: "{}" }, "secret"));
  });

  it("requires stable ERP ids and keeps unknown amounts at zero only for product prices", () => {
    expect(() => mapJstProduct({ name: "watch" })).toThrow(/identifiers/);
    expect(mapJstProduct({ i_id: "I1", sku_id: "S1", sale_price: "99.90" }))
      .toMatchObject({ erpItemId: "I1", erpSkuId: "S1", salePriceCents: 9990 });
  });

  it("keeps an after-sale order in after-sale when logistics updates arrive", async () => {
    const order = { id: "o", orderNo: "SD1", status: "AFTER_SALE", executionOwner: "NEW_SYSTEM", shippedAt: null };
    const prisma: any = { commerceOrder: {
      findMany: vi.fn().mockResolvedValue([order]), findUnique: vi.fn().mockResolvedValue(order),
      updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
        if (!where.status.in.includes(order.status)) return { count: 0 };
        Object.assign(order, data); return { count: 1 };
      }),
    }, commerceShipment: { upsert: vi.fn().mockResolvedValue({}) }, $transaction: vi.fn().mockImplementation(async (operations) => Promise.all(operations)) };
    const worker = new CommerceJobWorker(prisma) as any;
    worker.settings = vi.fn().mockResolvedValue({ shopId: "1", paths: { fulfillment: "/logistics" } });
    worker.call = vi.fn().mockResolvedValue({ datas: [{ so_id: "SD1", tracking_no: "T1" }] });
    await worker.syncFulfillment();
    expect(order.status).toBe("AFTER_SALE");
    expect(prisma.commerceShipment.upsert).toHaveBeenCalledTimes(1);
  });

  it("submits only reviewed after-sale lines instead of the whole original order", async () => {
    const prisma: any = { commerceAfterSale: {
      findUnique: vi.fn().mockResolvedValue({ id: "a", afterSaleNo: "AS1", status: "APPROVED", type: "RETURN_REFUND", executionOwner: "NEW_SYSTEM", requestedCents: 900,
        order: { orderNo: "SD1", executionOwner: "NEW_SYSTEM", items: [{ id: "unrelated", quantity: 5 }] },
        items: [{ orderItemId: "selected", quantity: 1, amountCents: 900, orderItem: { erpSkuIdSnapshot: "SKU1" } }],
      }), update: vi.fn(),
    } };
    const worker = new CommerceJobWorker(prisma) as any;
    worker.settings = vi.fn().mockResolvedValue({ shopId: "1", paths: { afterSaleUpload: "/after-sale" } });
    worker.call = vi.fn().mockResolvedValue({ datas: [] });
    await worker.uploadAfterSale("a");
    expect(worker.call.mock.calls[0][2][0].items).toEqual([{ outer_oi_id: "selected", sku_id: "SKU1", qty: 1, amount: 9, type: "退货" }]);
  });
  it("returns transient failures to the due queue instead of abandoning them in FAILED", async () => {
    const prisma: any = { commerceIntegrationJob: { findFirst: vi.fn().mockResolvedValue({ id: "j", type: "JUSHUITAN_ORDER_PUSH", payload: { orderId: "o" }, attempt: 0, maxAttempts: 5 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn() } };
    const worker = new CommerceJobWorker(prisma) as any;
    worker.nextSettlementScan = Infinity;
    worker.recoverStaleClaims = vi.fn();
    worker.dispatch = vi.fn().mockRejectedValue(new Error("Temporary provider failure"));
    await worker.runOnce();
    expect(prisma.commerceIntegrationJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", lockedAt: null, lastError: "Temporary provider failure" }) }));
  });
  it("pages past 100 unsettled accruals so blocked early entries do not starve later ones", async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` }));
    const prisma: any = { commerceCommissionAccrual: { findMany: vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce([{ id: "later" }]) }, commerceIntegrationJob: { upsert: vi.fn() } };
    const worker = new CommerceJobWorker(prisma) as any;
    await worker.scheduleSettlements();
    worker.nextSettlementScan = 0;
    await worker.scheduleSettlements();
    expect(prisma.commerceCommissionAccrual.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: "a99" }, skip: 1 });
    expect(prisma.commerceIntegrationJob.upsert).toHaveBeenCalledTimes(101);
    expect(worker.settlementCursor).toBeUndefined();
  });
});
