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
const result = (finish = "stop") =>
  new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: finish,
          message: { content: JSON.stringify(content) },
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
