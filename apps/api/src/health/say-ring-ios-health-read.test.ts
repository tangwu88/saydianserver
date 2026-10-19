import { describe, expect, it, vi } from "vitest";
import { HealthMetric } from "@prisma/client";
import { sayRingIosHealthDisplayOrClosed } from "@saydian/app-contracts";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("opt-in Say Ring iOS read scope", () => {
  it("allows only activity and sleep by default", async () => {
    const list = vi.fn(); const support = { sayRingIosReadOnlyHealth: vi.fn(async () => sayRingIosHealthDisplayOrClosed()) };
    await new HealthController({ list } as any, support as any).list({ id: "owner" } as any, undefined, "50", undefined, "say-ring", "ios");
    expect(list).toHaveBeenCalledExactlyOnceWith("owner", undefined, 50, undefined, ["sleep", "steps", "distance", "calories"]);
  });
  it("maps permitted display flags to existing cloud metrics without opening unsupported metrics", async () => {
    const config = sayRingIosHealthDisplayOrClosed(); for (const key of Object.keys(config.metrics)) config.metrics[key as keyof typeof config.metrics] = true;
    const list = vi.fn();
    await new HealthController({ list } as any, { sayRingIosReadOnlyHealth: async () => config } as any).list({ id: "owner" } as any, undefined, "25", "cursor", "say-ring", "ios");
    expect(list).toHaveBeenCalledExactlyOnceWith("owner", undefined, 25, "cursor", ["sleep", "steps", "distance", "calories", "heart_rate", "hrv", "blood_oxygen", "temperature"]);
  });
  it.each([[undefined, undefined], ["say-ring", "android"], ["say-ring", undefined], ["saydian-global", "ios"]])("does not alter other products or legacy calls (%s/%s)", async (product, platform) => {
    const list = vi.fn(); const read = vi.fn();
    await new HealthController({ list } as any, { sayRingIosReadOnlyHealth: read } as any).list({ id: "owner" } as any, "heart_rate", "50", undefined, product, platform);
    expect(list).toHaveBeenCalledExactlyOnceWith("owner", "heart_rate", 50, undefined); expect(read).not.toHaveBeenCalled();
  });
  it("fails the request closed on a config storage error", async () => {
    const list = vi.fn();
    await expect(new HealthController({ list } as any, { sayRingIosReadOnlyHealth: async () => { throw new Error("storage unavailable"); } } as any).list({ id: "owner" } as any, undefined, "50", undefined, "say-ring", "ios")).rejects.toThrow("storage unavailable");
    expect(list).not.toHaveBeenCalled();
  });
  it("applies ownership, metric restriction and cursor in SQL before taking a page", async () => {
    const findMany = vi.fn(async () => []);
    const result = await new HealthService({ healthRecord: { findMany } } as any).list("owner", "heart_rate", 2, undefined, ["sleep"]);
    expect(result).toEqual({ items: [], nextCursor: null });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "owner", metric: HealthMetric.HEART_RATE, AND: expect.arrayContaining([{ metric: { in: [HealthMetric.SLEEP] } }]) }), take: 2 }));
  });
});
