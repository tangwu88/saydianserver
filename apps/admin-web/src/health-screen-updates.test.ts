import { describe, it, expect } from "vitest";
import { changedHealthGroups } from "../../../packages/health-screen-ui/src/updates";
const original = {
  groups: [
    {
      group: "cardiovascular" as const,
      count: 2,
      updatedAt: "2026-11-06T00:00:00Z",
    },
  ],
};
describe("measurement arrival revisions", () => {
  it("does not announce initial load or unchanged polling", () => {
    expect(changedHealthGroups(null, original)).toEqual([]);
    expect(changedHealthGroups(original, original)).toEqual([]);
  });
  it("announces new uploads even when their observed timestamp is historical", () => {
    expect(
      changedHealthGroups(original, {
        groups: [
          {
            ...original.groups[0]!,
            count: 3,
            updatedAt: "2026-11-07T00:00:00Z",
          },
        ],
      })[0]?.message,
    ).toBe("收到 1 条新记录");
  });
  it("distinguishes revised daily data from additional records", () => {
    expect(
      changedHealthGroups(original, {
        groups: [{ ...original.groups[0]!, updatedAt: "2026-11-07T00:00:00Z" }],
      })[0]?.message,
    ).toBe("数据已更新");
  });
});
