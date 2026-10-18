import { describe, expect, it } from "vitest";
import { parseSayRingIosHealthDisplay, sayRingIosHealthDisplayOrClosed } from "./say-ring-ios-health";

describe("Say Ring iOS fixed read-only display contract", () => {
  it("defaults every metric closed and returns independent copies", () => {
    const first = sayRingIosHealthDisplayOrClosed(); first.metrics.heart_rate = true;
    expect(Object.values(sayRingIosHealthDisplayOrClosed().metrics)).toEqual([false, false, false, false, false]);
  });
  it("accepts exact booleans without aliasing the input", () => {
    const value = sayRingIosHealthDisplayOrClosed(); value.metrics.hrv = true;
    const parsed = parseSayRingIosHealthDisplay(value); value.metrics.hrv = false;
    expect(parsed.metrics.hrv).toBe(true);
  });
  it.each([null, [], {}, { schemaVersion: 2, metrics: {} }, { ...sayRingIosHealthDisplayOrClosed(), manualMeasurement: true },
    { schemaVersion: 1, metrics: { ...sayRingIosHealthDisplayOrClosed().metrics, blood_pressure: true } },
    { schemaVersion: 1, metrics: { ...sayRingIosHealthDisplayOrClosed().metrics, hrv: "true" } },
    { schemaVersion: 1, metrics: { heart_rate: true } },
  ])("rejects invalid or expanded config and closes all features", value => {
    expect(() => parseSayRingIosHealthDisplay(value)).toThrow();
    expect(sayRingIosHealthDisplayOrClosed(value)).toEqual(sayRingIosHealthDisplayOrClosed());
  });
});
