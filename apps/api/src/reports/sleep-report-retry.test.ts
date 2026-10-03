import { describe, expect, it, vi } from "vitest";
import { HealthReportsService } from "./health-reports.service";

function harness(granted: boolean) {
  const record: any = {
    id: "synthetic-report",
    userId: "synthetic-owner",
    status: "FAILED",
    templateVersion: "sleep-report-v1",
    createdAt: new Date(),
    generatedAt: null,
    windowStart: new Date(),
    windowEnd: new Date(),
    distinctDays: 1,
    validRecordCount: 1,
    freePreview: {},
    aiGenerated: false,
  };
  const prisma: any = {
    user: { findUnique: vi.fn(async () => ({ locale: "zh-Hans" })) },
    consentRecord: {
      findFirst: vi.fn(async () =>
        granted
          ? { version: "sleep-v1", acceptedAt: new Date(), withdrawnAt: null }
          : null,
      ),
    },
    globalLegalDocument: {
      findMany: vi.fn(async () => [
        {
          locale: "zh-Hans",
          version: "sleep-v1",
          contentHtml: "Synthetic sleep notice",
        },
      ]),
    },
    healthProfile: {
      findUnique: vi.fn(async () => ({
        analysisConsentVersion: "health-v1",
        analysisConsentedAt: new Date(),
        analysisConsentWithdrawn: null,
      })),
    },
    healthReport: {
      findFirst: vi.fn(async () => record),
      update: vi.fn(async ({ data }: any) => Object.assign(record, data)),
    },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
  };
  return { prisma, service: new HealthReportsService(prisma) };
}
describe("sleep retries preserve product consent", () => {
  it("cannot retry using Health App consent alone", async () => {
    const h = harness(false);
    await expect(
      h.service.retry("synthetic-owner", "synthetic-report"),
    ).rejects.toThrow(/Say Ring/);
    expect(h.prisma.healthProfile.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
  });
  it("allows an explicit retry with current sleep consent without changing Health App", async () => {
    const h = harness(true);
    expect(
      await h.service.retry("synthetic-owner", "synthetic-report"),
    ).toMatchObject({ status: "queued", reportType: "sleep" });
    expect(h.prisma.healthProfile.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.upsert).toHaveBeenCalledOnce();
  });
});
