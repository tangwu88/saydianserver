import { afterEach, describe, expect, it, vi } from "vitest";
import { callChatProvider } from "./ai-chat-provider";

const settings = {
  baseUrl: "https://example.invalid",
  apiKey: "SECRET_SENTINEL",
  model: "synthetic",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("AI chat safe diagnostics", () => {
  it.each([
    [401, "AI_PROVIDER_AUTH"],
    [403, "AI_PROVIDER_AUTH"],
    [402, "AI_PROVIDER_LIMIT"],
    [429, "AI_PROVIDER_LIMIT"],
    [400, "AI_PROVIDER_REJECTED"],
    [503, "AI_PROVIDER_UNAVAILABLE"],
  ])("categorizes HTTP %s without provider text", async (status, key) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "1211", message: "PRIVATE_RESPONSE_SENTINEL" },
            }),
            { status: Number(status) },
          ),
      ),
    );
    const diagnose = vi.fn();
    await expect(
      callChatProvider(
        "PRIVATE_QUESTION_SENTINEL",
        settings,
        "zh-Hans",
        diagnose,
      ),
    ).rejects.toMatchObject({
      response: { errorKey: key },
    });
    expect(diagnose).toHaveBeenCalledTimes(1);
    expect(diagnose.mock.calls[0]![0]).toEqual({
      event: "ai_chat_provider_failure",
      errorKey: key,
      upstreamStatus: status,
      providerCode: "1211",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(diagnose.mock.calls)).not.toMatch(
      /PRIVATE_|SECRET_|example.invalid|synthetic/,
    );
  });
  it.each(["TimeoutError", "AbortError", "TypeError"])(
    "classifies %s without exception text",
    async (name) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw Object.assign(new Error("SECRET_EXCEPTION_SENTINEL"), { name });
        }),
      );
      const diagnose = vi.fn();
      await expect(
        callChatProvider("question", settings, "en", diagnose),
      ).rejects.toMatchObject({
        response: {
          errorKey:
            name === "TypeError"
              ? "AI_PROVIDER_NETWORK"
              : "AI_PROVIDER_TIMEOUT",
        },
      });
      expect(JSON.stringify(diagnose.mock.calls)).not.toContain(
        "SECRET_EXCEPTION",
      );
    },
  );
  it.each(["PRIVATE_CODE", "1234567", "12"])(
    "rejects unbounded/free-text error code %s",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { code } }), { status: 400 }),
        ),
      );
      const diagnose = vi.fn();
      await expect(
        callChatProvider("question", settings, "en", diagnose),
      ).rejects.toThrow();
      expect(diagnose.mock.calls[0]![0].providerCode).toBeNull();
    },
  );
  it.each([
    "not-json",
    JSON.stringify({ choices: [{ message: { content: " " } }] }),
    JSON.stringify({ choices: [{ message: { content: { secret: true } } }] }),
  ])("rejects malformed or empty answers", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const diagnose = vi.fn();
    await expect(
      callChatProvider("question", settings, "en", diagnose),
    ).rejects.toMatchObject({
      response: { errorKey: "AI_PROVIDER_INVALID_RESPONSE" },
    });
    expect(diagnose).toHaveBeenCalledTimes(1);
  });
  it("preserves successful reply, locale, model and timeout without logging", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: " answer " } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout"),
      diagnose = vi.fn();
    expect(await callChatProvider("question", settings, "ko", diagnose)).toBe(
      "answer",
    );
    const options = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(String(options.body))).toMatchObject({
      model: "synthetic",
      messages: [
        { role: "system", content: expect.stringContaining("Korean (ko)") },
        { role: "user", content: "question" },
      ],
    });
    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(diagnose).not.toHaveBeenCalled();
  });
});
