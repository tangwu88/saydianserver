import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

function harness(locale: string | null = "en") {
  const category = { id: "category", name: "Category", locale };
  const articleCategory = {
    findUnique: vi.fn().mockResolvedValue(category),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn(async ({ data }: any) => ({ ...category, ...data })),
    create: vi.fn(async ({ data }: any) => ({ ...category, ...data })),
  };
  const article = {
    findUnique: vi.fn().mockResolvedValue({ id: "article", locale }),
    findFirst: vi.fn().mockResolvedValue(null),
    update: vi.fn(async ({ data }: any) => data),
    create: vi.fn(async ({ data }: any) => data),
  };
  const tx = {
    articleCategory,
    article,
    $executeRaw: vi.fn().mockResolvedValue(1),
    compatibilityId: {
      findMany: vi.fn().mockResolvedValue([{ id: 1, externalId: category.id }]),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: any) => callback(tx)),
  };
  return { ...tx, prisma, service: new AdminService(prisma as any, {} as any) };
}
const articleInput = { title: "Synthetic", contentHtml: "<p>Fixture</p>" };

describe("admin content locale", () => {
  it.each(["en", "zh-Hans", "zh-Hant", null])(
    "preserves omitted locale %s on both edits",
    async (locale) => {
      const h = harness(locale);
      expect(
        await h.service.saveArticle("article", articleInput),
      ).toMatchObject({ locale });
      expect(
        await h.service.saveArticleCategory("category", { name: "Edited" }),
      ).toMatchObject({ locale });
    },
  );
  it("defaults new articles and categories to Simplified Chinese", async () => {
    const h = harness();
    expect(await h.service.saveArticle(undefined, articleInput)).toMatchObject({
      locale: "zh-Hans",
    });
    expect(
      await h.service.saveArticleCategory(undefined, { name: "New" }),
    ).toMatchObject({ locale: "zh-Hans" });
  });
  it.each(["zh-CN", "zh_CN", "zh-Hans"])(
    "normalizes old Chinese alias %s",
    async (locale) => {
      const h = harness();
      expect(
        await h.service.saveArticle(undefined, { ...articleInput, locale }),
      ).toMatchObject({ locale: "zh-Hans" });
    },
  );
  it.each(["", "xx", 42])(
    "rejects invalid explicit locale %s before writing",
    async (locale) => {
      const h = harness();
      await expect(
        h.service.saveArticle(undefined, { ...articleInput, locale }),
      ).rejects.toThrow("请选择支持的内容语言");
      await expect(
        h.service.saveArticleCategory(undefined, { name: "New", locale }),
      ).rejects.toThrow("请选择支持的内容语言");
      expect(h.article.create).not.toHaveBeenCalled();
      expect(h.articleCategory.create).not.toHaveBeenCalled();
    },
  );
  it("rejects article/category and parent/category locale mismatches", async () => {
    const h = harness();
    await expect(
      h.service.saveArticle(undefined, {
        ...articleInput,
        categoryId: "category",
      }),
    ).rejects.toThrow("文章与分类的语言必须一致");
    await expect(
      h.service.saveArticleCategory(undefined, {
        name: "New",
        parentId: "category",
      }),
    ).rejects.toThrow("分类与上级分类的语言必须一致");
    expect(h.article.create).not.toHaveBeenCalled();
    expect(h.articleCategory.create).not.toHaveBeenCalled();
  });
  it("accepts matching categories and locks both write paths", async () => {
    const h = harness("zh-Hans");
    await h.service.saveArticle(undefined, {
      ...articleInput,
      categoryId: "category",
    });
    await h.service.saveArticleCategory(undefined, {
      name: "New",
      parentId: "category",
    });
    expect(h.$executeRaw).toHaveBeenCalledTimes(2);
    expect(h.article.create).toHaveBeenCalledOnce();
    expect(h.articleCategory.create).toHaveBeenCalledOnce();
  });
  it.each(["article", "child"])(
    "blocks a category locale change that conflicts with an existing %s",
    async (kind) => {
      const h = harness();
      (kind === "article"
        ? h.article
        : h.articleCategory
      ).findFirst.mockResolvedValue({ id: "dependent" });
      await expect(
        h.service.saveArticleCategory("category", {
          name: "Edited",
          locale: "zh-Hans",
        }),
      ).rejects.toThrow("请先处理分类下不同语言的文章或子分类");
      expect(h.articleCategory.update).not.toHaveBeenCalled();
    },
  );
  it("does not recreate a missing edited article or category", async () => {
    const h = harness();
    h.article.findUnique.mockResolvedValue(null);
    h.articleCategory.findUnique.mockResolvedValue(null);
    await expect(
      h.service.saveArticle("missing", articleInput),
    ).rejects.toThrow("文章不存在");
    await expect(
      h.service.saveArticleCategory("missing", { name: "Edited" }),
    ).rejects.toThrow("分类不存在");
    expect(h.article.create).not.toHaveBeenCalled();
    expect(h.articleCategory.create).not.toHaveBeenCalled();
  });
});
