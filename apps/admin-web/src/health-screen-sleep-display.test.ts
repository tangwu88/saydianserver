import { describe, expect, it } from "vitest";
import type {
  HealthScreenRecord,
  HealthScreenSeries,
} from "@saydian/app-contracts";
import {
  formatScreenValue,
  sleepRecordInHours,
  sleepSeriesInHours,
  sleepValueInHours,
} from "../../../packages/health-screen-ui/src/sleep-display";
import { groupTrends } from "../../../packages/health-screen-ui/src/trend-groups";

function sleepSeries(): HealthScreenSeries {
  return {
    key: "sleep_minutes",
    metric: "SLEEP",
    label: "每晚睡眠时长",
    group: "sleep",
    unit: "分钟",
    semantics: "night",
    count: 3,
    eligibleCount: 2,
    coverageDays: 2,
    eligibleDays: 1,
    latest: 420,
    latestAt: "2026-11-07T01:00:00Z",
    average: 405.81,
    eligibleAverage: 390,
    sources: ["合成测试设备"],
    exclusions: { quality_unknown: 1 },
    points: [
      {
        date: "2026-11-06",
        value: 390,
        eligibleValue: null,
        count: 1,
        eligibleCount: 0,
      },
      {
        date: "2026-11-07",
        value: 420,
        eligibleValue: 420,
        count: 2,
        eligibleCount: 2,
      },
      {
        date: "2026-11-08",
        value: null,
        eligibleValue: null,
        count: 0,
        eligibleCount: 0,
      },
    ],
  };
}

describe("sleep durations on the member health screen", () => {
  it("converts summaries and every curve value while preserving the source and scoring evidence", () => {
    const input = sleepSeries(),
      original = structuredClone(input);
    const display = sleepSeriesInHours(input);
    expect(display.unit).toBe("小时");
    expect(display.average).toBeCloseTo(6.7635);
    expect(display.latest).toBe(7);
    expect(display.eligibleAverage).toBe(6.5);
    expect(display.points.map((p) => p.value)).toEqual([6.5, 7, null]);
    expect(display.points.map((p) => p.eligibleValue)).toEqual([null, 7, null]);
    expect(
      display.points.map((p) => [p.date, p.count, p.eligibleCount]),
    ).toEqual(input.points.map((p) => [p.date, p.count, p.eligibleCount]));
    expect(display).toMatchObject({
      key: original.key,
      semantics: original.semantics,
      exclusions: original.exclusions,
      count: original.count,
      eligibleCount: original.eligibleCount,
    });
    expect(input).toEqual(original);
    expect(sleepValueInHours(input.metric, input.unit, 390)).toEqual({
      value: 6.5,
      unit: "小时",
    });
  });

  it("keeps zero and missing values distinct, avoids a second conversion and formats tooltips in hours", () => {
    const input = {
      ...sleepSeries(),
      latest: 0,
      average: null,
      eligibleAverage: null,
    };
    const once = sleepSeriesInHours(input);
    expect(sleepSeriesInHours(once)).toEqual(once);
    expect(once).toMatchObject({
      latest: 0,
      average: null,
      eligibleAverage: null,
    });
    expect(formatScreenValue(sleepSeriesInHours(sleepSeries()).average)).toBe(
      "6.76",
    );
    expect(formatScreenValue(0)).toBe("0");
    expect(formatScreenValue(null)).toBe("—");
    expect(formatScreenValue(420 / 60)).toBe("7");
  });

  it("converts paginated record durations and leaves counts, percentages, provenance and quality unchanged", () => {
    const record: HealthScreenRecord = {
      id: "synthetic-sleep-record",
      metric: "SLEEP",
      measuredAt: "2026-11-07T01:00:00Z",
      uploadedAt: "2026-11-07T02:00:00Z",
      quality: "UNKNOWN",
      source: "watch_history",
      sourceModel: "合成测试设备",
      unavailableReason: null,
      values: [
        {
          key: "sleep_samples",
          label: "睡眠片段时长",
          value: 405.81,
          unit: "分钟",
          reason: "定义待核实",
        },
        {
          key: "deep_sleep",
          label: "深睡时长",
          value: 90,
          unit: "min",
          reason: null,
        },
        {
          key: "wake_count",
          label: "醒来次数",
          value: 2,
          unit: "次",
          reason: null,
        },
        {
          key: "efficiency",
          label: "睡眠效率",
          value: 85,
          unit: "%",
          reason: null,
        },
      ],
    };
    const original = structuredClone(record),
      display = sleepRecordInHours(record);
    expect(display.values[0]!.value).toBeCloseTo(6.7635);
    expect(display.values[0]).toMatchObject({
      unit: "小时",
      reason: "定义待核实",
    });
    expect(display.values[1]).toMatchObject({ value: 1.5, unit: "小时" });
    expect(display.values.slice(2)).toEqual(record.values.slice(2));
    expect({ ...display, values: [] }).toEqual({ ...record, values: [] });
    expect(sleepRecordInHours(display)).toEqual(display);
    expect(record).toEqual(original);
  });

  it("accepts explicit time units without guessing unknown units or converting other measurements", () => {
    expect(sleepValueInHours("SLEEP", "hours", 7)).toEqual({
      value: 7,
      unit: "小时",
    });
    expect(sleepValueInHours("SLEEP", "seconds", 25200)).toEqual({
      value: 7,
      unit: "小时",
    });
    expect(sleepValueInHours("SLEEP", "单位待核实", 420)).toEqual({
      value: 420,
      unit: "单位待核实",
    });
    expect(sleepValueInHours("ACTIVITY", "分钟", 30)).toEqual({
      value: 30,
      unit: "分钟",
    });
    expect(
      sleepSeriesInHours({ ...sleepSeries(), metric: "HRV", unit: "ms" }),
    ).toMatchObject({ average: 405.81, unit: "ms" });
  });

  it("uses hours consistently in comparison charts while retaining nightly versus fragment definitions", () => {
    const nightly = sleepSeries();
    const groups = groupTrends(
      [nightly, { ...nightly, key: "sleep_samples", semantics: "sample" }].map(
        sleepSeriesInHours,
      ),
    );
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.unit)).toEqual(["小时", "小时"]);
    expect(groups.map((g) => g.series[0]!.semantics)).toEqual([
      "night",
      "sample",
    ]);
    expect(
      groups.every((g) => Math.abs(g.series[0]!.average! - 6.7635) < 1e-10),
    ).toBe(true);
  });
});
