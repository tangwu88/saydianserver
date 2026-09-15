import { afterEach, describe, expect, it, vi } from "vitest";
import { importJushuitanProductBySku } from "./jushuitan-product-import";

function providerResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function fixture(publicConfig: Record<string, unknown> = {}) {
  const saved = {
    id: "00000000-0000-4000-8000-000000000101",
    source: "ERP",
    erpItemId: "ITEM-001",
    name: "赛电智能手表",
    gallery: ["https://cdn.example.invalid/watch-main.jpg"],
    tags: ["健康", "手表"],
    skus: [
      {
        id: "00000000-0000-4000-8000-000000000102",
        erpSkuId: "ERP-SKU-001",
        stock: 7,
      },
    ],
  };
  const tx = {
    commerceProduct: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: saved.id }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(saved),
    },
    commerceSku: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    integrationConfig: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ state: "CONFIGURED", publicConfig }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  };
  const secrets = {
    resolve: vi.fn().mockResolvedValue({
      appKey: "synthetic-app-key",
      appSecret: "synthetic-app-secret",
      accessToken: "synthetic-access-token",
    }),
  };
  return { prisma, secrets, tx, saved };
}

const product = {
  sku_id: "ERP-SKU-001",
  i_id: "ITEM-001",
  name: "赛电智能手表",
  short_name: "W8",
  brand: "SAYDIAN",
  sale_price: 1498,
  market_price: 1698,
  cost_price: 800,
  properties_value: "黑色",
  pic_big: "https://cdn.example.invalid/watch-main.jpg",
  pics: ["https://cdn.example.invalid/watch-side.jpg"],
  labels: "健康,手表",
  sku_code: "690000000001",
  category: "血压手表",
  supplier_id: 321,
  enabled: 1,
  stock_disabled: 0,
  weight: 0.2,
  modified: "2026-09-15 10:00:00",
};

const inventory = {
  sku_id: "ERP-SKU-001",
  i_id: "ITEM-001",
  qty: 7,
  order_lock: 2,
  pick_lock: 1,
  virtual_qty: 0,
  modified: "2026-09-15 10:01:00",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("administrator direct Jushuitan product import", () => {
  it("queries the configured V2 product and inventory APIs by exact SKU before importing", async () => {
    const h = fixture({
      apiBase: "https://openapi.jushuitan.com",
      paths: { sku: "/open/sku/query", inventory: "/open/inventory/query" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        providerResponse({ code: 0, data: { datas: [product] } }),
      )
      .mockResolvedValueOnce(
        providerResponse({ code: 0, data: { datas: [inventory] } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await importJushuitanProductBySku(
      h.prisma as any,
      h.secrets as any,
      {
        sku: " ERP-SKU-001 ",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://openapi.jushuitan.com/open/sku/query",
    );
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      "https://openapi.jushuitan.com/open/inventory/query",
    );
    const productParams = new URLSearchParams(
      String(fetchMock.mock.calls[0]![1]!.body),
    );
    const inventoryParams = new URLSearchParams(
      String(fetchMock.mock.calls[1]![1]!.body),
    );
    expect(JSON.parse(productParams.get("biz")!)).toEqual({
      sku_ids: "ERP-SKU-001",
      page_index: 1,
      page_size: 20,
      flds: "purchase_price,pics",
      loadSkuBin: true,
    });
    expect(JSON.parse(inventoryParams.get("biz")!)).toEqual({
      sku_ids: "ERP-SKU-001",
      page_index: 1,
      page_size: 100,
      has_lock_qty: true,
    });
    expect(productParams.get("sign")).toMatch(/^[0-9a-f]{32}$/);
    expect(
      h.tx.commerceProduct.findUnique.mock.invocationCallOrder[0],
    ).toBeGreaterThan(fetchMock.mock.invocationCallOrder[1]!);
    expect(h.tx.commerceProduct.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: "ERP",
          erpItemId: "ITEM-001",
          name: "赛电智能手表",
          displayName: "赛电智能手表",
          subtitle: "W8",
          brand: "SAYDIAN",
          gallery: [
            "https://cdn.example.invalid/watch-main.jpg",
            "https://cdn.example.invalid/watch-side.jpg",
          ],
          tags: ["健康", "手表"],
          status: "DRAFT",
        }),
      }),
    );
    expect(h.tx.commerceSku.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          erpSkuId: "ERP-SKU-001",
          salePriceCents: 149800,
          marketPriceCents: 169800,
          costPriceCents: 80000,
          stock: 7,
          barcode: "690000000001",
          weightGrams: 200,
        }),
      }),
    );
    expect(result).toMatchObject({
      id: h.saved.id,
      erpLookup: {
        requestedSku: "ERP-SKU-001",
        product: { category: "血压手表", supplier_id: 321 },
        inventory: { qty: 7, order_lock: 2, pick_lock: 1 },
      },
    });
    expect(h.prisma.integrationConfig.updateMany).toHaveBeenCalledWith({
      where: { key: "jushuitan" },
      data: { lastCheckedAt: expect.any(Date), lastError: null },
    });
  });

  it("supports the configured legacy gateway without consulting the local product list for source data", async () => {
    const h = fixture();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        providerResponse({
          code: 0,
          issuccess: true,
          data: { datas: [product] },
        }),
      )
      .mockResolvedValueOnce(
        providerResponse({
          code: 0,
          issuccess: true,
          data: { inventorys: [inventory] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await importJushuitanProductBySku(h.prisma as any, h.secrets as any, {
      sku: "ERP-SKU-001",
    });

    const productUrl = new URL(String(fetchMock.mock.calls[0]![0]));
    const inventoryUrl = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(productUrl.origin + productUrl.pathname).toBe(
      "https://open.erp321.com/api/open/query.aspx",
    );
    expect(productUrl.searchParams.get("method")).toBe("sku.query");
    expect(inventoryUrl.searchParams.get("method")).toBe("inventory.query");
    expect(productUrl.searchParams.get("sign")).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      sku_ids: "ERP-SKU-001",
      page_index: 1,
      page_size: 20,
    });
    expect(h.prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("does not write when the ERP inventory response is missing", async () => {
    const h = fixture();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        providerResponse({ code: 0, data: { datas: [product] } }),
      )
      .mockResolvedValueOnce(
        providerResponse({ code: 0, data: { datas: [] } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importJushuitanProductBySku(h.prisma as any, h.secrets as any, {
        sku: "ERP-SKU-001",
      }),
    ).rejects.toThrow("本次没有导入");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps unconfigured or unauthorized ERP access explicit", async () => {
    const unconfigured = fixture();
    unconfigured.prisma.integrationConfig.findUnique.mockResolvedValueOnce({
      state: "UNCONFIGURED",
      publicConfig: {},
    } as any);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      importJushuitanProductBySku(
        unconfigured.prisma as any,
        unconfigured.secrets as any,
        {
          sku: "ERP-SKU-001",
        },
      ),
    ).rejects.toThrow("尚未配置");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(unconfigured.prisma.$transaction).not.toHaveBeenCalled();

    const unauthorized = fixture();
    const deniedFetch = vi
      .fn()
      .mockResolvedValue(providerResponse({ code: 190, msg: "无权限" }));
    vi.stubGlobal("fetch", deniedFetch);
    await expect(
      importJushuitanProductBySku(
        unauthorized.prisma as any,
        unauthorized.secrets as any,
        {
          sku: "ERP-SKU-001",
        },
      ),
    ).rejects.toThrow("错误码 190");
    expect(unauthorized.prisma.$transaction).not.toHaveBeenCalled();
  });
});
