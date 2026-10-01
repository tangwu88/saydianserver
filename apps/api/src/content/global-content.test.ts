import { afterEach, describe, expect, it, vi } from "vitest";
import { globalAiSystemPrompt } from "./global-content";
import { ContentService } from "./content.service";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("global localized content", () => {
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
  it("selects AI language by locale rather than deployment", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Synthetic answer" } }] }) })); vi.stubGlobal("fetch", fetch);
    const service = new ContentService({} as any, {} as any); const settings = { provider: "synthetic", baseUrl: "https://example.invalid", apiKey: "synthetic", model: "synthetic" };
    vi.stubEnv("APP_REALM", "global"); await (service as any).callAiProvider("Synthetic question", settings, "ko");
    expect(JSON.parse((fetch.mock.calls[0] as any)[1].body).messages[0].content).toContain("Korean (ko)");
    vi.stubEnv("APP_REALM", "domestic"); await (service as any).callAiProvider("Synthetic question", settings, "zh-Hans");
    expect(JSON.parse((fetch.mock.calls[1] as any)[1].body).messages[0].content).toContain("zh-Hans");
  });
});
