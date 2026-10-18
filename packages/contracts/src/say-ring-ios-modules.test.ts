import { describe, expect, it } from "vitest";
import { parseSayRingIosModuleDisplay, sayRingIosModuleDisplayOrClosed } from "./say-ring-ios-modules";
import { sayRingIosHealthDisplayOrClosed } from "./say-ring-ios-health";

describe("fixed independent module catalogue", () => {
  it.each([[false, false], [true, false], [false, true], [true, true]])("keeps the two booleans independent: %s/%s", (health_library, mall) => {
    const input = { schemaVersion: 1, modules: { health_library, mall } };
    const parsed = parseSayRingIosModuleDisplay(input);
    expect(parsed).toEqual(input);
    parsed.modules.mall = !mall;
    expect(input.modules.mall).toBe(mall);
  });
  it.each([undefined, null, [], 1, "true", { schemaVersion: 2 },
    { schemaVersion: 1, modules: { health_library: true } },
    { schemaVersion: 1, modules: { health_library: "true", mall: false } },
    { schemaVersion: 1, modules: { health_library: true, mall: false, payments: true } },
    { schemaVersion: 1, modules: { health_library: true, mall: false }, reviewer: true },
    { schemaVersion: 1, modules: { health_library: true, mall: false }, validForSeconds: 999 },
  ])("rejects malformed or expanded authoring values", value => {
    expect(() => parseSayRingIosModuleDisplay(value)).toThrow();
    expect(sayRingIosModuleDisplayOrClosed(value)).toEqual({ schemaVersion: 1, modules: { health_library: false, mall: false } });
  });
  it("never expands the existing physiological catalogue", () => {
    expect(Object.keys(sayRingIosHealthDisplayOrClosed().metrics)).toEqual(["heart_rate", "hrv", "blood_oxygen", "body_temperature", "stress"]);
  });
});
