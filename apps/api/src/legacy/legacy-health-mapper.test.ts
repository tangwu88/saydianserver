import { describe, expect, it } from "vitest";
import {
  canonicalToLegacyDaily,
  legacyDailyToCanonical,
} from "./legacy-health-mapper";

describe("legacy health compatibility", () => {
  it("maps historical misspellings only at the V1 boundary", () => {
    const records = legacyDailyToCanonical(
      [
        {
          date: "2026-09-02 08:00:00",
          heartReat: 75,
          bloodPressure: { bloodPressureHigh: 121, bloodPressureLow: 87 },
        },
      ],
      "batch-1",
    );
    expect(records.map((item) => item.metric)).toEqual([
      "heart_rate",
      "blood_pressure",
    ]);
    expect(JSON.stringify(records)).not.toContain("heartReat");
  });

  it("reconstructs the old mini-program response shape", () => {
    const rows = canonicalToLegacyDaily([
      {
        metric: "heart_rate",
        observedAt: "2026-09-02T08:00:00.000Z",
        values: { value: 75 },
      },
    ]);
    expect(rows[0]).toMatchObject({ heartReat: 75, pulseReat: [75] });
  });
});
