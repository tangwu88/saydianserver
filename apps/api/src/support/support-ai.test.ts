import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import type { SupportContent } from "./support-content";
import { SupportAi } from "./support-ai";

const fixture = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Find your ring",
  body: "Open the Device settings.",
};
const reply = (answer: string, sourceIds: string[]) =>
  new Response(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify({ answer, sourceIds }) } },
      ],
    }),
  );
function service(articles = [fixture], url = "https://fixture.invalid/v1") {
  const selectArticles = vi.fn(async () => articles);
  return {
    selectArticles,
    ai: new SupportAi(
      {
        integrationConfig: {
          findUnique: async () => ({
            state: "CONFIGURED",
            publicConfig: { baseUrl: url },
          }),
        },
      } as unknown as PrismaService,
      {
        resolve: async () => ({ apiKey: "synthetic" }),
      } as unknown as IntegrationSecretsService,
      { knowledge: selectArticles } as unknown as SupportContent,
    ),
  };
}

describe("grounded support AI", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("sends only the redacted text and published articles, and returns only allowed references", async () => {
    const fetchMock = vi.fn(async (_url: URL, _options: RequestInit) =>
      reply("Open Device settings.", [fixture.id, "unknown"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { ai, selectArticles } = service();
    const result = await ai.answer(
      "en",
      "Find your ring. Contact sample@example.test or +1 (202) 555-0123; OTP: 123456",
    );
    expect(result).toEqual({
      body: "Open Device settings.",
      sources: [{ id: fixture.id, title: fixture.title }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    const sent = JSON.parse(body.messages[1].content);
    expect(Object.keys(sent)).toEqual(["question", "articles"]);
    expect(sent.articles).toEqual([fixture]);
    expect(sent.question).not.toMatch(/example|555|123456/);
    expect(selectArticles).toHaveBeenCalledWith("en", sent.question);
  });
  it("falls back with no evidence or unsupported provider URL without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await service([]).ai.answer("en", "Find your ring")).body,
    ).toContain("ask a person");
    expect(
      (
        await service([fixture], "http://fixture.invalid").ai.answer(
          "en",
          "Find your ring",
        )
      ).sources,
    ).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("never displays an unsupported model answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => reply("Unsupported answer.", ["unknown"])),
    );
    expect(await service().ai.answer("en", "Find your ring")).toMatchObject({
      body: expect.stringContaining("ask a person"),
      sources: [],
    });
  });
});
