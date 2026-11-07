import { describe, it, expect } from "vitest";
import { ScreenAccumulator, screenPeriod } from "@saydian/health-domain";
import {
  analysisProviderFacts,
  validateAnalysisContent,
} from "./member-health-analysis-worker";
const now = new Date("2026-11-07T01:00:00Z"),
  a = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
a.add({
  id: "private-record-id",
  metric: "HEART_RATE",
  observedAt: now,
  createdAt: now,
  updatedAt: now,
  values: { bpm: 72, phone: "private-phone" },
  unit: "bpm",
  quality: "UNKNOWN",
  sourceOrigin: "watch_history",
  sourceModel: "private-person-name",
  sourceMetadata: { timeBasis: "sdk", name: "private-name" },
  aggregationKind: null,
  aggregationActive: false,
  aggregationLocalDate: null,
});
const facts = a.finish(null, null, { age: 40, gender: "MALE" });
const content = {
  summary: [{ text: "心率记录来源需要核对", evidence: ["heart_rate"] }],
  insights: [
    {
      key: "heart_rate",
      text: "当前记录不足以判断健康状态",
      evidence: ["heart_rate"],
    },
  ],
  suggestions: [{ text: "请继续按设备说明记录", evidence: ["heart_rate"] }],
  limitations: ["AI生成的健康管理参考，非临床诊断"],
};
describe("member health analysis provider boundary", () => {
  it("sends aggregate-only facts without record IDs, device names or arbitrary metadata", () => {
    const payload = JSON.stringify(analysisProviderFacts(facts));
    expect(payload).not.toContain("private-");
    expect(payload).not.toContain("dataDigest");
    expect(payload).toContain("eligibleCount");
    expect(payload).not.toContain('"value":72');
    expect(payload).toContain('"average":null');
  });
  it("sends declared manual reference statistics separately from unverified device data, never treats them as score inputs", () => {
    const ref = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
    ref.add({
      id: "private-reference",
      metric: "BLOOD_GLUCOSE",
      observedAt: now,
      createdAt: now,
      updatedAt: now,
      values: { value: 5.8 },
      unit: "mmol/L",
      quality: "VALID",
      sourceOrigin: "manual_entry",
      sourceModel: "private-source-name",
      sourceMetadata: {},
      aggregationKind: null,
      aggregationActive: true,
      aggregationLocalDate: null,
      reference: { method: "GLUCOSE_METER", context: "FASTING" },
    });
    const input = analysisProviderFacts(
      ref.finish(null, null, { age: null, gender: "UNKNOWN" }),
    );
    expect(input.metrics[0]).toMatchObject({
      kind: "reference",
      average: 5.8,
      eligibleCount: 1,
      scoreEligibleCount: 0,
    });
    expect(JSON.stringify(input)).not.toContain("private-");
    expect(input.eligibleRecordCount).toBe(0);
  });
  it("accepts typed evidence-linked content", () =>
    expect(validateAnalysisContent(content, facts)).toEqual(content));
  it("keeps uric acid and individual lipid statistics separate without filling absent panel values", () => {
    const aggregate = new ScreenAccumulator(
      screenPeriod(30, "Asia/Shanghai", now),
    );
    for (const measure of [
      { metric: "URIC_ACID", unit: "μmol/L", values: { value: 360 } },
      {
        metric: "BLOOD_LIPIDS",
        unit: "mmol/L",
        values: { totalCholesterol: 4.5, ldl: 2.5 },
      },
    ])
      aggregate.add({
        ...measure,
        id: `private-lab-reference-${measure.metric}`,
        observedAt: now,
        createdAt: now,
        updatedAt: now,
        quality: "VALID",
        sourceOrigin: "manual_entry",
        sourceModel: "private-laboratory",
        sourceMetadata: {},
        aggregationKind: null,
        aggregationActive: true,
        aggregationLocalDate: null,
        reference: { method: "LAB_REPORT", context: "FASTING" },
      });
    const input = analysisProviderFacts(
      aggregate.finish(null, null, { age: null, gender: "UNKNOWN" }),
    );
    expect(input.metrics).toHaveLength(3);
    expect(
      input.metrics
        .map((m) => [m.label.split(" · ")[0], m.unit, m.average])
        .sort(),
    ).toEqual(
      [
        ["低密度脂蛋白胆固醇 LDL-C", "mmol/L", 2.5],
        ["总胆固醇 TC", "mmol/L", 4.5],
        ["尿酸", "μmol/L", 360],
      ].sort(),
    );
    expect(
      input.metrics.every(
        (m) => m.kind === "reference" && m.scoreEligibleCount === 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(input)).not.toContain("private-");
    expect(input.eligibleRecordCount).toBe(0);
  });
  it("rejects invented evidence and AI score fields", () => {
    expect(() =>
      validateAnalysisContent({ ...content, score: 90 }, facts),
    ).toThrow();
    expect(() =>
      validateAnalysisContent(
        {
          ...content,
          summary: [{ text: "测试", evidence: ["blood_glucose"] }],
        },
        facts,
      ),
    ).toThrow();
  });
  it("rejects invented scores embedded in prose", () => {
    expect(() =>
      validateAnalysisContent(
        {
          ...content,
          summary: [{ text: "本次参考为85分", evidence: ["heart_rate"] }],
        },
        facts,
      ),
    ).toThrow();
  });
  it("rejects markup and treatment claims", () => {
    expect(() =>
      validateAnalysisContent({ ...content, limitations: ["<script>"] }, facts),
    ).toThrow();
    expect(() =>
      validateAnalysisContent(
        {
          ...content,
          summary: [{ text: "可以确诊疾病", evidence: ["heart_rate"] }],
        },
        facts,
      ),
    ).toThrow();
  });
});
