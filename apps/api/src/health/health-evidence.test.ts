import { describe, expect, it } from "vitest";
import { buildHealthEvidence } from "./health-evidence";

describe("health report evidence", () => {
  it("normalizes mixed App distance units before ranges, summaries and daily trends", () => {
    const records = [
      { id: "km", values: { value: 1.5 }, unit: "km" },
      { id: "m", values: { value: 1_500 }, unit: "m" },
      { id: "mi", values: { value: 1 }, unit: "mi" },
      { id: "canonical", values: { meters: 1_500 } },
      { id: "missing-unit", values: { value: 1.5 } },
      { id: "unsupported-unit", values: { value: 1.5 }, unit: "unknown" },
      { id: "out-of-range", values: { value: 301 }, unit: "km" },
    ].map((record, index) => ({
      ...record, metric: "DISTANCE", observedAt: new Date(`2026-09-0${index + 1}T00:00:00Z`),
      timezoneOffsetMinutes: 0, quality: "VALID",
    }));
    const original = structuredClone(records);
    const evidence = buildHealthEvidence(records);
    expect(evidence.validRecordIds).toEqual(["km", "m", "mi", "canonical"]);
    expect(evidence.invalidRecordIds).toEqual(["missing-unit", "unsupported-unit", "out-of-range"]);
    expect(evidence.metrics[0]).toMatchObject({
      metric: "distance", recordCount: 4, distinctDays: 4,
      latestValue: 1_500, minimum: 1_500, maximum: 1_609.34, average: 1_527.34,
      measurements: [{ key: "meters", unit: "m", sampleCount: 4, latest: 1_500,
        minimum: 1_500, maximum: 1_609.34, average: 1_527.34,
        dailyAverages: [
          { date: "2026-09-01", value: 1_500, sampleCount: 1 },
          { date: "2026-09-02", value: 1_500, sampleCount: 1 },
          { date: "2026-09-03", value: 1_609.34, sampleCount: 1 },
          { date: "2026-09-04", value: 1_500, sampleCount: 1 },
        ],
      }],
    });
    expect(records).toEqual(original);
  });

  it("excludes zero placeholders and invalid rows", () => {
    const evidence = buildHealthEvidence([
      {
        id: "zero",
        metric: "HEART_RATE",
        observedAt: new Date("2026-09-01T00:00:00Z"),
        timezoneOffsetMinutes: 480,
        values: { bpm: 0 },
        quality: "UNKNOWN",
      },
      {
        id: "invalid",
        metric: "HEART_RATE",
        observedAt: new Date("2026-09-02T00:00:00Z"),
        timezoneOffsetMinutes: 480,
        values: { bpm: 72 },
        quality: "INVALID",
      },
      {
        id: "valid",
        metric: "HEART_RATE",
        observedAt: new Date("2026-09-03T00:00:00Z"),
        timezoneOffsetMinutes: 480,
        values: { bpm: 72 },
        quality: "VALID",
        sourceModel: "W8",
      },
    ]);
    expect(evidence.validRecordIds).toEqual(["valid"]);
    expect(evidence.invalidRecordIds).toEqual(["zero", "invalid"]);
    expect(evidence.metrics[0]).toMatchObject({
      metric: "heart_rate",
      recordIds: ["valid"],
      average: 72,
      sourceModels: ["W8"],
    });
  });

  it("counts distinct local days and accepts ECG only by verified artifact", () => {
    const evidence = buildHealthEvidence([
      {
        id: "ecg-1",
        metric: "ECG",
        observedAt: new Date("2026-09-01T16:30:00Z"),
        timezoneOffsetMinutes: 480,
        values: {},
        quality: "VALID",
        hasEcgArtifact: true,
      },
      {
        id: "hr-1",
        metric: "HEART_RATE",
        observedAt: new Date("2026-09-02T16:01:00Z"),
        timezoneOffsetMinutes: 480,
        values: { bpm: 70 },
        quality: "VALID",
      },
    ]);
    expect(evidence.distinctDays).toBe(2);
    expect(evidence.validRecordIds).toHaveLength(2);
  });

  it("keeps separate allow-listed measurements and daily trends without copying arbitrary fields", () => {
    const evidence = buildHealthEvidence([
      { id: "bp-1", metric: "BLOOD_PRESSURE", observedAt: new Date("2026-09-01T01:00:00Z"), timezoneOffsetMinutes: 480, values: { systolic: 120, diastolic: 78, privateNote: "must-not-copy" }, quality: "VALID" },
      { id: "bp-2", metric: "BLOOD_PRESSURE", observedAt: new Date("2026-09-02T01:00:00Z"), timezoneOffsetMinutes: 480, values: { systolic: 130, diastolic: 82 }, quality: "VALID" },
    ]);
    expect(evidence.metrics[0]).toMatchObject({ metric: "blood_pressure", distinctDays: 2, measurements: [
      { key: "systolic", unit: "mmHg", sampleCount: 2, latest: 130, minimum: 120, maximum: 130, average: 125 },
      { key: "diastolic", unit: "mmHg", sampleCount: 2, latest: 82, minimum: 78, maximum: 82, average: 80 },
    ] });
    expect(JSON.stringify(evidence.metrics)).not.toContain("privateNote");
  });

  it("uses a daily summary localDate instead of its later upload timestamp", () => {
    const evidence = buildHealthEvidence([
      {
        id: "daily-steps",
        metric: "STEPS",
        observedAt: new Date("2026-09-29T10:00:00Z"),
        timezoneOffsetMinutes: 480,
        aggregationLocalDate: "2026-09-27",
        values: { value: 8_000 },
        quality: "VALID",
      },
    ]);
    expect(evidence.distinctDays).toBe(1);
    expect(evidence.metrics[0]?.measurements[0]?.dailyAverages).toEqual([
      { date: "2026-09-27", value: 8_000, sampleCount: 1 },
    ]);
  });
});
