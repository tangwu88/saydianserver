import { describe, expect, it } from "vitest";
import { businessWritesPaused, shouldDeferCallbacks, shouldPauseWorkers, verifiedCallbackPaths } from "./cutover";

describe("cutover traffic policy", () => {
  it("preserves the legacy maintenance freeze across business, callbacks and workers", () => {
    const environment = { MAINTENANCE_READ_ONLY: "true", WORKER_OUTBOUND_PAUSED: "false" };
    expect(businessWritesPaused(environment)).toBe(true);
    expect(shouldDeferCallbacks(environment)).toBe(true);
    expect(shouldPauseWorkers(environment)).toBe(true);
  });
  it("can receive callbacks while processing and outbound work are paused independently", () => {
    expect(businessWritesPaused({ CALLBACK_PROCESSING_PAUSED: "true" })).toBe(false);
    expect(shouldDeferCallbacks({ CALLBACK_PROCESSING_PAUSED: "true" })).toBe(true);
    expect(shouldPauseWorkers({ WORKER_OUTBOUND_PAUSED: "true" })).toBe(true);
    expect(verifiedCallbackPaths.has("/untrusted/webhook")).toBe(false);
  });
});
