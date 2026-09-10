import { afterEach, describe, expect, it, vi } from "vitest";
import { withCategoryNumbers } from "./article-category-number";
import { AdminService } from "./admin.service";

const category = { id: "fb4ff2cf-f1c5-4ae3-b3fb-85de596c4a87", name: "Synthetic category", parentId: null, sort: 0, enabled: true, locale: "en" };
function harness() {
  const compatibilityId = {
    findMany: vi.fn().mockResolvedValue([{ id: 12, externalId: category.id }]),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const articleCategory = {
    findMany: vi.fn().mockResolvedValue([category]),
    update: vi.fn(async ({ where, data }: any) => ({ ...category, ...data, id: where.id })),
    create: vi.fn(async ({ data }: any) => ({ ...category, ...data })),
  };
  const tx = { compatibilityId, articleCategory };
  const prisma = { ...tx, $transaction: vi.fn(async (callback: any) => callback(tx)) };
  return { ...tx, prisma, service: new AdminService(prisma as any, {} as any) };
}
afterEach(() => vi.unstubAllEnvs());

describe("international category display numbers", () => {
  it("keeps a stable number after rename, reordering and repeated reads without rewriting mappings", async () => {
    const h = harness();
    const first = await withCategoryNumbers(h.prisma as any, [category]);
    const second = await withCategoryNumbers(h.prisma as any, [{ ...category, name: "Renamed", sort: 100 }]);
    expect(first[0]).toEqual({ ...category, categoryNo: "12" });
    expect(second[0]).toMatchObject({ id: category.id, categoryNo: "12", name: "Renamed", sort: 100 });
    expect(h.compatibilityId.createMany).not.toHaveBeenCalled();
  });

  it("allocates only missing mappings and rereads the winner of concurrent inserts", async () => {
    const h = harness();
    h.compatibilityId.findMany.mockResolvedValueOnce([]);
    h.compatibilityId.createMany.mockResolvedValue({ count: 0 });
    expect(await withCategoryNumbers(h.prisma as any, [category])).toEqual([{ ...category, categoryNo: "12" }]);
    expect(h.compatibilityId.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [{ entityType: "global_article_category", externalId: category.id }], skipDuplicates: true,
    });
    expect(h.compatibilityId.findMany).toHaveBeenCalledTimes(2);
  });

  it("joins numbers by UUID rather than sort order and batches all missing rows", async () => {
    const h = harness();
    h.compatibilityId.findMany.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 3, externalId: "b" }, { id: 2, externalId: "a" },
    ]);
    expect(await withCategoryNumbers(h.prisma as any, [{ id: "b" }, { id: "a" }])).toEqual([
      { id: "b", categoryNo: "3" }, { id: "a", categoryNo: "2" },
    ]);
    expect(h.compatibilityId.createMany).toHaveBeenCalledExactlyOnceWith({ data: [
      { entityType: "global_article_category", externalId: "a" }, { entityType: "global_article_category", externalId: "b" },
    ], skipDuplicates: true });
  });

  it("does not allocate for an empty list or fabricate a number on a missing mapping", async () => {
    const h = harness();
    expect(await withCategoryNumbers(h.prisma as any, [])).toEqual([]);
    expect(h.compatibilityId.findMany).not.toHaveBeenCalled();
    h.compatibilityId.findMany.mockResolvedValue([]);
    await expect(withCategoryNumbers(h.prisma as any, [category])).rejects.toThrow("分类编号暂时无法读取");
  });

  it("adds the number to international lists only, without changing domestic responses", async () => {
    const h = harness(); vi.stubEnv("APP_REALM", "global");
    expect(await h.service.articleCategories()).toEqual([{ ...category, categoryNo: "12" }]);
    vi.stubEnv("APP_REALM", "domestic"); h.compatibilityId.findMany.mockClear();
    expect(await h.service.articleCategories()).toEqual([category]);
    expect(h.compatibilityId.findMany).not.toHaveBeenCalled();
  });

  it.each([undefined, category.id])("saves category %s with its number in one transaction and ignores a forged display ID", async id => {
    const h = harness(); vi.stubEnv("APP_REALM", "global");
    const saved = await h.service.saveArticleCategory(id, { name: "Edited", categoryNo: "999", id: "forged", parentId: "parent-uuid" });
    expect(saved).toMatchObject({ id: category.id, categoryNo: "12", name: "Edited", parentId: "parent-uuid" });
    const write = id ? h.articleCategory.update : h.articleCategory.create;
    expect(write.mock.calls[0]?.[0].data).not.toHaveProperty("categoryNo");
    expect(write.mock.calls[0]?.[0].data).not.toHaveProperty("id");
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    if (id) expect(write.mock.calls[0]?.[0].where).toEqual({ id: category.id });
  });
});
