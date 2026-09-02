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
});
