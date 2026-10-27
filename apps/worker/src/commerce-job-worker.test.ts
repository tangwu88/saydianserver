import { describe, expect, it, vi } from "vitest";
import { CommerceJobWorker, jstGatewaySign, jstSign, mapJstProduct } from "./commerce-job-worker";

describe("integrated Jushuitan adapter", () => {
  it("uploads a gift as zero cash with the original SKU and a stable gift remark", async () => {
    const order = { id: "gift-order", orderNo: "GD1", userId: "gift-member", executionOwner: "NEW_SYSTEM", status: "PAID", giftCardSerial: "GN001", createdAt: new Date(), province: "广东省", city: "深圳市", district: "南山区", addressDetail: "合成地址", recipientName: "合成会员", recipientMobile: "13800138000", payableCents: 0, shippingCents: 0, adminRemark: "仓库备注", items: [{ id: "gift-line", skuId: "system-sku", erpSkuIdSnapshot: "ERP-SKU", nameSnapshot: "礼品", specificationSnapshot: "8号", quantity: 1, unitPriceCents: 68000, totalCents: 68000 }], paymentIntents: [{ paymentNo: "GP1", paidAt: new Date(), channel: "GIFT_REDEMPTION", amountCents: 0 }] };
    const worker = new CommerceJobWorker({ commerceOrder: { findUnique: vi.fn().mockResolvedValue(order), update: vi.fn() } } as any) as any;
    worker.settings = vi.fn().mockResolvedValue({ shopId: "21842919", paths: { orderUpload: "jushuitan.orders.upload" } });
    worker.call = vi.fn().mockResolvedValue({ datas: [{ o_id: 123, issuccess: true }] });
    await worker.uploadOrder(order.id);
    const payload = worker.call.mock.calls[0][2][0];
    expect(payload).toMatchObject({ pay_amount: 0, freight: 0, remark: "礼品兑换：GN001\n仓库备注", pay: { payment: "礼品兑换", amount: 0 }, items: [{ sku_id: "ERP-SKU", shop_sku_id: "system-sku", base_price: 680, amount: 0, qty: 1 }] });
    expect(JSON.stringify(payload)).not.toContain("secret");
    order.paymentIntents[0]!.amountCents = 1;
    await expect(worker.uploadOrder(order.id)).rejects.toThrow("redemption evidence");
    expect(worker.call).toHaveBeenCalledTimes(1);
  });
  it("uses the migrated deterministic signature algorithm", () => {
    expect(jstSign({ app_key: "app", timestamp: "1", biz: "{}" }, "secret"))
      .toMatch(/^[0-9a-f]{32}$/);
    expect(jstSign({ timestamp: "1", biz: "{}", app_key: "app" }, "secret"))
      .toBe(jstSign({ app_key: "app", timestamp: "1", biz: "{}" }, "secret"));
  });

  it("uses the official gateway signature order", () => {
    expect(jstGatewaySign(
      "shops.query",
      "ywv5jGT8ge6Pvlq3FZSPol345asd",
      "181ee8952a88f5a57db52587472c3798",
      "1608000837",
      "ywv5jGT8ge6Pvlq3FZSPol2323",
    )).toBe("403697654caffbbfe21a841782b6af8f");
  });

  it("posts JSON to the official production gateway with ordered signed parameters", async () => {
    const prisma: any = { integrationConfig: { updateMany: vi.fn() } };
    const worker = new CommerceJobWorker(prisma) as any;
    const response = { ok: true, text: async () => JSON.stringify({ code: 0, issuccess: true, data: { datas: [] } }) };
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    vi.spyOn(Date, "now").mockReturnValue(1_608_000_837_000);
    await worker.call({ apiBase: "https://open.erp321.com/api/open/query.aspx", appKey: "partner", appSecret: "key", accessToken: "token", shopId: "1", paths: {} }, "jushuitan.orders.upload", [{ so_id: "SD1" }]);
    const [url, request] = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]!;
    expect(String(url)).toMatch(/^https:\/\/open\.erp321\.com\/api\/open\/query\.aspx\?method=jushuitan\.orders\.upload&partnerid=partner&token=token&ts=1608000837&sign=[0-9a-f]{32}$/);
    expect(request).toMatchObject({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ so_id: "SD1" }]) });
    vi.unstubAllGlobals();
  });

  it("uploads the official paid-order shape and rejects an unsuccessful per-order result", async () => {
    const order = {
      id: "order-1", orderNo: "SD1", userId: "member-1", executionOwner: "NEW_SYSTEM", status: "PAID",
      createdAt: new Date("2026-09-11T12:00:00Z"), province: "广东省", city: "深圳市", district: "南山区",
      addressDetail: "科技园 1 号", recipientName: "测试用户", recipientMobile: "13800138000",
      payableCents: 10_500, shippingCents: 500, adminRemark: "线下核对", buyerRemark: "工作日送达", erpOrderId: null,
      items: [{ id: "line-1", skuId: "system-sku-1", erpSkuIdSnapshot: "SKU-1", nameSnapshot: "赛电手表", specificationSnapshot: "黑色", quantity: 1, unitPriceCents: 10_000, totalCents: 10_000 }],
      paymentIntents: [{ paymentNo: "PAY-1", paidAt: new Date("2026-09-11T12:01:00Z"), channel: "WECHAT_JSAPI", providerMerchantId: "merchant-1", amountCents: 10_500 }],
    };
    const prisma: any = { commerceOrder: { findUnique: vi.fn().mockResolvedValue(order), update: vi.fn() } };
    const worker = new CommerceJobWorker(prisma) as any;
    worker.settings = vi.fn().mockResolvedValue({ shopId: "21842919", paths: { orderUpload: "jushuitan.orders.upload" } });
    worker.call = vi.fn().mockResolvedValue({ datas: [{ so_id: "SD1", o_id: 321, issuccess: true }] });
    await worker.uploadOrder("order-1");
    expect(worker.call.mock.calls[0][2][0]).toMatchObject({
      shop_id: 21842919,
      receiver_phone: "13800138000",
      receiver_mobile: "13800138000",
      remark: "线下核对",
      buyer_message: "工作日送达",
      items: [{ outer_oi_id: "line-1", sku_id: "SKU-1", shop_sku_id: "system-sku-1", name: "赛电手表", properties_value: "黑色", qty: 1, base_price: 100, amount: 100 }],
      order_date: "2026-09-11 20:00:00",
      pay: { outer_pay_id: "PAY-1", pay_date: "2026-09-11 20:01:00", payment: "WECHAT_JSAPI", seller_account: "merchant-1", buyer_account: "member-1", amount: 105 },
    });
    expect(prisma.commerceOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ erpOrderId: "321", status: "WAITING_FULFILLMENT" }) }));

    worker.call.mockResolvedValueOnce({ datas: [{ so_id: "SD1", issuccess: false, msg: "商品编码不存在" }] });
    await expect(worker.uploadOrder("order-1")).rejects.toThrow("商品编码不存在");
  });

  it("requires stable ERP ids and keeps unknown amounts at zero only for product prices", () => {
    expect(() => mapJstProduct({ name: "watch" })).toThrow(/identifiers/);
    expect(mapJstProduct({ i_id: "I1", sku_id: "S1", sale_price: "99.90" }))
      .toMatchObject({ erpItemId: "I1", erpSkuId: "S1", salePriceCents: 9990 });
  });

  it("refreshes a bounded set of owned ERP orders using verified status queries", async () => {
    const prisma: any = { commerceOrder: { findMany: vi.fn().mockResolvedValue([{ id: "own-order" }]) } };
    const worker = new CommerceJobWorker(prisma) as any;
    worker.syncOrderLogs = vi.fn();
    await worker.syncFulfillment();
    expect(prisma.commerceOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ executionOwner: "NEW_SYSTEM", erpOrderId: { not: null } }), take: 20,
    }));
    expect(worker.syncOrderLogs).toHaveBeenCalledWith("own-order", true);
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
  it("processes only Jushuitan jobs when the general outbound worker is paused", async () => {
    vi.stubEnv("WORKER_OUTBOUND_PAUSED", "true");
    vi.stubEnv("JUSHUITAN_OUTBOUND_ENABLED", "true");
    vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
    const prisma: any = { commerceIntegrationJob: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() } };
    const worker = new CommerceJobWorker(prisma) as any;
    worker.scheduleSettlements = vi.fn();
    await worker.runOnce();
    expect(worker.scheduleSettlements).not.toHaveBeenCalled();
    expect(prisma.commerceIntegrationJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: { startsWith: "JUSHUITAN_" } }) }));
    vi.unstubAllEnvs();
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
