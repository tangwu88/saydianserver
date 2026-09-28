import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

describe("AdminService.devices", () => {
  it("returns only readable, non-identifying device metadata for the admin list", async () => {
    const findMany = vi.fn(async () => [
      {
        vendor: "Veepoo",
        model: "W9S",
        displayName: "SD-Watch-W9S",
        firmware: "1.2.3",
        capabilities: ["metric:heart_rate", "feature:watch_faces"],
        boundAt: new Date("2026-09-28T08:00:00.000Z"),
        lastSeenAt: new Date("2026-09-28T08:30:00.000Z"),
        unboundAt: null,
        user: { compatibilityId: 13, nickname: "Saydian user" },
      },
      {
        vendor: "Yucheng",
        model: "R7",
        displayName: "SD-Ring-R7",
        firmware: null,
        capabilities: [],
        boundAt: new Date("2026-09-27T08:00:00.000Z"),
        lastSeenAt: null,
        unboundAt: new Date("2026-09-28T07:00:00.000Z"),
        user: { compatibilityId: 14, nickname: null },
      },
    ]);
    const service = new AdminService(
      { deviceBinding: { findMany } } as any,
      {} as any,
    );

    await expect(service.devices()).resolves.toEqual([
      {
        memberNo: "13",
        memberNickname: "Saydian user",
        displayName: "SD-Watch-W9S",
        vendor: "Veepoo",
        model: "W9S",
        firmware: "1.2.3",
        capabilities: ["metric:heart_rate", "feature:watch_faces"],
        boundAt: "2026-09-28T08:00:00.000Z",
        lastSeenAt: "2026-09-28T08:30:00.000Z",
        status: "BOUND",
      },
      {
        memberNo: "14",
        memberNickname: "未填写昵称",
        displayName: "SD-Ring-R7",
        vendor: "Yucheng",
        model: "R7",
        firmware: null,
        capabilities: [],
        boundAt: "2026-09-27T08:00:00.000Z",
        lastSeenAt: null,
        status: "UNBOUND",
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: {
        vendor: true,
        model: true,
        displayName: true,
        firmware: true,
        capabilities: true,
        boundAt: true,
        lastSeenAt: true,
        unboundAt: true,
        user: { select: { compatibilityId: true, nickname: true } },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 500,
    });
  });
});
