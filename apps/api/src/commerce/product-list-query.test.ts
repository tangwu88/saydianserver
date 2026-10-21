import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { productCategoryFilter, productPage } from "./product-list-query";
import { AdminService } from "../admin/admin.service";
import { PartnerAdminService } from "../partners/partner-admin.service";
import { PartnerCommerceService } from "../partners/partner-commerce.service";

describe("product category filtering and pagination", () => {
  const parent = randomUUID(),
    child = randomUUID(),
    leaf = randomUUID(),
    other = randomUUID();
  function database() {
    return {
      commerceCategory: {
        findMany: vi.fn(async () => [
          { id: parent, name: "手表", parentId: null },
          { id: child, name: "智能", parentId: parent },
          { id: leaf, name: "健康", parentId: child },
          { id: other, name: "智能", parentId: null },
        ]),
      },
      commerceProduct: {
        findMany: vi.fn(async (_query: any) => []),
        count: vi.fn(async (_query: any) => 27),
      },
      brandPartner: {
        findFirst: vi.fn(async () => ({
          levelId: "level",
          level: { active: true, name: "等级" },
        })),
      },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
  }

  it("defaults to ten, normalizes invalid values, truncates fractions and caps work", () => {
    expect(productPage(undefined)).toEqual({ page: 1, pageSize: 10, skip: 0 });
    expect(productPage(-1, "bad")).toEqual({ page: 1, pageSize: 10, skip: 0 });
    expect(productPage(Infinity, Infinity)).toEqual({
      page: 1,
      pageSize: 10,
      skip: 0,
    });
    expect(productPage(2.8, "20")).toEqual({ page: 2, pageSize: 20, skip: 20 });
    expect(productPage(1e10, 500)).toEqual({
      page: 1_000_000,
      pageSize: 100,
      skip: 99_999_900,
    });
  });

  it("includes descendants by ID, labels ancestry and supports uncategorized", async () => {
    const db = database();
    const result = await productCategoryFilter(db as any, parent);
    expect(result.where).toEqual({ categoryId: { in: [parent, child, leaf] } });
    expect(result.categories[2]?.label).toBe("手表 / 智能 / 健康");
    expect(
      (await productCategoryFilter(db as any, "uncategorized")).where,
    ).toEqual({ categoryId: null });
    expect((await productCategoryFilter(db as any)).where).toEqual({});
    await expect(productCategoryFilter(db as any, "invalid")).rejects.toThrow(
      "商品分类不正确",
    );
    const missing = randomUUID();
    expect((await productCategoryFilter(db as any, missing)).where).toEqual({
      categoryId: { in: [missing] },
    });
  });

  it("does not loop on legacy cyclic categories", async () => {
    const db = {
      commerceCategory: {
        findMany: async () => [
          { id: parent, name: "A", parentId: child },
          { id: child, name: "B", parentId: parent },
        ],
      },
    };
    const result = await productCategoryFilter(db as any, parent);
    expect(result.categories).toHaveLength(2);
    expect(result.where).toEqual({ categoryId: { in: [parent, child] } });
  });

  for (const kind of ["mall", "prices", "procurement"] as const) {
    it(`${kind}: combines search/category/access rules before product count and page slicing`, async () => {
      const db = database();
      const query =
        kind === "mall"
          ? () =>
              new AdminService(db as any, {} as any).commerceProducts(
                "礼盒",
                2,
                "PUBLISHED",
                20,
                parent,
              )
          : kind === "prices"
            ? () =>
                new PartnerAdminService(db as any, {} as any).groupedPrices(
                  randomUUID(),
                  "礼盒",
                  2,
                  20,
                  parent,
                )
            : () =>
                new PartnerCommerceService(db as any).products(
                  "partner",
                  "礼盒",
                  2,
                  20,
                  parent,
                );
      const result = await query();
      expect(result).toMatchObject({
        items: [],
        total: 27,
        page: 2,
        pageSize: 20,
      });
      const list = db.commerceProduct.findMany.mock.calls[0]![0];
      expect(list).toMatchObject({
        skip: 20,
        take: 20,
        where: { categoryId: { in: [parent, child, leaf] } },
      });
      expect(JSON.stringify(list.where)).toContain("礼盒");
      expect(db.commerceProduct.count.mock.calls[0]![0].where).toEqual(
        list.where,
      );
      expect(result.categories).toHaveLength(4);
      if (kind === "procurement")
        expect(list.where).toMatchObject({
          status: "PUBLISHED",
          localArchived: false,
          skus: {
            some: {
              enabled: true,
              partnerPrices: { some: { enabled: true, levelId: "level" } },
            },
          },
        });
      if (kind === "prices")
        expect(list.select.skus).not.toHaveProperty("take");
    });
  }
});
