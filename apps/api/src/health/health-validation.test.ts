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

  it("accepts and preserves a versioned daily summary", () => {
    const aggregation = { kind: "daily_summary", localDate: "2026-09-28" };
    const result = validateHealthRecord({
      ...validRecord,
      metric: "steps",
      values: { value: 12_345 },
      unit: "步",
      source: {
        ...validRecord.source,
        deviceId: "urion:U19-EB1",
        origin: "watch_history",
        measurementSource: "wearable",
        rawVersion: 1,
      },
      aggregation,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.record.aggregation).toEqual(aggregation);
      expect(result.record.unit).toBe("步");
      expect(result.record.values).toEqual({ value: 12_345 });
    }
  });

  it("rejects malformed or device-less daily summaries without dropping metadata", () => {
    for (const aggregation of [
      { kind: "hourly_summary", localDate: "2026-09-28" },
      { kind: "daily_summary", localDate: "2026-02-30" },
      { kind: "daily_summary", localDate: "2026/09/28" },
    ]) {
      const result = validateHealthRecord({
        ...validRecord,
        source: { ...validRecord.source, deviceId: "urion:U19-EB1" },
        aggregation,
      });
      expect(result.valid && result.record.aggregation).toBe(false);
      if (!result.valid) expect(result.rejection.code).toBe("invalid_aggregation");
    }
    const noDevice = validateHealthRecord({
      ...validRecord,
      aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
    });
    expect(noDevice.valid).toBe(false);
    if (!noDevice.valid) expect(noDevice.rejection.code).toBe("invalid_aggregation");
  });
});
