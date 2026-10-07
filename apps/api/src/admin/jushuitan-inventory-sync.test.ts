import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";
import { SafeHttpExceptionFilter } from "../common/http-exception.filter";
import { syncJushuitanInventory } from "./jushuitan-product-import";

function fixture(count = 2) {
  const skus = Array.from({ length: count }, (_, index) => ({
    id: `sku-${index}`,
    productId: "product-1",
    erpSkuId: `ERP-${index}`,
    stock: 5,
    updatedAt: new Date("2026-10-07T00:00:00Z"),
  }));
  const tx = {
    commerceOrderItem: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    auditLog: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
    commerceSku: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    commerceOrderItem: { findMany: vi.fn().mockResolvedValue([]) },
    commerceSku: { findMany: vi.fn().mockResolvedValue(skus) },
    integrationConfig: {
      findUnique: vi.fn().mockResolvedValue({
        state: "CONFIGURED",
        publicConfig: { paths: { sku: "/open/sku/query" } },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  };
  const secrets = {
    resolve: vi.fn().mockResolvedValue({
      appKey: "synthetic-key",
      appSecret: "synthetic-secret",
      accessToken: "synthetic-token",
    }),
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(
      response(
        skus.map((sku) => ({ sku_id: sku.erpSkuId, avl_qty: 3, qty: 100 })),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  return {
    skus,
    tx,
    prisma,
    secrets,
    fetch,
    run: () => syncJushuitanInventory(prisma as any, secrets as any),
  };
}
function response(datas: unknown[], has_next = false) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: { datas, has_next } }),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("manual ERP inventory synchronization", () => {
  it.each([
    ["invalid-sku", 400, "inventory_sync_invalid_skus", "ERP SKU 编码无效"],
    ["too-many", 400, "inventory_sync_invalid_skus", "超过 5000"],
    ["order-change", 409, "inventory_sync_concurrent_change", "订单已变化"],
    ["stock-change", 409, "inventory_sync_concurrent_change", "商品库存或资料已变化"],
    ["database", 500, "inventory_sync_internal", "数据库错误码 P2022"],
    ["unexpected", 500, "inventory_sync_internal", "本站库存同步执行失败"],
  ] as const)("preserves a safe HTTP diagnostic for local failure %s", async (failure, httpStatus, errorKey, message) => {
    const h = fixture(failure === "too-many" ? 5001 : 1);
    const privateMessage = "synthetic-private-database-url";
    if (failure === "invalid-sku") h.skus[0]!.erpSkuId = "invalid,sku";
    if (failure === "order-change") h.tx.commerceOrderItem.findMany.mockResolvedValueOnce([{ id: "item", skuId: "sku-0", quantity: 1, order: { updatedAt: new Date() } }] as any);
    if (failure === "stock-change") h.tx.commerceSku.updateMany.mockResolvedValueOnce({ count: 0 });
    if (failure === "database") h.prisma.commerceSku.findMany.mockRejectedValueOnce(Object.assign(new Error(privateMessage), { code: "P2022" }));
    if (failure === "unexpected") h.prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error(privateMessage), { code: privateMessage }));
    let exception: unknown;
    try { await h.run(); } catch (error) { exception = error; }
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    new SafeHttpExceptionFilter().catch(exception, {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: "/api/saydian-app/admin/v1/commerce-products/inventory-sync", requestId: "synthetic-request" }),
        getResponse: () => ({ status }),
      }),
    } as any);
    expect(status).toHaveBeenCalledWith(httpStatus);
    const body = json.mock.calls[0]![0];
    expect(body).toMatchObject({ errorKey, requestId: "synthetic-request" });
    expect(body.message).toContain(message);
    expect(JSON.stringify(body)).not.toContain(privateMessage);
    expect(body.message).not.toContain("The request could not be completed");
    expect(h.prisma.integrationConfig.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: expect.anything() }) }));
    if (!["stock-change", "unexpected"].includes(failure)) expect(h.tx.commerceSku.updateMany).not.toHaveBeenCalled();
  });
  it.each(["configuration", "credentials", "secret-store", "permission", "provider", "network", "missing-inventory"])(
    "returns a useful safe HTTP diagnostic for %s instead of the generic English error",
    async (failure) => {
      const h = fixture(1);
      const sensitive = "synthetic-private-token";
      if (failure === "configuration") h.prisma.integrationConfig.findUnique.mockResolvedValueOnce({ state: "UNCONFIGURED", publicConfig: {} });
      if (failure === "credentials") h.secrets.resolve.mockResolvedValueOnce({} as any);
      if (failure === "secret-store") h.secrets.resolve.mockRejectedValueOnce(new ServiceUnavailableException("集成密钥暂时无法读取，请联系管理员"));
      if (failure === "permission" || failure === "provider") h.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ code: failure === "permission" ? 190 : 199, msg: sensitive }) });
      if (failure === "network") h.fetch.mockRejectedValueOnce(new Error(`https://vendor.invalid?access_token=${sensitive}`));
      if (failure === "missing-inventory") h.fetch.mockResolvedValueOnce(response([]));
      let exception: unknown;
      try { await h.run(); } catch (error) { exception = error; }
      expect(exception).toBeInstanceOf(ServiceUnavailableException);
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      new SafeHttpExceptionFilter().catch(exception, {
        switchToHttp: () => ({
          getRequest: () => ({ originalUrl: "/api/saydian-app/admin/v1/commerce-products/inventory-sync", requestId: "synthetic-request" }),
          getResponse: () => ({ status }),
        }),
      } as any);
      const body = json.mock.calls[0]![0];
      expect(status).toHaveBeenCalledWith(503);
      expect(body).toMatchObject({ errorKey: "jushuitan_unavailable", requestId: "synthetic-request" });
      expect(body.message).toContain("聚水潭");
      expect(body.message).not.toContain("This service is temporarily unavailable");
      expect(JSON.stringify(body)).not.toContain(sensitive);
      if (failure === "provider") expect(body.message).toContain("错误码 199");
      expect(h.prisma.integrationConfig.updateMany).toHaveBeenCalledWith({
        where: { key: "jushuitan" },
        data: { lastCheckedAt: expect.any(Date), lastError: body.message },
      });
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it("preserves the real diagnostic if recording integration health fails", async () => {
    const h = fixture(1);
    h.fetch.mockResolvedValueOnce(response([]));
    h.prisma.integrationConfig.updateMany.mockRejectedValueOnce(new Error("synthetic-database-outage"));
    await expect(h.run()).rejects.toThrow("未返回 SKU ERP-0");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("subtracts only paid orders not yet uploaded to ERP", async () => {
    const h = fixture(1);
    const reservations = [
      {
        id: "item-1",
        skuId: "sku-0",
        quantity: 2,
        order: { updatedAt: new Date("2026-10-07T00:00:00Z") },
      },
    ];
    h.prisma.commerceOrderItem.findMany.mockImplementation(async (query: any) => query.where.order.status === "PENDING_PAYMENT" ? [] : reservations);
    h.tx.commerceOrderItem.findMany.mockImplementation(async (query: any) => query.where.order.status === "PENDING_PAYMENT" ? [] : reservations);
    await h.run();
    expect(h.tx.commerceSku.updateMany.mock.calls[0]![0].data).toEqual({
      stock: 1,
    });
    expect(
      h.prisma.commerceOrderItem.findMany.mock.calls[0]![0].where.order,
    ).toEqual({
      executionOwner: "NEW_SYSTEM",
      status: { in: ["PAID", "WAITING_FULFILLMENT"] },
      erpOrderId: null,
      erpStatus: null,
    });
  });
  it("rejects changed reservations before updating stock", async () => {
    const h = fixture(1);
    h.tx.commerceOrderItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "new-item",
        skuId: "sku-0",
        quantity: 1,
        order: { updatedAt: new Date() },
      },
    ]);
    await expect(h.run()).rejects.toThrow("订单占用已变化");
    expect(h.tx.commerceSku.updateMany).not.toHaveBeenCalled();
  });
  it("retains authorized paid backorder debt when ERP stock is insufficient", async () => {
    const h = fixture(1);
    const rows = [{ id: "paid-item", skuId: "sku-0", quantity: 4, order: { updatedAt: new Date() } }];
    for (const db of [h.prisma, h.tx]) db.commerceOrderItem.findMany.mockImplementation(async (query: any) => query.where.order.status === "PENDING_PAYMENT" ? [] : rows);
    await h.run();
    expect(h.tx.commerceSku.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { stock: -1 } }));
  });
  it("releases old unpaid holds and records payment stock policy atomically", async () => {
    const h = fixture(1);
    const rows = [{ id: "old-item", orderId: "11111111-1111-4111-8111-111111111111", skuId: "sku-0", quantity: 100, order: { updatedAt: new Date() } }];
    for (const db of [h.prisma, h.tx]) db.commerceOrderItem.findMany.mockImplementation(async (query: any) => query.where.order.status === "PENDING_PAYMENT" ? rows : []);
    await h.run();
    expect(h.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(h.tx.commerceSku.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { stock: 3 } }));
    expect(h.tx.auditLog.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ entityId: "old-item" })] }));
    h.tx.auditLog.findMany.mockResolvedValue([{ entityId: "old-item" }] as any);
    h.tx.auditLog.createMany.mockClear();
    await h.run();
    expect(h.tx.auditLog.createMany).not.toHaveBeenCalled();
  });
  it("fetches only inventory and updates stock with optimistic concurrency protection", async () => {
    const h = fixture();
    expect(await h.run()).toEqual({
      productCount: 1,
      skuCount: 2,
      updatedSkuCount: 2,
    });
    expect(h.prisma.commerceSku.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          enabled: true,
          erpSkuId: { not: "" },
          product: { source: "ERP", localArchived: false },
        },
      }),
    );
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0]![0]).toBe(
      "https://openapi.jushuitan.com/open/inventory/query",
    );
    expect(JSON.parse(h.fetch.mock.calls[0]![1].body.get("biz"))).toMatchObject(
      {
        sku_ids: "ERP-0,ERP-1",
        has_lock_qty: true,
      },
    );
    expect(h.tx.commerceSku.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sku-0",
        erpSkuId: "ERP-0",
        stock: 5,
        updatedAt: h.skus[0]!.updatedAt,
        enabled: true,
        product: { source: "ERP", localArchived: false },
      },
      data: { stock: 3 },
    });
  });
  it("checks the SKU version even when releasing old holds leaves its number unchanged", async () => {
    const h = fixture(1); h.skus[0]!.stock = 3;
    const rows = [{ id: "old-item", orderId: "11111111-1111-4111-8111-111111111111", skuId: "sku-0", quantity: 2, order: { updatedAt: new Date() } }];
    for (const db of [h.prisma, h.tx]) db.commerceOrderItem.findMany.mockImplementation(async (query: any) => query.where.order.status === "PENDING_PAYMENT" ? rows : []);
    h.tx.commerceSku.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.run()).rejects.toThrow("商品库存或资料已变化");
  });
  it("supports batching and all inventory pages before any writes", async () => {
    const h = fixture(101);
    h.fetch
      .mockReset()
      .mockResolvedValueOnce(
        response(
          h.skus.slice(0, 50).map((s) => ({ sku_id: s.erpSkuId, qty: 2 })),
          true,
        ),
      )
      .mockResolvedValueOnce(
        response(
          h.skus.slice(50, 100).map((s) => ({ sku_id: s.erpSkuId, qty: 2 })),
        ),
      )
      .mockResolvedValueOnce(response([{ sku_id: "ERP-100", qty: 2 }]));
    expect((await h.run()).skuCount).toBe(101);
    expect(
      h.fetch.mock.calls.map(
        (c) => JSON.parse(c[1].body.get("biz")).page_index,
      ),
    ).toEqual([1, 2, 1]);
    expect(h.tx.commerceSku.updateMany).toHaveBeenCalledTimes(101);
  });
  it("does not turn missing SKU inventory into zero or write partial results", async () => {
    const h = fixture();
    h.fetch.mockResolvedValue(response([{ sku_id: "ERP-0", qty: 2 }]));
    await expect(h.run()).rejects.toThrow("未返回 SKU ERP-1");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "", " ", "invalid", true, 2147483648])(
    "rejects invalid quantity %s before writing",
    async (qty) => {
      const h = fixture(1);
      h.fetch.mockResolvedValue(response([{ sku_id: "ERP-0", qty }]));
      await expect(h.run()).rejects.toThrow("缺少有效数量");
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it("accepts an explicit zero and clamps negative available stock", async () => {
    const h = fixture();
    h.fetch.mockResolvedValue(
      response([
        { sku_id: "ERP-0", avl_qty: 0 },
        { sku_id: "ERP-1", avl_qty: -2 },
      ]),
    );
    await h.run();
    expect(
      h.tx.commerceSku.updateMany.mock.calls.map((c) => c[0].data),
    ).toEqual([{ stock: 0 }, { stock: 0 }]);
  });
  it("rejects concurrent stock changes inside the transaction", async () => {
    const h = fixture();
    h.tx.commerceSku.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(h.run()).rejects.toThrow("同步期间商品库存或资料已变化");
  });
  it("does not query ERP when there are no eligible products", async () => {
    const h = fixture(0);
    expect((await h.run()).skuCount).toBe(0);
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("keeps unchanged stock without writing and rejects provider failures", async () => {
    const h = fixture(1);
    h.fetch.mockResolvedValueOnce(response([{ sku_id: "ERP-0", qty: 5 }]));
    expect((await h.run()).updatedSkuCount).toBe(0);
    expect(h.tx.commerceSku.updateMany).not.toHaveBeenCalled();
    h.fetch.mockRejectedValueOnce(
      new Error("URL contains token=synthetic-secret"),
    );
    await expect(h.run()).rejects.toThrow("聚水潭库存查询失败");
  });
  it("rejects an unconfigured integration and incomplete pagination", async () => {
    const h = fixture();
    h.prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      state: "UNCONFIGURED",
      publicConfig: {},
    });
    await expect(h.run()).rejects.toThrow("尚未配置");
    h.fetch.mockResolvedValueOnce(response([], true));
    await expect(h.run()).rejects.toThrow("分页未完整返回");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
