import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { validateReference, referenceScreenRecord, metricGroups } from "./references";
import { healthMetrics } from "@saydian/app-contracts";
import { ScreenAccumulator, screenPeriod, recordValues } from "./aggregation";
import type { MemberHealthReference } from "@prisma/client";
const now = new Date("2026-11-07T03:00:00Z");
const input = () => ({
  metric: "BLOOD_GLUCOSE",
  measuredAt: "2026-11-06T08:00:00+08:00",
  unit: "mmol/L",
  values: { value: 5.8 },
  method: "GLUCOSE_METER",
  context: "FASTING",
  requestKey: randomUUID(),
});
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    userId: randomUUID(),
    observedAt: new Date("2026-11-06T00:00:00Z"),
    createdAt: now,
    updatedAt: now,
    quality: "VALID",
    ...input(),
    ...overrides,
  } as unknown as MemberHealthReference;
}
describe("manual references remain separate from device measurements", () => {
  it("maps every accepted upload metric to a body region, including ECG and composition records", () => {
    for (const metric of healthMetrics) expect(metricGroups[metric.toUpperCase()]).toBeTruthy();
    expect(metricGroups.ECG).toBe("cardiovascular");
    expect(metricGroups.BODY_COMPOSITION).toBe("metabolic");
    expect(metricGroups.BLOOD_COMPOSITION).toBe("metabolic");
  });
  it("normalizes explicit offset time and rejects future or timezone-less entries", () => {
    expect(validateReference(input(), now).measuredAt).toBe(
      "2026-11-06T00:00:00.000Z",
    );
    for (const measuredAt of [
      "2026-11-06T08:00:00",
      "2027-01-01T00:00:00Z",
      "bad",
    ])
      expect(() =>
        validateReference({ ...input(), measuredAt }, now),
      ).toThrow();
  });
  it("requires source, unit and glucose context to match the metric; rejects non-numeric data", () => {
    for (const patch of [
      { method: "THERMOMETER" },
      { unit: "mmHg" },
      { context: "RESTING" },
      { values: { value: "5.8" } },
      { values: { value: Infinity } },
      { values: { value: 5.8, extra: 8 } },
    ])
      expect(() => validateReference({ ...input(), ...patch }, now)).toThrow();
  });
  it("rejects reversed pressure and oxygen above 100 without asserting clinical normality", () => {
    expect(() =>
      validateReference(
        {
          ...input(),
          metric: "BLOOD_PRESSURE",
          method: "BLOOD_PRESSURE_MONITOR",
          context: "RESTING",
          unit: "mmHg",
          values: { systolic: 70, diastolic: 120 },
        },
        now,
      ),
    ).toThrow();
    expect(() =>
      validateReference(
        {
          ...input(),
          metric: "BLOOD_OXYGEN",
          method: "PULSE_OXIMETER",
          context: "RESTING",
          unit: "%",
          values: { value: 101 },
        },
        now,
      ),
    ).toThrow();
  });
  it("separates fasting, post-meal, source and units instead of averaging unlike glucose samples", () => {
    const a = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
    for (const patch of [
      {},
      { context: "AFTER_MEAL_2H" },
      { unit: "mg/dL", values: { value: 105 } },
      { method: "LAB_REPORT" },
    ])
      a.add(referenceScreenRecord(row(patch)));
    const s = a.finish(null, null, { age: null, gender: "UNKNOWN" });
    expect(s.series).toHaveLength(4);
    expect(s.series.every((x) => x.kind === "reference" && x.count === 1)).toBe(
      true,
    );
    expect(s.score.total).toBeNull();
    expect(s.eligibleRecordCount).toBe(0);
    expect(s.series.every((x) => x.eligibleCount === 0)).toBe(true);
  });
  it("does not trust a reference marker injected in device metadata", () => {
    const r = referenceScreenRecord(row());
    delete r.reference;
    r.sourceMetadata = {
      reference: { method: "GLUCOSE_METER", context: "FASTING" },
      timeBasis: "sdk",
    };
    const values = recordValues(r);
    expect(values[0]?.reason).toBe("glucose_unverified");
    expect(values[0]?.key.startsWith("reference_")).toBe(false);
  });
  it("keeps manual thermometer values separate from skin temperature", () => {
    const r = referenceScreenRecord(
      row({
        metric: "TEMPERATURE",
        unit: "°C",
        values: { value: 36.5 },
        method: "THERMOMETER",
        context: "RESTING",
      }),
    );
    expect(recordValues(r)[0]?.label).toContain("实测体温");
    expect(recordValues(r)[0]?.key).toMatch(/^reference_/);
  });
  it("accepts uric acid in both reported units but keeps units and methods separate", () => {
    const a = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
    for (const patch of [
      { unit: "μmol/L", method: "LAB_REPORT", values: { value: 360 } },
      { unit: "mg/dL", method: "LAB_REPORT", values: { value: 6.1 } },
      { unit: "μmol/L", method: "URIC_ACID_METER", values: { value: 355 } },
    ]) {
      const data = validateReference(
        { ...input(), metric: "URIC_ACID", ...patch },
        now,
      );
      a.add(referenceScreenRecord(row(data)));
    }
    const result = a.finish(null, null, { age: null, gender: "UNKNOWN" });
    expect(result.series).toHaveLength(3);
    expect(
      result.series.every(
        (s) => s.group === "metabolic" && s.eligibleCount === 0,
      ),
    ).toBe(true);
    expect(result.series.map((s) => s.average).sort((a, b) => a! - b!)).toEqual(
      [6.1, 355, 360],
    );
    expect(() =>
      validateReference(
        {
          ...input(),
          metric: "URIC_ACID",
          unit: "mmol/L",
          method: "LAB_REPORT",
        },
        now,
      ),
    ).toThrow();
  });
  it("supports a partial lipid panel without filling absent components or mixing analytes", () => {
    const data = validateReference(
      {
        ...input(),
        metric: "BLOOD_LIPIDS",
        method: "LAB_REPORT",
        values: { totalCholesterol: 4.5, ldl: 2.5 },
      },
      now,
    );
    expect(data.values).toEqual({ totalCholesterol: 4.5, ldl: 2.5 });
    const a = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
    a.add(referenceScreenRecord(row(data)));
    const result = a.finish(null, null, { age: null, gender: "UNKNOWN" });
    expect(result.series).toHaveLength(2);
    expect(
      result.series.every(
        (s) => s.group === "metabolic" && s.kind === "reference",
      ),
    ).toBe(true);
    expect(
      result.series.find((s) => s.label.startsWith("总胆固醇"))?.average,
    ).toBe(4.5);
    expect(result.eligibleRecordCount).toBe(0);
    expect(result.score.total).toBeNull();
    for (const values of [
      {},
      { totalCholesterol: 0 },
      { ldl: null },
      { hdl: 1.3, invented: 3 },
    ])
      expect(() => validateReference({ ...data, values }, now)).toThrow();
    expect(() =>
      validateReference({ ...data, context: "AFTER_MEAL_2H" }, now),
    ).toThrow();
  });
});

import { scoreMetric, newScreenScoreRule } from "@saydian/app-contracts";
import { validateRules } from "./policy";
it("scores only explicitly included reference method, context and unit", () => {
  const rule = newScreenScoreRule(scoreMetric("ref_glucose_fasting")!);
  Object.assign(rule, {
    weight: 1,
    minDays: 1,
    minSamples: 1,
    basis: "Synthetic regression only",
    bands: [{ min: null, max: null, score: 61 }],
  });
  const rules = validateRules(
    { title: "Synthetic", description: "", items: [rule] },
    true,
  );
  const period = screenPeriod(7, "Asia/Shanghai", now),
    acc = new ScreenAccumulator(period);
  for (const data of [
    { method: "LAB_REPORT", values: { value: 5.4 } },
    { method: "LAB_REPORT", context: "AFTER_MEAL_2H", values: { value: 8 } },
    { method: "LAB_REPORT", unit: "mg/dL", values: { value: 95 } },
    { method: "GLUCOSE_METER", values: { value: 7 } },
  ])
    acc.add(referenceScreenRecord(row(data)));
  const facts = acc.finish(rules, 3, { age: 40, gender: "FEMALE" });
  expect(facts.score.items[0]).toMatchObject({
    value: 5.4,
    count: 1,
    score: 61,
  });
  expect(facts.eligibleRecordCount).toBe(1);
  expect(facts.series.filter((s) => s.eligibleCount > 0)).toHaveLength(1);
  for (const bad of [
    { referenceUnit: "mmHg" },
    { allowedOrigins: ["watch_history"] },
    { allowedOrigins: ["LAB_REPORT", "GLUCOSE_METER"] },
  ])
    expect(() =>
      validateRules({ ...rules, items: [{ ...rule, ...bad }] }),
    ).toThrow();
});
it("keeps systolic/diastolic, uric acid and partial lipid fields independent", () => {
  const keys = [
    "ref_bp_systolic",
    "ref_bp_diastolic",
    "ref_urate_fasting",
    "ref_lipid_tc",
    "ref_lipid_ldl",
  ];
  const rules = {
    title: "Synthetic",
    description: "",
    items: keys.map((k) => ({
      ...newScreenScoreRule(scoreMetric(k)!),
      bands: [{ min: null, max: null, score: 80 }],
    })),
  };
  const acc = new ScreenAccumulator(screenPeriod(7, "Asia/Shanghai", now));
  for (const input of [
    {
      metric: "BLOOD_PRESSURE",
      method: "BLOOD_PRESSURE_MONITOR",
      context: "RESTING",
      unit: "mmHg",
      values: { systolic: 120, diastolic: 75 },
    },
    {
      metric: "URIC_ACID",
      method: "LAB_REPORT",
      context: "FASTING",
      unit: "μmol/L",
      values: { value: 350 },
    },
    {
      metric: "BLOOD_LIPIDS",
      method: "LAB_REPORT",
      context: "FASTING",
      unit: "mmol/L",
      values: { totalCholesterol: 4.5 },
    },
  ])
    acc.add(referenceScreenRecord(row(input)));
  const facts = acc.finish(rules, 2, { age: 30, gender: "MALE" });
  expect(facts.score.items.map((i) => i.value)).toEqual([
    120,
    75,
    350,
    4.5,
    null,
  ]);
  expect(facts.score.items[4]?.score).toBeNull();
});
