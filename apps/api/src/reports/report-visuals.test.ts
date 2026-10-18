import { describe, expect, it } from "vitest";
import { reportVisuals } from "./report-visuals";

describe("record-only report visuals", () => {
  it("keeps missing stages and wake counts unknown and never returns private sleep fields", () => {
    const result = reportVisuals({ templateVersion: "sleep-report-v1", metricSummary: [{ metric: "sleep", totalSeconds: 25_200, deepSeconds: 5_400, sessions: [], sourceKey: "private-hardware", memberId: "private-owner" }] });
    expect(result.sleep).toMatchObject({ totalSeconds: 25_200, wakeCount: null, sessionCount: null, unclassifiedSeconds: 19_800, stages: [{ seconds: 5_400 }, { seconds: null }, { seconds: null }] });
    expect(JSON.stringify(result)).not.toMatch(/private-hardware|private-owner|sourceKey|memberId/);
    expect(result).not.toHaveProperty("score");
  });
  it("does not invent a plausible stage graph for inconsistent totals", () => {
    const result = reportVisuals({ templateVersion: "sleep-report-v1", metricSummary: [{ metric: "sleep", totalSeconds: 100, deepSeconds: 120 }] });
    expect(result.sleep?.stages.every(stage => stage.seconds === null)).toBe(true);
    expect(result.sleep?.unclassifiedSeconds).toBe(100);
  });
  it("uses only the saved measurement snapshot, preserving sparse dates and excluding unverified old distance units", () => {
    const measurement = { key: "meters", unit: "m", average: 1500, latest: 1600, sampleCount: 2, dailyAverages: [{ date: "2026-10-01", value: 1400 }, { date: "2026-10-04", value: 1600 }, { date: "invalid", value: 0 }], privateNote: "not-for-display" };
    const source = { metricSummary: [{ metric: "distance", measurements: [measurement] }, { metric: "unrecognized", measurements: [measurement] }] };
    expect(reportVisuals(source).metrics).toEqual([]);
    const result = reportVisuals({ ...source, evidenceIndex: { dataQuality: { distanceUnitsNormalized: true } } });
    expect(result.metrics[0]).toMatchObject({ average: 1500, unit: "m", points: [{ date: "2026-10-01", value: 1400 }, { date: "2026-10-04", value: 1600 }] });
    expect(JSON.stringify(result)).not.toContain("privateNote");
    expect(result.metrics).toHaveLength(1);
  });
});
