import { describe, expect, it } from "vitest";
import {
  foldedHealthRecordPeriodWhere,
  foldedHealthRecordWhere,
} from "./health-record-scope";

describe("daily summary query folding", () => {
  it("keeps raw rows and only the active daily version visible", () => {
    expect(foldedHealthRecordWhere()).toEqual({
      OR: [
        { aggregationKind: null },
        { aggregationKind: "daily_summary", aggregationActive: true },
      ],
    });
  });

  it("filters raw rows by observedAt and summaries by localDate", () => {
    const from = new Date("2026-09-01T12:00:00.000Z");
    const to = new Date("2026-09-29T12:00:00.000Z");
    expect(foldedHealthRecordPeriodWhere(from, to)).toEqual({
      OR: [
        {
          aggregationKind: null,
          observedAt: { gte: from, lte: to },
        },
        {
          aggregationKind: "daily_summary",
          aggregationActive: true,
          aggregationLocalDate: { gte: "2026-09-01", lte: "2026-09-29" },
        },
      ],
    });
  });
});
