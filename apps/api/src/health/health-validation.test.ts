import { describe, expect, it } from "vitest";
import { validateHealthRecord } from "./health-validation";

const validRecord = {
  id: "local-1",
  metric: "heart_rate",
  observedAt: "2026-09-02T04:00:00.000Z",
  timezoneOffsetMinutes: 480,
  values: { bpm: 75 },
  source: { platform: "android", model: "W8" },
};

describe("health record validation", () => {
  it("accepts a canonical record without adding unknown values", () => {
    const result = validateHealthRecord(validRecord);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.record.values).toEqual({ bpm: 75 });
  });

  it("rejects legacy metric spellings at the canonical boundary", () => {
    const result = validateHealthRecord({ ...validRecord, metric: "heartReat" });
    expect(result.valid).toBe(false);
  });

  it("rejects non-finite values rather than coercing them to zero", () => {
    const result = validateHealthRecord({
      ...validRecord,
      values: { bpm: Number.NaN },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects batches with an invalid timezone", () => {
    const result = validateHealthRecord({
      ...validRecord,
      timezoneOffsetMinutes: 900,
    });
    expect(result.valid).toBe(false);
  });

  it("preserves explicit capture metadata without changing metric values", () => {
    const source = { ...validRecord.source, origin: "unknown", measurementSource: "imported", rawVersion: 2 };
    const result = validateHealthRecord({ ...validRecord, source });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.source).toEqual(source);
      expect(result.record.values).toEqual(validRecord.values);
    }
    const legacy = validateHealthRecord(validRecord);
    if (legacy.valid) expect(legacy.record.source).toEqual(validRecord.source);
  });

  it("rejects malformed capture metadata instead of coercing it", () => {
    for (const metadata of [{ origin: "guessed_model" }, { origin: ["unknown"] }, { measurementSource: "simulator" },
      { rawVersion: "2" }, { rawVersion: -1 }, { rawVersion: 1.5 }, { rawVersion: Infinity }]) {
      expect(validateHealthRecord({ ...validRecord, source: { ...validRecord.source, ...metadata } }).valid).toBe(false);
    }
  });

  it("accepts watch-owned daily totals and rejects invalid dates or measurement types", () => {
    const daily = {
      ...validRecord,
      metric: "steps", values: { value: 2000 },
      source: { platform: "android", deviceId: "U19-A", measurementSource: "wearable" },
      aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
    };
    const accepted = validateHealthRecord(daily);
    expect(accepted.valid).toBe(true);
    if (accepted.valid) expect(accepted.record.aggregation).toEqual(daily.aggregation);
    expect(validateHealthRecord({ ...daily, aggregation: { ...daily.aggregation, localDate: "2026-09-31" } }).valid).toBe(false);
    expect(validateHealthRecord({ ...daily, metric: "heart_rate" }).valid).toBe(false);
    expect(validateHealthRecord({ ...daily, source: { platform: "android", deviceId: "U19-A", measurementSource: "manual" } }).valid).toBe(false);
  });

  it.each([
    { value: null }, { value: "not-recorded" }, { unknown: 2000 }, { value: 300000 },
  ])("rejects a daily revision without a usable metric value: %j", (values) => {
    const result = validateHealthRecord({
      ...validRecord, metric: "steps", values,
      source: { platform: "android", deviceId: "U19-A", measurementSource: "wearable" },
      aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.rejection.code).toBe("invalid_aggregation");
  });

  it("keeps the actual observation instant separate from the watch calendar day", () => {
    const input = {
      ...validRecord, metric: "sleep", values: { hours: 7 },
      observedAt: "2026-09-27T23:30:00.000Z", timezoneOffsetMinutes: 480,
      source: { platform: "android", deviceId: "U19-A", measurementSource: "wearable" },
      aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
    };
    const result = validateHealthRecord(input);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.observedAt).toBe(input.observedAt);
      expect(result.record.aggregation).toEqual(input.aggregation);
      expect(result.record.values).toEqual(input.values);
    }
  });
});
