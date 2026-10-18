import { describe, expect, it } from "vitest";
import { chartGeometry, reportNumber, sleepDuration } from "./report-charts";

describe("report chart evidence", () => {
  it("uses calendar spacing and leaves missing dates disconnected", () => {
    const result = chartGeometry([{ date: "2026-10-01", value: 70 }, { date: "2026-10-02", value: 72 }, { date: "2026-10-05", value: 74 }]);
    expect(result.path.match(/M/g)).toHaveLength(2);
    expect(result.path.match(/L/g)).toHaveLength(1);
    expect(result.dots[1]?.x).toBe(81);
    expect(result).toMatchObject({ minimum: 70, maximum: 74 });
  });
  it("centres single and flat samples without NaN or fabricated changes", () => {
    const single = chartGeometry([{ date: "2026-10-01", value: 70 }]);
    expect(single.dots[0]).toMatchObject({ x: 150, y: 42, value: 70 });
    expect(single.path).not.toMatch(/L|NaN|Infinity/);
    expect(chartGeometry([])).toMatchObject({ path: "", minimum: null, maximum: null });
    expect(sleepDuration(null)).toBe("未记录");
    expect(sleepDuration(25_200)).toBe("7小时0分");
    expect(reportNumber(null)).toBe("—");
  });
});
