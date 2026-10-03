import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callAiProvider,
  SleepProviderError,
  reportRetryPolicy,
} from "./health-report-worker";
import { SLEEP_REPORT_TEMPLATE } from "@saydian/app-contracts";

const period = {
  from: "2026-10-01T00:00:00Z",
  to: "2026-10-02T00:00:00Z",
  distinctDays: 1,
  validRecordCount: 1,
};
const settings = {
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKey: "synthetic-test-key",
  model: "glm-5.3-flash",
};
const metrics = [{ metric: "sleep", totalSeconds: 25200 }];
const evidence = {
  byMetric: [{ metric: "sleep", recordIds: ["synthetic-snapshot"] }],
};
const content = {
  overview: "仅分析合成测试数据。",
  trends: [{ metric: "sleep", text: "仅观察本次记录。" }],
  suggestions: ["规律作息。"],
  limitations: ["单日设备估计有局限。"],
  sleepScore: {
    value: 70,
    scale: 100,
    confidence: "low",
    explanation: "基于测试记录的参考评价。",
  },
};
const result = (finish = "stop", value: unknown = content) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finish,
          message: { content: JSON.stringify(value) },
        },
      ],
    }),
  );
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sleep-only provider timeout and bounded retry", () => {
  it("gives sleep GLM a bounded low reasoning request and 120 seconds", async () => {
    const fetch = vi.fn(async () => result());
    vi.stubGlobal("fetch", fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await callAiProvider(metrics, evidence, period, settings, true);
    const request = (
      fetch.mock.calls as unknown as [string, RequestInit][]
    )[0]![1];
    expect(JSON.parse(String(request.body))).toMatchObject({
      reasoning_effort: "low",
      max_tokens: 4096,
    });
    expect(timeout).toHaveBeenCalledWith(120_000);
  });
  it("does not change shared Health requests or invent parameters for an unknown model", async () => {
    const fetch = vi.fn(async () => result());
    vi.stubGlobal("fetch", fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await callAiProvider(metrics, evidence, period, settings, false);
    await callAiProvider(
      metrics,
      evidence,
      period,
      { ...settings, model: "unknown-model" },
      true,
    );
    for (const [, request] of fetch.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(JSON.parse(String(request.body))).not.toHaveProperty(
        "reasoning_effort",
      );
    }
    expect(timeout.mock.calls.map((call) => call[0])).toEqual([
      60_000, 120_000,
    ]);
  });
  it("rejects truncated output even if its JSON happens to be valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => result("length")),
    );
    await expect(
      callAiProvider(metrics, evidence, period, settings, true),
    ).rejects.toMatchObject({ code: "truncated", retryable: true });
  });
  it.each([
    [401, false],
    [403, false],
    [400, false],
    [429, true],
    [503, true],
  ])(
    "classifies HTTP %s without exposing provider response",
    async (status, retryable) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("must-not-leak-response", { status })),
      );
      try {
        await callAiProvider(metrics, evidence, period, settings, true);
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(SleepProviderError);
        expect(error).toMatchObject({ retryable });
        expect(String(error)).not.toContain("must-not-leak");
      }
    },
  );
  it("normalizes abort timeout and never supplies a fallback score", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("synthetic timeout", "TimeoutError");
      }),
    );
    await expect(
      callAiProvider(metrics, evidence, period, settings, true),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });
  it("caps sleep at three attempts without changing generic jobs", () => {
    expect(reportRetryPolicy(SLEEP_REPORT_TEMPLATE, 1)).toEqual({
      maximumAttempts: 3,
      delayMs: 15_000,
    });
    expect(reportRetryPolicy(SLEEP_REPORT_TEMPLATE, 2)).toEqual({
      maximumAttempts: 3,
      delayMs: 30_000,
    });
    expect(reportRetryPolicy("wellness-report-v2", 2)).toEqual({
      maximumAttempts: 10,
      delayMs: 120_000,
    });
  });
});

describe("sleep-only fixed-category content diagnostics", () => {
  const sentinel = "SYNTHETIC_SECRET_MUST_NOT_LEAK";
  it.each([
    {
      category: "response_json",
      response: () => new Response(sentinel),
    },
    {
      category: "empty_message",
      response: () => new Response(JSON.stringify({ choices: [] })),
    },
    {
      category: "content_json",
      response: () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: sentinel } }],
          }),
        ),
    },
    {
      category: "unavailable_metric",
      response: () =>
        result("stop", {
          ...content,
          trends: [{ metric: sentinel, text: sentinel }],
        }),
    },
    {
      category: "missing_evidence",
      response: () => result(),
      evidence: { byMetric: [] },
    },
    {
      category: "content_shape",
      response: () => result("stop", { ...content, overview: "" }),
    },
    {
      category: "sleep_score_shape",
      response: () =>
        result("stop", {
          ...content,
          sleepScore: { ...content.sleepScore, value: 101 },
        }),
    },
    {
      category: "wellness_policy",
      response: () =>
        result("stop", { ...content, overview: `确诊 ${sentinel}` }),
    },
    {
      category: "wellness_policy",
      response: () =>
        result("stop", {
          ...content,
          sleepScore: {
            ...content.sleepScore,
            explanation: `医疗级 ${sentinel}`,
          },
        }),
    },
    {
      category: "provider_response",
      response: () => {
        throw new Error(sentinel);
      },
    },
  ])("logs only the fixed $category category", async (fixture) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fixture.response()),
    );
    await expect(
      callAiProvider(
        metrics,
        fixture.evidence ?? evidence,
        period,
        settings,
        true,
      ),
    ).rejects.toMatchObject({
      code: "invalid_content",
      message: "sleep_ai:invalid_content",
    });
    expect(warn.mock.calls).toEqual([
      ["sleep_ai_content_rejected", fixture.category],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(sentinel);
  });

  it("does not log accepted sleep content or shared Health validation failures", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => result()),
    );
    await callAiProvider(metrics, evidence, period, settings, true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => result("stop", { ...content, overview: "" })),
    );
    await expect(
      callAiProvider(metrics, evidence, period, settings, false),
    ).rejects.toThrow("AI report content is incomplete");
    expect(warn).not.toHaveBeenCalled();
  });

  it("uses a fixed fallback for unknown validation errors without their message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => result()),
    );
    await expect(
      callAiProvider(
        metrics,
        {
          get byMetric() {
            throw new Error(sentinel);
          },
        },
        period,
        settings,
        true,
      ),
    ).rejects.toMatchObject({ code: "invalid_content" });
    expect(warn.mock.calls).toEqual([
      ["sleep_ai_content_rejected", "validation_unknown"],
    ]);
  });

  it.each(["truncated", "timeout", "network", "provider_busy"])(
    "keeps %s out of content rejection diagnostics",
    async (code) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (code === "timeout")
            throw new DOMException(sentinel, "TimeoutError");
          if (code === "network") throw new TypeError(sentinel);
          return code === "truncated"
            ? result("length")
            : new Response(sentinel, { status: 503 });
        }),
      );
      await expect(
        callAiProvider(metrics, evidence, period, settings, true),
      ).rejects.toMatchObject({ code });
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
