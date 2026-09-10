import { describe, expect, it } from "vitest";
import { healthMetrics } from "@saydian/app-contracts";
import { healthMetricLabel, healthRawJson, healthReadings, healthScalar, healthSource, healthTime } from "./health-display";

describe("health data presentation", () => {
  it("covers all contract metrics and uppercase database metrics with Chinese names", () => {
    for (const metric of healthMetrics) {
      expect(healthMetricLabel(metric)).not.toBe("其他健康记录");
      expect(healthMetricLabel(metric.toUpperCase())).toBe(healthMetricLabel(metric));
    }
    expect(healthMetricLabel("unknown_metric")).toBe("其他健康记录");
  });

  it("separates systolic and diastolic values using the recorded unit", () => {
    expect(healthReadings({ metric: "BLOOD_PRESSURE", values: { diastolic: 80, systolic: 120 }, unit: "mmHg" })).toEqual([
      { label: "收缩压（高压）", text: "120 mmHg" }, { label: "舒张压（低压）", text: "80 mmHg" },
    ]);
    expect(healthReadings({ metric: "blood_pressure", values: { systolic: 120, diastolic: null } })).toEqual([
      { label: "收缩压（高压）", text: "120（单位未提供）" }, { label: "舒张压（低压）", text: "未提供" },
    ]);
  });

  it("preserves zero and false, while null, missing, empty and nonfinite data stay unknown", () => {
    expect(healthScalar(0)).toBe("0"); expect(healthScalar(false)).toBe("否");
    for (const missing of [undefined, null, "", "  ", Number.NaN, Number.POSITIVE_INFINITY]) expect(healthScalar(missing)).toBe("未提供");
    expect(healthReadings({ metric: "steps", values: { steps: 0 } })).toEqual([{ label: "步数", text: "0 步" }]);
    expect(healthReadings({ metric: "heart_rate", values: { value: null }, unit: "bpm" })).toEqual([{ label: "心率", text: "未提供" }]);
  });

  it("does not invent units or convert string values", () => {
    expect(healthReadings({ metric: "heart_rate", values: { value: "075" } })).toEqual([{ label: "心率", text: "075（单位未提供）" }]);
    expect(healthReadings({ metric: "blood_glucose", values: { value: 95 }, unit: "mg/dL" })).toEqual([{ label: "血糖", text: "95 mg/dL" }]);
    expect(healthReadings({ metric: "blood_glucose", values: { mmolL: 5.2 } })).toEqual([{ label: "血糖", text: "5.2 mmol/L" }]);
  });

  it("rejects nonfinite or malformed numeric strings without altering legitimate recorded strings", () => {
    for (const value of ["NaN", "Infinity", "-Infinity", "1e999", "0x20", "75 bpm", "not-a-number"]) {
      const row = { metric: "heart_rate", values: { bpm: value } };
      expect(healthReadings(row)).toEqual([{ label: "心率", text: "非有效数值（原值见详情）" }]);
      expect(JSON.parse(healthRawJson(row)).values.bpm).toBe(value);
    }
    for (const value of ["075", "0", "-0.0", "+7.5", "7.50e1", " 75 "]) {
      expect(healthReadings({ metric: "heart_rate", values: { bpm: value } })).toEqual([{ label: "心率", text: `${value} bpm` }]);
    }
  });

  it("keeps sleep counts distinct from time units and preserves body composition unknowns", () => {
    expect(healthReadings({ metric: "sleep", unit: "minute", values: { minutes: 360, deepMinutes: 90, wakeCount: 2 } })).toEqual([
      { label: "睡眠时长", text: "360 分钟" }, { label: "深睡时长", text: "90 分钟" }, { label: "醒来次数", text: "2 次" },
    ]);
    expect(healthReadings({ metric: "body_composition", values: { weightKg: 60.2, bmi: 22, fatMass: 12 } })).toEqual([
      { label: "体重", text: "60.2 kg" }, { label: "身体质量指数（BMI）", text: "22 无量纲" }, { label: "脂肪量", text: "12（单位未提供）" },
    ]);
  });

  it("labels blood composition without guessing undocumented measurement units", () => {
    expect(healthReadings({ metric: "blood_composition", values: { uricAcid: 310, totalCholesterol: 4.5 } })).toEqual([
      { label: "尿酸", text: "310（单位未提供）" }, { label: "总胆固醇", text: "4.5（单位未提供）" },
    ]);
  });

  it("does not assign labels from other metrics to unfamiliar fields", () => {
    expect(healthReadings({ metric: "body_composition", values: { percent: 23 } })).toEqual([{ label: "测量值", text: "已保留原始数据，请展开查看" }]);
    expect(healthReadings({ metric: "hrv", values: {} })).toEqual([{ label: "测量值", text: "未提供" }]);
  });

  it("does not infer a heart rhythm from ECG scores or assume an unreturned waveform exists", () => {
    const row = { metric: "ECG", values: { score: 99, heartRate: 70 } };
    expect(healthReadings(row)).toEqual([{ label: "心电资料", text: "波形可用情况未提供" }]);
    expect(healthReadings({ ...row, hasEcgArtifact: false })).toEqual([{ label: "心电资料", text: "未附带波形资料" }]);
    expect(healthReadings({ ...row, ecgArtifact: { sampleRateHz: 250, sampleCount: 1000 } })).toEqual([{ label: "心电资料", text: "已提供波形资料" }]);
    expect(healthRawJson(row)).toContain('"score": 99');
    expect(healthReadings(row)[0]?.text).not.toMatch(/心律|正常|异常|诊断/);
  });

  it("formats record times with explicit positive, negative and fractional timezone offsets", () => {
    expect(healthTime("2026-09-10T00:10:00Z", 480)).toBe("2026-09-10 08:10:00 UTC+08:00");
    expect(healthTime("2026-09-10T00:10:00Z", -330)).toBe("2026-09-09 18:40:00 UTC-05:30");
    expect(healthTime("2026-09-10T08:10:00+08:00", 0)).toBe("2026-09-10 00:10:00 UTC+00:00");
  });

  it("does not guess missing or invalid times and marks a missing source timezone", () => {
    expect(healthTime(null, 0)).toBe("未提供");
    expect(healthTime("2026-09-10T08:00:00", 480)).toContain("时间格式未识别");
    expect(healthTime("not-a-time", 0)).toContain("时间格式未识别");
    expect(healthTime("2026-09-10T00:10:00Z", null)).toBe("2026-09-10 00:10:00 UTC+00:00（原始时区未提供）");
    expect(healthTime("2026-09-10T00:10:00Z", 99999)).toContain("原始时区未提供");
  });

  it("rejects impossible calendar dates and timezone-shift overflow instead of normalizing or throwing", () => {
    for (const time of ["2026-02-30T00:00:00Z", "2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-09-10T24:00:00Z", "2026-00-10T00:00:00Z"]) {
      expect(healthTime(time, 0)).toBe("时间格式未识别（原值见详情）");
    }
    expect(healthTime("2024-02-29T12:30:40.123Z", 0)).toBe("2024-02-29 12:30:40 UTC+00:00");
    expect(healthTime("+275760-09-13T00:00:00Z", 840)).toBe("时间格式未识别（原值见详情）");
    expect(healthTime("-271821-04-20T00:00:00Z", -840)).toBe("时间格式未识别（原值见详情）");
    expect(healthTime("+275760-09-13T00:00:00Z", 0)).toBe("+275760-09-13 00:00:00 UTC+00:00");
  });

  it("reads both stored columns and source contracts without fabricating source metadata", () => {
    expect(healthSource({ sourcePlatform: "android", sourceOrigin: "watch_history", sourceMeasurementSource: "wearable", sourceModel: "W9" })).toBe("手表历史记录 · 可穿戴设备 · 安卓 · W9");
    expect(healthSource({ source: { platform: "ios", origin: "manual_entry", measurementSource: "manual" } })).toBe("手动录入 · iOS");
    expect(healthSource({})).toBe("未提供");
    expect(healthSource({ sourcePlatform: "unrecognized" })).toBe("来源待识别（见原始数据）");
  });

  it("keeps every original identifier, value and metadata field unchanged for the collapsed detail", () => {
    const row = { id: "record-uuid", userId: "member-uuid", clientRecordId: "client-id", metric: "SLEEP", values: { minutes: 0, extraFlag: false, unknown: null }, quality: "UNKNOWN", source: { rawVersion: 2 } };
    expect(JSON.parse(healthRawJson(row))).toEqual(row);
    healthReadings(row); healthSource(row);
    expect(JSON.parse(healthRawJson(row))).toEqual(row);
  });
});
