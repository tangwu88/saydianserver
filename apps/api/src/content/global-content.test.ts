import { afterEach, describe, expect, it, vi } from "vitest";
import { globalAiSystemPrompt } from "./global-content";
import { ContentService } from "./content.service";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("global localized content", () => {
  it.each(["zh-CN", "zh_CN", "zh", "zh-Hans"])("uses the same Chinese category/list/detail locale for %s", async locale => {
    const articleCategory = { findMany: vi.fn().mockResolvedValue([]) };
    const article = { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue({ id: "test", locale: "zh-Hans" }) };
    const service = new ContentService({ articleCategory, article, $transaction: (values: any[]) => Promise.all(values) } as any, {} as any);
    await service.categories(undefined, locale);
    await service.articles(undefined, 1, 20, locale);
    await service.article("test", locale);
    for (const read of [articleCategory.findMany, article.findMany, article.findFirst]) expect(read).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ locale: "zh-Hans" }) }));
  });
  it("keeps wellness boundaries while selecting one of the eight languages", () => {
    expect(globalAiSystemPrompt("ja")).toContain("Japanese (ja)"); expect(globalAiSystemPrompt("xx")).toContain("English (en)");
    expect(globalAiSystemPrompt("de")).toContain("Do not make diagnoses"); expect(globalAiSystemPrompt("de")).toContain("Never invent health measurements");
  });
  it("does not list another language as a translated article", async () => {
    vi.stubEnv("APP_REALM", "global"); const findMany = vi.fn(async () => []); const count = vi.fn(async () => 0);
    const service = new ContentService({ article: { findMany, count }, $transaction: (values: any[]) => Promise.all(values) } as any, {} as any);
    expect(await service.articles(undefined, 1, 20, "de-DE,en;q=0.8")).toMatchObject({ items: [], total: 0 });
    expect((findMany.mock.calls[0] as any)[0].where.locale).toBe("de");
  });
  it("returns shared content plus the requested app and rejects unknown app scopes", async () => {
    const findMany = vi.fn(async () => []), count = vi.fn(async () => 0), findFirst = vi.fn(async () => ({ id: "ring" }));
    const service = new ContentService({ article: { findMany, count, findFirst }, $transaction: (values: any[]) => Promise.all(values) } as any, {} as any);
    await service.articles(undefined, 1, 20, "zh-Hans", "say-ring");
    expect((findMany.mock.calls[0] as any)[0].where.product).toEqual({ in: ["shared", "say-ring"] });
    await service.article("ring", "zh-Hans", "saidian");
    expect((findFirst.mock.calls[0] as any)[0].where.product).toEqual({ in: ["shared", "saidian"] });
    await expect(service.articles(undefined, 1, 20, "zh-Hans", "unknown-app")).rejects.toThrow("支持的前端应用");
  });
  it("selects AI language by locale rather than deployment", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Synthetic answer" } }] }) })); vi.stubGlobal("fetch", fetch);
    const service = new ContentService({} as any, {} as any); const settings = { provider: "synthetic", baseUrl: "https://example.invalid", apiKey: "synthetic", model: "synthetic" };
    vi.stubEnv("APP_REALM", "global"); await (service as any).callAiProvider("Synthetic question", settings, "ko");
    expect(JSON.parse((fetch.mock.calls[0] as any)[1].body).messages[0].content).toContain("Korean (ko)");
    vi.stubEnv("APP_REALM", "domestic"); await (service as any).callAiProvider("Synthetic question", settings, "zh-Hans");
    expect(JSON.parse((fetch.mock.calls[1] as any)[1].body).messages[0].content).toContain("zh-Hans");
  });
});
