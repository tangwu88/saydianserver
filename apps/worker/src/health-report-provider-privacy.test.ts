import { afterEach, describe, expect, it, vi } from "vitest";
import { callAiProvider } from "./health-report-worker";

afterEach(() => vi.unstubAllGlobals());

describe("health report provider data minimization", () => {
  it("keeps custom device identity and presence data out of an actual Qwen-shaped request", async () => {
    const answer = {
      overview: "本次记录仅供日常健康管理参考。",
      trends: [
        { metric: "heart_rate", text: "已提供的心率记录可用于观察个人趋势。" },
      ],
      suggestions: ["保持规律作息。"],
      limitations: ["仅依据本次实际获取的记录。"],
    };
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(answer) } }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const memberContext = {
      demographics: { ageYears: 40, gender: "female" },
      devices: [
        {
          vendor: "synthetic-vendor",
          model: "synthetic-model",
          displayName: "synthetic-private-member-name",
          lastSeenAt: "2026-10-18T01:23:45Z",
          macAddress: "synthetic-private-hardware-id",
        },
      ],
    };
    const result = await callAiProvider(
      [{ metric: "heart_rate", measurements: [{ key: "bpm", average: 72 }] }],
      {
        memberContext,
        byMetric: [
          { metric: "heart_rate", recordIds: ["synthetic-internal-record"] },
        ],
      },
      {
        from: "2026-09-18T00:00:00Z",
        to: "2026-10-18T00:00:00Z",
        distinctDays: 3,
        validRecordCount: 3,
      },
      {
        baseUrl: "https://maas.qianwenaiapi.com/compatible-mode/v1",
        model: "qwen3.8-flash",
        apiKey: "synthetic-test-key",
      },
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://maas.qianwenaiapi.com/compatible-mode/v1/chat/completions",
    );
    const body = String(init.body);
    for (const excluded of [
      "synthetic-private-member-name",
      "2026-10-18T01:23:45Z",
      "synthetic-private-hardware-id",
      "synthetic-internal-record",
    ])
      expect(body).not.toContain(excluded);
    const prompt = JSON.parse(JSON.parse(body).messages[1].content);
    expect(prompt.memberContext).toEqual({
      demographics: memberContext.demographics,
      devices: [{ vendor: "synthetic-vendor", model: "synthetic-model" }],
    });
    expect(memberContext.devices[0]?.displayName).toBe(
      "synthetic-private-member-name",
    );
    expect(result.trends).toEqual([
      {
        metric: "heart_rate",
        text: answer.trends[0]?.text,
        evidenceRecordIds: ["synthetic-internal-record"],
      },
    ]);
  });
});
