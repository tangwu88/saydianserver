import { afterEach, describe, expect, it, vi } from "vitest";
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
    commerceSku: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    commerceSku: { findMany: vi.fn().mockResolvedValue(skus) },
    integrationConfig: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          state: "CONFIGURED",
          publicConfig: { paths: { sku: "/open/sku/query" } },
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  };
  const secrets = {
    resolve: vi
      .fn()
      .mockResolvedValue({
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
    expect(JSON.parse(h.fetch.mock.calls[0]![1].body.get("biz"))).toMatchObject({
      sku_ids: "ERP-0,ERP-1",
      has_lock_qty: true,
    });
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
