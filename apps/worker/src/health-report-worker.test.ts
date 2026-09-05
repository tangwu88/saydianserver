import { describe, expect, it } from "vitest";
import { validateReportContent } from "./health-report-worker";

describe("health report AI output", () => {
  it("keeps a wellness-only structured report", () => {
    expect(
      validateReportContent({
        overview: "近30天心率记录较稳定。",
        trends: [{ metric: "heart_rate", text: "记录均值较前期变化不大。" }],
        suggestions: ["保持规律作息并继续观察个人趋势。"],
        limitations: ["仅基于已获取的手表记录。"],
      }, [{ metric: "heart_rate" }], {
        byMetric: [{ metric: "heart_rate", recordIds: ["record-1"] }],
      }),
    ).toMatchObject({
      aiLabel: "AI生成的健康管理参考",
      trends: [{ metric: "heart_rate", evidenceRecordIds: ["record-1"] }],
      safetyNotice: expect.stringContaining("不用于诊断或治疗"),
    });
  });

  it("rejects medical and accuracy claims", () => {
    expect(() =>
      validateReportContent({
        overview: "已确诊某疾病。",
        trends: [{ metric: "heart_rate", text: "有变化。" }],
        limitations: ["无"],
      }, [{ metric: "heart_rate" }], {
        byMetric: [{ metric: "heart_rate", recordIds: ["record-1"] }],
      }),
    ).toThrow(/wellness-only/);
  });

  it("rejects a trend for a metric that was not in the input evidence", () => {
    expect(() =>
      validateReportContent({
        overview: "本次只获取到心率记录。",
        trends: [{ metric: "blood_glucose", text: "血糖存在变化。" }],
        limitations: ["仅基于已获取记录。"],
      }, [{ metric: "heart_rate" }], {
        byMetric: [{ metric: "heart_rate", recordIds: ["record-1"] }],
      }),
    ).toThrow(/unavailable metric/);
  });
});
