import { describe, expect, it } from "vitest";
import { businessWritesPaused, healthReportWorkerEnabled, jushuitanWorkerEnabled, shouldDeferCallbacks, shouldPauseWorkers, verifiedCallbackPaths } from "./cutover";

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
  it("allows only explicitly selected report and ERP workers through the outbound pause", () => {
    const paused = { WORKER_OUTBOUND_PAUSED: "true" };
    expect(healthReportWorkerEnabled(paused)).toBe(false);
    expect(jushuitanWorkerEnabled(paused)).toBe(false);
    expect(healthReportWorkerEnabled({ ...paused, HEALTH_REPORT_WORKER_ENABLED: "true" })).toBe(true);
    expect(jushuitanWorkerEnabled({ ...paused, JUSHUITAN_OUTBOUND_ENABLED: "true" })).toBe(true);
    expect(healthReportWorkerEnabled({ ...paused, HEALTH_REPORT_WORKER_ENABLED: "true", BUSINESS_WRITES_PAUSED: "true" })).toBe(false);
    expect(jushuitanWorkerEnabled({ ...paused, JUSHUITAN_OUTBOUND_ENABLED: "true", MAINTENANCE_READ_ONLY: "true" })).toBe(false);
  });
});
