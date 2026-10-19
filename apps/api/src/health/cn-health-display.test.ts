import { describe, expect, it, vi } from "vitest";
import { HealthController } from "./health.controller";
import { sayRingIosHealthDisplayOrClosed } from "@saydian/app-contracts";
describe("CN read-only display scope", () => {
 it.each(["android", "ios", "harmony"])("uses independent CN flags on %s before pagination", async platform => {
  const value=sayRingIosHealthDisplayOrClosed();value.metrics.hrv=true;
  const list=vi.fn(); const cnReadOnlyHealth=vi.fn(async()=>value); const ring=vi.fn();
  await new HealthController({list} as any,{cnReadOnlyHealth,sayRingIosReadOnlyHealth:ring} as any).list({id:"owner"} as any,"hrv","50","cursor","saydian-app-cn",platform);
  expect(list).toHaveBeenCalledExactlyOnceWith("owner","hrv",50,"cursor",["sleep","steps","distance","calories","hrv"]);expect(ring).not.toHaveBeenCalled();
 });
});
