import { describe, expect, it } from "vitest";
import { buildHealthEvidence } from "./health-evidence";

describe("health report evidence", () => {
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
});
