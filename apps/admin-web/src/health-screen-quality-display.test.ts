import { describe, expect, it } from "vitest";
import {
  visibleExclusions,
  visibleRecordReason,
} from "../../../packages/health-screen-ui/src/quality-display";

describe("health-screen quality-only notices", () => {
  it("hides every known quality-only notice while retaining concrete measurement limitations", () => {
    for (const reason of [
      null,
      "quality_unknown",
      "数据质量待核实",
      "质量待核实",
    ])
      expect(visibleRecordReason(reason)).toBeNull();
    for (const reason of ["单位待核实", "超出数据格式范围", "缺少测量值"])
      expect(visibleRecordReason(reason)).toBe(reason);
  });
  it("suppresses repeated quality labels in the source panel without rewriting score evidence", () => {
    const source = { 数据质量待核实: 12, 单位待核实: 1 };
    expect(visibleExclusions(source)).toEqual({ 单位待核实: 1 });
    expect(source).toEqual({ 数据质量待核实: 12, 单位待核实: 1 });
  });
});
