import { describe, expect, it, vi } from "vitest";
import { assertSayRingModuleVisible, sayRingIosModuleVisibility } from "./say-ring-module-visibility";
import { ContentService } from "../content/content.service";
import { ContentController } from "../content/content.controller";
import { CommerceService } from "../commerce/commerce.service";
import { CommerceController } from "../commerce/commerce.controller";

const value = { schemaVersion: 1, modules: { health_library: true, mall: false } };
const scope = { product: "say-ring", platform: "ios" };
function harness(config: unknown = undefined) {
  const prisma: any = { appSetting: { findFirst: vi.fn(async () => config === undefined ? null : { value: config }) }, articleCategory: { findMany: vi.fn(async () => []) }, article: { findFirst: vi.fn(async () => ({ id: "article" })), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) }, $transaction: vi.fn(async (values: any[]) => Promise.all(values)) };
  return prisma;
}
describe("explicit product/platform module read visibility", () => {
  it.each([[undefined, undefined], ["say-ring", undefined], ["say-ring", "web"], ["saydian-global", "ios"], ["saydian-app-cn", "ios"]])("never reads settings for old or other scope %s/%s", async (product, platform) => {
    const p = harness();
    await assertSayRingModuleVisible(p, "mall", product, platform);
    expect(p.appSetting.findFirst).not.toHaveBeenCalled();
  });
  it.each(["ios", "android", "harmonyos"])("uses the same published flags and rejects hidden reads on %s", async platform => {
    const p = harness(value);
    await assertSayRingModuleVisible(p, "health_library", "say-ring", platform);
    await expect(assertSayRingModuleVisible(p, "mall", "say-ring", platform)).rejects.toMatchObject({ status: 404 });
    const service = new ContentService(p, {} as any);
    p.appSetting.findFirst.mockResolvedValue({ value: { ...value, modules: { health_library: false, mall: true } } });
    await expect(service.categories(undefined, "en", "say-ring", platform)).rejects.toMatchObject({ status: 404 });
    expect(p.articleCategory.findMany).not.toHaveBeenCalled();
  });
  it("fails closed for absent/malformed/query errors and keeps independent flags", async () => {
    for (const data of [undefined, { schemaVersion: 2 }, { ...value, modules: { health_library: true, mall: "true" } }]) {
      const p = harness(data);
      await expect(assertSayRingModuleVisible(p, "health_library", scope.product, scope.platform)).rejects.toMatchObject({ status: 404 });
    }
    const p = harness(value);
    await assertSayRingModuleVisible(p, "health_library", scope.product, scope.platform);
    await expect(assertSayRingModuleVisible(p, "mall", scope.product, scope.platform)).rejects.toMatchObject({ status: 404 });
    p.appSetting.findFirst.mockRejectedValue(new Error("DB unavailable"));
    expect((await sayRingIosModuleVisibility(p)).modules).toEqual({ health_library: false, mall: false });
  });
  it("blocks all article reads before any content query while leaving legacy reads working", async () => {
    const p = harness(); const service = new ContentService(p, {} as any);
    for (const call of [() => service.categories(undefined, "en", "say-ring", "ios"), () => service.articles(undefined, 1, 20, "en", "say-ring", "ios"), () => service.article("article", "en", "say-ring", "ios")])
      await expect(call()).rejects.toMatchObject({ status: 404 });
    expect(p.articleCategory.findMany).not.toHaveBeenCalled(); expect(p.article.findMany).not.toHaveBeenCalled(); expect(p.article.findFirst).not.toHaveBeenCalled();
    await service.categories(undefined, "en", "say-ring");
    await service.articles(undefined, 1, 20, "en", "say-ring");
    await service.article("article", "en", "say-ring");
    expect(p.articleCategory.findMany).toHaveBeenCalledOnce(); expect(p.article.findFirst).toHaveBeenCalledOnce();
  });
  it("gates only explicitly scoped public commerce reads before calling the store", async () => {
    const p = harness(value), store = { markets: vi.fn(async () => ({ markets: [] })) };
    const service = new CommerceService(p, store as any, {} as any);
    for (const path of ["/storefront/markets", "/storefront/bootstrap", "/storefront/products", "/storefront/products/item"])
      await expect(service.publicGet(path, scope)).rejects.toMatchObject({ status: 404 });
    expect(store.markets).not.toHaveBeenCalled();
    await service.publicGet("/storefront/markets"); expect(store.markets).toHaveBeenCalledOnce();
    p.appSetting.findFirst.mockResolvedValue({ value: { ...value, modules: { health_library: false, mall: true } } });
    await service.publicGet("/storefront/markets", scope); expect(store.markets).toHaveBeenCalledTimes(2);
  });
  it("wires product and platform through the existing controllers without touching write paths", async () => {
    const content: any = { categories: vi.fn(), articles: vi.fn(), article: vi.fn() };
    const c = new ContentController(content);
    c.categories(undefined, "en", undefined, "say-ring", "ios"); c.articles(undefined, "1", "20", "en", undefined, "say-ring", "ios"); c.article("id", "en", undefined, "say-ring", "ios");
    expect(content.categories).toHaveBeenCalledWith(undefined, "en", "say-ring", "ios");
    expect(content.articles).toHaveBeenCalledWith(undefined, 1, 20, "en", "say-ring", "ios"); expect(content.article).toHaveBeenCalledWith("id", "en", "say-ring", "ios");
    const commerce: any = { publicGet: vi.fn(), forUser: vi.fn() };
    const m = new CommerceController(commerce, {} as any);
    m.home("say-ring", "ios"); m.markets("say-ring", "ios"); m.products(scope); m.product("id", "say-ring", "ios");
    expect(commerce.publicGet.mock.calls.every((call: any[]) => JSON.stringify(call[1]) === JSON.stringify(scope))).toBe(true);
    expect(commerce.forUser).not.toHaveBeenCalled();
  });
});
