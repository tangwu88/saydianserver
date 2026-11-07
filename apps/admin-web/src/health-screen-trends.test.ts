import { describe, expect, it } from "vitest";
import type { HealthScreenSeries } from "@saydian/app-contracts";
import {
  groupTrends,
  trendPath,
} from "../../../packages/health-screen-ui/src/trend-groups";
const series = (metric: string, key: string, unit: string, kind = "device") =>
  ({
    metric,
    key,
    unit,
    kind,
    label: key,
    semantics: "sample",
    group: "metabolic",
    count: 0,
    eligibleCount: 0,
    coverageDays: 0,
    eligibleDays: 0,
    latest: null,
    latestAt: null,
    average: null,
    eligibleAverage: null,
    sources: [],
    exclusions: {},
    points: [],
  }) as HealthScreenSeries;
describe("health-screen comparable trend dimensions", () => {
  it("overlays pressure components but never averages the independent reference series", () => {
    const groups = groupTrends([
      series("BLOOD_PRESSURE", "systolic", "mmHg"),
      series("BLOOD_PRESSURE", "diastolic", "mmHg"),
      series("BLOOD_PRESSURE", "reference_pressure", "mmHg", "reference"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.series).toHaveLength(3);
  });
  it("separates units, HRV algorithms and skin vs measured temperature", () => {
    expect(
      groupTrends([
        series("URIC_ACID", "ua1", "μmol/L", "reference"),
        series("URIC_ACID", "ua2", "mg/dL", "reference"),
        series("TEMPERATURE", "skin", "°C"),
        series("TEMPERATURE", "reference_temp", "°C", "reference"),
        series("HRV", "rmssd", "ms"),
        series("HRV", "sdnn", "ms"),
      ]),
    ).toHaveLength(6);
  });
  it("does not connect null gaps or create values", () => {
    const points = [
      { value: 1 },
      { value: null },
      { value: 3 },
    ] as HealthScreenSeries["points"];
    expect(
      trendPath(
        points,
        (i) => i,
        (n) => n,
      ),
    ).toBe("M0,1 M2,3 ");
  });
});

import { referenceFormValues } from "../../../packages/health-screen-ui/src/reference-form";
it("serializes native numeric inputs and omits blank lipid fields without zero-filling", () => {
  expect(
    referenceFormValues({
      totalCholesterol: 4.5,
      triglycerides: "1.2",
      hdl: "",
      ldl: null,
    }),
  ).toEqual({ totalCholesterol: 4.5, triglycerides: 1.2 });
  expect(referenceFormValues({ value: 360 })).toEqual({ value: 360 });
});
