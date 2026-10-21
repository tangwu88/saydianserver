import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PartnerAdminService } from "./partner-admin.service";
import { PartnerCommerceService } from "./partner-commerce.service";

describe("partner product grouping", () => {
  it("pages products and retains all imported siblings, aliases and original ERP IDs", async () => {
    const levelId = randomUUID();
    const siblings = Array.from({ length: 35 }, (_, index) => ({
      id: `sku-${index}`,
      erpSkuId: `erp-${index}`,
      specification: `source-${index}`,
      salePriceCents: 1000,
      enabled: true,
      stock: index,
      partnerPrices: [
        {
          levelId,
          productName: "伙伴名称",
          specification: `alias-${index}`,
          priceCents: 700,
          enabled: index > 0,
        },
      ],
    }));
    const rows = [
      {
        id: "product",
        name: "商城名称",
        displayName: null,
        coverImage: null,
        status: "PUBLISHED",
        skus: siblings,
      },
    ];
    const db: any = {
      commerceCategory: { findMany: vi.fn(async () => []) },
      commerceProduct: {
        findMany: vi.fn(async () => rows),
        count: vi.fn(async () => 31),
      },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const result = await new PartnerAdminService(db, {} as any).groupedPrices(
      levelId,
      "alias-34",
      2,
    );
    expect(result).toMatchObject({ total: 31, page: 2, pageSize: 10 });
    expect(result.items[0]!.skus).toHaveLength(35);
    expect(result.items[0]).toMatchObject({ id: "product", name: "伙伴名称" });
    expect(result.items[0]!.skus[34]).toMatchObject({
      id: "sku-34",
      erpSkuId: "erp-34",
      specification: "alias-34",
    });
    const query = db.commerceProduct.findMany.mock.calls[0][0];
    expect(query).toMatchObject({
      skip: 10,
      take: 10,
      select: { skus: { where: { partnerPrices: { some: { levelId } } } } },
    });
    expect(query.select.skus).not.toHaveProperty("take");
    expect(query.select.skus.where).not.toHaveProperty("OR");
    expect(db.commerceProduct.count.mock.calls[0][0].where).toEqual(
      query.where,
    );
    expect(JSON.stringify(query.where)).toContain("alias-34");
    siblings[0]!.partnerPrices[0]!.productName = "另一个名称";
    expect(
      (
        await new PartnerAdminService(db, {} as any).groupedPrices(
          levelId,
          "",
          1,
        )
      ).items[0]!.name,
    ).toBe("商城名称");
  });

  it("keeps distinct product IDs despite equal names and deterministic SKU ordering in procurement", async () => {
    const sku = (id: string, name: string, stock = 1) => ({
      id,
      stock,
      partnerPrices: [{ productName: name, priceCents: 600 }],
      specification: id,
      salePriceCents: 1000,
    });
    const rows = [
      {
        id: "a",
        name: "同名商品",
        skus: [sku("sku-a", "名称甲"), sku("sku-b", "名称乙", 0), sku("sku-debt", "名称丙", -1)],
      },
      { id: "b", name: "同名商品", skus: [sku("sku-c", "名称甲")] },
    ];
    const db: any = {
      commerceCategory: { findMany: vi.fn(async () => []) },
      brandPartner: {
        findFirst: vi.fn(async () => ({
          levelId: "level",
          level: { active: true, name: "等级" },
        })),
      },
      commerceProduct: {
        findMany: vi.fn(async () => rows),
        count: vi.fn(async () => 2),
      },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const result = await new PartnerCommerceService(db).products(
      "partner",
      "名称乙",
      1,
    );
    expect(result.items.map((row) => row.id)).toEqual(["a", "b"]);
    expect(result.items[0]!.name).toBe("同名商品");
    expect(result.items[0]!.skus.map((row) => row.name)).toEqual([
      "名称甲",
      "名称乙",
      "名称丙",
    ]);
    expect(result.items[0]!.skus.map((row) => row.purchasable)).toEqual([true, false, false]);
    expect(result.total).toBe(2);
    expect(db.commerceProduct.findMany.mock.calls[0][0].where.skus.some).not.toHaveProperty("stock");
    expect(
      db.commerceProduct.findMany.mock.calls[0][0].include.skus.orderBy,
    ).toEqual({ id: "asc" });
  });
});
