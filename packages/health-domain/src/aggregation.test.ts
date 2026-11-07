import { describe, it, expect } from "vitest";
import {
  ScreenAccumulator,
  screenPeriod,
  recordValues,
  displayRecord,
  recordDay,
  type ScreenRecord,
} from "./aggregation";
import { draftRules, validateRules, healthScreenQwenEndpoint } from "./policy";
const now = new Date("2026-11-07T08:00:00Z");
function record(id: string, changes: Partial<ScreenRecord> = {}): ScreenRecord {
  return {
    id,
    metric: "HEART_RATE",
    observedAt: now,
    createdAt: now,
    updatedAt: now,
    values: { bpm: 72 },
    quality: "VALID",
    unit: "bpm",
    sourceOrigin: "watch_history",
    sourceModel: "QA synthetic",
    sourceMetadata: { timeBasis: "sdk" },
    aggregationKind: null,
    aggregationActive: false,
    aggregationLocalDate: null,
    ...changes,
  };
}
function finish(
  records: ScreenRecord[],
  days: 7 | 30 | 90 = 7,
  rules: ReturnType<typeof draftRules> | null = null,
) {
  const a = new ScreenAccumulator(screenPeriod(days, "Asia/Shanghai", now));
  records.forEach((r) => a.add(r));
  return a.finish(rules, rules ? 1 : null, { age: 40, gender: "MALE" });
}
describe("health screen data and score invariants", () => {
  it("counts calendar days through DST and falls back only for invalid timezone", () => {
    const p = screenPeriod(
      7,
      "America/New_York",
      new Date("2026-11-02T15:00:00Z"),
    );
    expect(p.dates).toHaveLength(7);
    expect(Date.parse(p.to) - Date.parse(p.from)).toBe(169 * 3600000);
    expect(screenPeriod(7, "not-a-zone", now).timezone).toBe("Asia/Shanghai");
  });
  it("retains all 90 days and more than 20000 records", () => {
    const rows = Array.from({ length: 20051 }, (_, i) =>
      record(String(i), {
        observedAt: new Date(now.valueOf() - (i % 90) * 86400000),
      }),
    );
    const f = finish(rows, 90);
    expect(f.recordCount).toBe(20051);
    expect(f.series[0]!.points).toHaveLength(90);
    expect(f.coverageDays).toBe(90);
  });
  it("does not coerce unknown quality or missing dates to zero", () => {
    const f = finish([record("a", { quality: "UNKNOWN" })]);
    expect(f.recordCount).toBe(1);
    expect(f.eligibleRecordCount).toBe(0);
    expect(f.series[0]!.points[0]!.value).toBeNull();
    expect(f.score.total).toBeNull();
    expect(f.score.reason).toBe("评分规则待发布");
  });
  it("does not double count a repeated row or inactive daily version", () => {
    const r = record("a");
    const f = finish([
      r,
      r,
      record("old", {
        aggregationKind: "daily_summary",
        aggregationActive: false,
        aggregationLocalDate: "2026-11-07",
      }),
    ]);
    expect(f.recordCount).toBe(1);
  });
  it("keeps HRV definitions and temperature kinds apart", () => {
    const f = finish([
      record("1", {
        metric: "HRV",
        unit: "ms",
        values: { ms: 40 },
        sourceMetadata: { algorithm: "sdnn", timeBasis: "sdk" },
      }),
      record("2", {
        metric: "HRV",
        unit: "ms",
        values: { ms: 65 },
        sourceMetadata: { algorithm: "rmssd", timeBasis: "sdk" },
      }),
      record("3", {
        metric: "TEMPERATURE",
        unit: "C",
        values: { celsius: 34 },
        sourceMetadata: { temperatureKind: "skin", timeBasis: "sdk" },
      }),
      record("4", {
        metric: "TEMPERATURE",
        unit: "C",
        values: { celsius: 36.4 },
        sourceMetadata: { temperatureKind: "estimated_body", timeBasis: "sdk" },
      }),
    ]);
    expect(f.series.map((s) => s.key)).toEqual([
      "hrv_rmssd",
      "hrv_sdnn",
      "temperature_estimated_body",
      "temperature_skin",
    ]);
  });
  it("never labels an unrecognized blood pressure unit as mmHg", () => {
    const v = recordValues(
      record("a", {
        metric: "BLOOD_PRESSURE",
        unit: "kPa",
        values: { systolic: 16, diastolic: 10 },
      }),
    );
    expect(v[0]!.unit).toBe("kPa");
    expect(v[0]!.key).not.toBe("systolic");
    expect(v.every((x) => x.reason === "unit_unknown")).toBe(true);
  });
  it("excludes wearable glucose even when client marks VALID", () => {
    expect(
      recordValues(
        record("a", {
          metric: "BLOOD_GLUCOSE",
          unit: "mmol/L",
          values: { mmolL: 5.6 },
        }),
      )[0]!.reason,
    ).toBe("glucose_unverified");
  });
  it("distinguishes cumulative totals from samples and never adds two devices daily totals", () => {
    const f = finish([
      record("a", { metric: "STEPS", unit: "steps", values: { steps: 100 } }),
      record("b", {
        metric: "STEPS",
        unit: "steps",
        values: { steps: 5000 },
        aggregationKind: "daily_summary",
        aggregationActive: true,
        aggregationLocalDate: "2026-11-07",
      }),
      record("c", {
        metric: "STEPS",
        unit: "steps",
        values: { steps: 5200 },
        aggregationKind: "daily_summary",
        aggregationActive: true,
        aggregationLocalDate: "2026-11-07",
        observedAt: new Date(now.valueOf() + 1000),
      }),
    ]);
    expect(f.series.find((s) => s.key === "steps")!.average).toBe(5200);
    expect(f.series.find((s) => s.key === "steps_samples")!.eligibleCount).toBe(
      0,
    );
  });
  it("assigns an overnight session to its wake date, not upload/start date", () => {
    const r = record("a", {
      metric: "SLEEP",
      unit: "min",
      observedAt: new Date("2026-11-06T14:00:00Z"),
      values: { durationMinutes: 420, endAt: "2026-11-06T22:00:00Z" },
      sourceMetadata: { sleepScope: "night", timeBasis: "sdk" },
    });
    expect(recordDay(r, screenPeriod(7, "Asia/Shanghai", now))).toBe(
      "2026-11-07",
    );
    expect(displayRecord(r).values[0]!.key).toBe("sleep_minutes");
  });
  it("has stable input digest when only polling time changes within a day", () => {
    const r = record("a"),
      a = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now)),
      b = new ScreenAccumulator(
        screenPeriod(7, "Asia/Shanghai", new Date(now.valueOf() + 5000)),
      );
    a.add(r);
    b.add(r);
    expect(a.finish(null, null, { age: 40, gender: "MALE" }).dataDigest).toBe(
      b.finish(null, null, { age: 40, gender: "MALE" }).dataDigest,
    );
  });
  it("drafts have no invented thresholds and cannot publish without reviewable rules", () => {
    expect(draftRules().items.every((i) => !i.bands.length)).toBe(true);
    expect(() => validateRules(draftRules(), true)).toThrow();
  });
  it("does not renormalize away a missing weighted component", () => {
    const rule = draftRules();
    rule.items = rule.items.slice(0, 2).map((i) => ({
      ...i,
      minDays: 1,
      minSamples: 1,
      bands: [{ min: null, max: null, score: 80 }],
      basis: "仅为合成数据算法验证，不可发布为临床规则",
      referenceUrl: "https://example.org/qa",
    }));
    expect(finish([record("a")], 7, rule).score.total).toBeNull();
    rule.items = rule.items.slice(0, 1);
    expect(finish([record("a")], 7, rule).score.total).toBe(80);
    expect(
      finish([record("a", { sourceOrigin: "manual_entry" })], 7, rule).score
        .total,
    ).toBeNull();
  });
  it("requires demographic fields only when the published rule needs them", () => {
    const rule = draftRules();
    rule.items = rule.items.slice(0, 1).map((i) => ({
      ...i,
      minDays: 1,
      minSamples: 1,
      bands: [{ min: null, max: null, score: 80 }],
    }));
    const a = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
    a.add(record("a"));
    const r = a.finish(rule, 1, { age: null, gender: "UNSPECIFIED" });
    expect(r.score.items[0]!.reason).toBe("缺少年龄资料");
  });
  it("rejects overlapping score intervals and non-HTTPS references", () => {
    const rule = draftRules();
    rule.items = rule.items.slice(0, 1).map((i) => ({
      ...i,
      basis: "合成规则的可追溯依据",
      referenceUrl: "javascript:alert(1)",
      bands: [
        { min: null, max: 100, score: 70 },
        { min: 80, max: null, score: 80 },
      ],
    }));
    expect(() => validateRules(rule, true)).toThrow();
    rule.items[0]!.referenceUrl = "https://example.org/qa";
    expect(() => validateRules(rule, true)).toThrow("不能重叠");
  });
});

it("keeps incompatible unknown units separate even when algorithm or scope is unknown", () => {
  for (const metric of [
    "HRV",
    "TEMPERATURE",
    "STEPS",
    "BLOOD_GLUCOSE",
    "SLEEP",
  ]) {
    const f = finish([
      record("one", { metric, unit: "unit-a", values: { value: 10 } }),
      record("two", { metric, unit: "unit-b", values: { value: 20 } }),
    ]);
    expect(f.series).toHaveLength(2);
    expect(f.series[0]!.key).not.toBe(f.series[1]!.key);
    expect(f.eligibleRecordCount).toBe(0);
  }
});
it("shows malformed/out-of-range observations with a reason but excludes them from charts and scoring", () => {
  const r = record("bad", { values: { bpm: 999 } });
  const f = finish([r]);
  expect(f.recordCount).toBe(1);
  expect(f.unusableRecordCount).toBe(1);
  expect(f.series).toHaveLength(0);
  expect(displayRecord(r).values[0]!.reason).toContain("格式范围");
  expect(
    displayRecord(record("missing", { values: {} })).unavailableReason,
  ).toBeTruthy();
});
it("rejects explicit contradictory units instead of treating a named field as proof", () => {
  expect(
    recordValues(record("bad", { unit: "Hz", values: { bpm: 72 } }))[0]!.reason,
  ).toBe("unit_unknown");
});
it("accepts only configured China Qwen host shapes and rejects credential/URL confusion", () => {
  for (const host of [
    "dashscope.aliyuncs.com",
    "maas.qianwenaiapi.com",
    "llm-local.cn-beijing.maas.aliyuncs.com",
  ])
    expect(
      healthScreenQwenEndpoint("https://" + host + "/compatible-mode/v1"),
    ).toBe(true);
  for (const url of [
    "https://openai.com/v1",
    "http://dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope.aliyuncs.com.evil.test/compatible-mode/v1",
    "https://secret@dashscope.aliyuncs.com/compatible-mode/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1?token=secret",
  ])
    expect(healthScreenQwenEndpoint(url)).toBe(false);
});
