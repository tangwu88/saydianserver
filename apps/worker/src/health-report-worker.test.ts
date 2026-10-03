import { describe, expect, it } from "vitest";
import { validateReportContent, validateSleepReportContent } from "./health-report-worker";

describe("sleep AI reference score", () => {
  const metrics = [{ metric: "sleep", totalSeconds: 25200 }];
  const evidence = { byMetric: [{ metric: "sleep", recordIds: ["synthetic-snapshot"] }] };
  const report = () => ({ overview: "仅分析本次睡眠记录。", trends: [{ metric: "sleep", text: "本次睡眠总时长可用于日常观察。" }], suggestions: ["保持规律作息。"], limitations: ["单日记录及设备阶段估计可能存在误差。"], sleepScore: { value: 70, scale: 100, confidence: "low", explanation: "仅根据已提供的睡眠时长和阶段作参考评价，非临床量表。" } });
  it("keeps AI score distinct and evidence-linked", () => expect(validateSleepReportContent(report(), metrics, evidence)).toMatchObject({ aiLabel: "AI生成的睡眠管理参考", sleepScore: { value: 70, scale: 100 }, trends: [{ metric: "sleep", evidenceRecordIds: ["synthetic-snapshot"] }] }));
  it("retains null rather than inventing a score for insufficient evidence", () => { const value = report(); value.sleepScore.value = null as any; expect(validateSleepReportContent(value, metrics, evidence)).toHaveProperty("sleepScore.value", null); });
  it.each([101, -1, 42.5, "90", undefined])("rejects invalid score %s", score => { const value = report(); value.sleepScore.value = score as any; expect(() => validateSleepReportContent(value, metrics, evidence)).toThrow(); });
  it("rejects a fabricated metric and medical claims in score rationale", () => { const value = report(); value.sleepScore.explanation = "已确诊疾病。"; expect(() => validateSleepReportContent(value, metrics, evidence)).toThrow(); value.sleepScore.explanation = "参考数据。"; value.trends[0]!.metric = "blood_glucose"; expect(() => validateSleepReportContent(value, metrics, evidence)).toThrow(); });
});

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
