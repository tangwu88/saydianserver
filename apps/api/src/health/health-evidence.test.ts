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
});
