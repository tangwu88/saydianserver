import { describe, expect, it } from "vitest";
import {
  healthWarningDirection,
  healthWarningValue,
  warningDirection,
} from "./health.service";

describe("user-configured health warnings", () => {
  it("uses the documented primary scalar without inventing missing values", () => {
    expect(healthWarningValue("heart_rate", { bpm: 75 })).toBe(75);
    expect(
      healthWarningValue("blood_pressure", { systolic: 121, diastolic: 87 }),
    ).toBe(121);
    expect(healthWarningValue("heart_rate", {})).toBeNull();
  });

  it("triggers only outside the user's configured thresholds", () => {
    expect(warningDirection(49, 50, 120)).toBe("low");
    expect(warningDirection(121, 50, 120)).toBe("high");
    expect(warningDirection(75, 50, 120)).toBeNull();
  });

  it("uses the separately configured diastolic upper threshold", () => {
    expect(
      healthWarningDirection(
        "blood_pressure",
        { systolic: 118, diastolic: 96 },
        null,
        140,
        90,
      ),
    ).toBe("high");
  });
});
