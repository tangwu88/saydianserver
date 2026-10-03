import { describe, expect, it } from "vitest";
import { serializeReport } from "./health-reports.service";
import { SLEEP_REPORT_TEMPLATE } from "@saydian/app-contracts";
import { ReportStatus } from "@prisma/client";

const report = () => ({
  id: "synthetic-report",
  status: ReportStatus.QUEUED,
  windowStart: new Date("2026-10-01T00:00:00Z"),
  windowEnd: new Date("2026-10-02T00:00:00Z"),
  distinctDays: 1,
  validRecordCount: 1,
  freePreview: {},
  aiGenerated: false,
  generatedAt: null,
  createdAt: new Date("2026-10-02T00:00:00Z"),
  templateVersion: SLEEP_REPORT_TEMPLATE,
  generationAttempts: 2,
  failureReason: "sleep_ai:timeout",
});
describe("safe sleep report progress", () => {
  it("exposes queued attempt progress without internal errors or a fabricated score", () => {
    expect(serializeReport(report())).toMatchObject({
      status: "queued",
      generationAttempts: 2,
      progressMessage: "上次分析未完成，正在等待自动重试。",
      sleepScore: null,
    });
  });
  it("returns an actionable failed timeout and never raw provider text", () => {
    expect(
      serializeReport({ ...report(), status: ReportStatus.FAILED })
        .progressMessage,
    ).toContain("自动尝试已结束");
    const value = serializeReport({
      ...report(),
      status: ReportStatus.FAILED,
      failureReason: "must-not-leak-secret-response",
    });
    expect(JSON.stringify(value)).not.toContain("must-not-leak");
    expect(value.sleepScore).toBeNull();
  });
  it("keeps existing Health protocol and only reveals a completed validated score", () => {
    const health = serializeReport({
      ...report(),
      templateVersion: "wellness-report-v2",
    });
    expect(health).not.toHaveProperty("generationAttempts");
    expect(health).not.toHaveProperty("progressMessage");
    const sleep = serializeReport({
      ...report(),
      status: ReportStatus.READY,
      aiGenerated: true,
      fullContent: { sleepScore: { value: 70 } },
    });
    expect(sleep.sleepScore).toBe(70);
    expect(sleep.progressMessage).toBeUndefined();
  });
});
