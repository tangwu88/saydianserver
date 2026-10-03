import { beforeEach, describe, expect, it, vi } from "vitest";
import { SLEEP_ANALYSIS_NOTICE } from "@saydian/app-contracts";
import { SleepReportsService } from "./sleep-reports.service";

const input = () => ({
  sdkDate: "2026-08-04",
  timezone: "+08:00",
  sourceKey: "a".repeat(64),
  totalSeconds: 25200,
  deepSeconds: 7200,
  lightSeconds: 14400,
  remSeconds: 3600,
  awakeSeconds: 1200,
  sessions: [
    {
      kind: "night",
      startAt: "2026-08-03T16:00:00.000Z",
      endAt: "2026-08-04T00:00:00.000Z",
      asleepSeconds: 25200,
    },
  ],
});
function harness() {
  const state: any = {
    enabled: true,
    configured: true,
    consent: true,
    version: "reviewed-synthetic-v1",
    active: true,
    previous: null,
    withdrawn: null,
    acceptedAt: new Date("2026-08-01T00:00:00Z"),
    notice: true,
    documents: [
      {
        locale: "zh-Hans",
        version: "reviewed-synthetic-v1",
        contentHtml: "Synthetic verified notice",
      },
    ],
    beforeTransaction: () => undefined,
  };
  const prisma: any = {
    integrationConfig: {
      findUnique: vi.fn(async () => ({
        state: state.configured ? "CONFIGURED" : "UNCONFIGURED",
          publicConfig: { provider: "synthetic", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
      })),
    },
    appSetting: {
      findFirst: vi.fn(async () => ({
        value: { hideAi: true, sleepAiEnabled: state.enabled },
      })),
    },
    user: {
      findUnique: vi.fn(async () => ({
        status: state.active ? "ACTIVE" : "DISABLED",
        locale: "zh-Hans",
      })),
    },
    globalLegalDocument: {
      findMany: vi.fn(async () => (state.notice ? state.documents : [])),
    },
    healthProfile: { findUnique: vi.fn(), upsert: vi.fn() },
    consentRecord: {
      findFirst: vi.fn(async () =>
        state.consent
          ? {
              version: state.version,
              acceptedAt: state.acceptedAt,
              withdrawnAt: state.withdrawn,
            }
          : null,
      ),
      upsert: vi.fn(async ({ create }: any) => {
        state.consent = true;
        state.version = create.version;
        state.acceptedAt = create.acceptedAt;
        state.withdrawn = null;
        return create;
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        state.withdrawn = data.withdrawnAt;
        return { count: 1 };
      }),
    },
    healthReport: {
      findFirst: vi.fn(async () => state.previous),
      create: vi.fn(async ({ data }: any) => ({
        ...data,
        id: "synthetic-report",
        createdAt: new Date(),
        generatedAt: null,
        aiGenerated: false,
        fullContent: null,
      })),
    },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => undefined),
    $queryRaw: vi.fn(async () => []),
  };
  prisma.$transaction = vi.fn(async (run: any) => {
    state.beforeTransaction();
    return run(prisma);
  });
  return { state, prisma, service: new SleepReportsService(prisma) };
}
beforeEach(() => vi.unstubAllEnvs());
describe("sleep reports use product-scoped consent and the audited AI channel", () => {
  it("persists only aggregate evidence, queues once, and never consumes paid credits", async () => {
    const h = harness();
    expect(await h.service.create("synthetic-owner", input())).toMatchObject({
      reportType: "sleep",
      sleepScore: null,
      status: "queued",
      needsPayment: false,
    });
    const data = h.prisma.healthReport.create.mock.calls[0][0].data;
    expect(data.metricSummary[0]).toMatchObject({
      metric: "sleep",
      unit: "seconds",
      totalSeconds: 25200,
    });
    expect(data.metricSummary[0]).not.toHaveProperty("sourceKey");
    expect(JSON.stringify(data.metricSummary)).not.toContain("synthetic-owner");
    expect(data.windowStart.toISOString()).toBe("2026-08-03T16:00:00.000Z");
    expect(h.prisma.outboxEvent.upsert).toHaveBeenCalledOnce();
    expect(h.prisma.$executeRaw).toHaveBeenCalledOnce();
    expect(h.prisma.healthProfile.findUnique).not.toHaveBeenCalled();
  });
  it.each(["enabled", "configured", "consent", "active", "notice"])(
    "rejects missing %s before creating a report",
    async (field) => {
      const h = harness();
      h.state[field] = false;
      await expect(h.service.create("owner", input())).rejects.toThrow();
      expect(h.prisma.healthReport.create).not.toHaveBeenCalled();
      expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
    },
  );
  it.each([{ version: "old" }, { withdrawn: new Date() }])(
    "rejects authorization races under the member lock (%j)",
    async (patch) => {
      const h = harness();
      h.state.beforeTransaction = () => Object.assign(h.state, patch);
      await expect(h.service.create("owner", input())).rejects.toThrow(
        /授权已变更/,
      );
      expect(h.prisma.healthReport.create).not.toHaveBeenCalled();
    },
  );
  it("reuses exact inputs including failed reports, leaving retry explicit", async () => {
    const h = harness();
    h.state.previous = {
      id: "old",
      status: "FAILED",
      templateVersion: "sleep-report-v1",
      windowStart: new Date(),
      windowEnd: new Date(),
      createdAt: new Date(),
      generatedAt: null,
      distinctDays: 1,
      validRecordCount: 1,
      freePreview: {},
      aiGenerated: false,
    };
    expect(await h.service.create("owner", input())).toMatchObject({
      id: "old",
      reused: true,
      status: "failed",
      sleepScore: null,
    });
    expect(h.prisma.healthReport.create).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
  });
  it("queries only the exact owner's SDK date and snapshot", async () => {
    const h = harness();
    expect(
      await h.service.find(
        "owner",
        "2026-08-04",
        "a".repeat(64),
        "b".repeat(64),
      ),
    ).toEqual({ report: null });
    expect(h.prisma.healthReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "owner",
          templateVersion: "sleep-report-v1",
          AND: expect.arrayContaining([
            { freePreview: { path: ["sourceHash"], equals: "b".repeat(64) } },
          ]),
        }),
      }),
    );
  });
  it("invalid uploads never read consent or create work", async () => {
    const h = harness();
    await expect(
      h.service.create("owner", { ...input(), totalSeconds: 0 }),
    ).rejects.toThrow();
    expect(h.prisma.consentRecord.findFirst).not.toHaveBeenCalled();
  });
  it("reports missing notice precisely without mislabelling a configured provider", async () => {
    const h = harness();
    h.state.notice = false;
    expect(await h.service.availability("owner")).toMatchObject({
      available: false,
      reason: "Say Ring 睡眠 AI 分析说明尚未发布，请稍后重试",
      unavailableReasons: ["sleep_analysis_notice_unavailable"],
      checks: {
        featureEnabled: true,
        providerReady: true,
        workerReady: true,
        noticeReady: false,
      },
    });
  });
  it("reports a paused worker separately, without overriding operational pause flags", async () => {
    vi.stubEnv("WORKER_OUTBOUND_PAUSED", "true");
    const h = harness();
    expect(await h.service.availability("owner")).toMatchObject({
      available: false,
      unavailableReasons: ["report_worker_paused"],
      checks: { providerReady: true, noticeReady: true },
    });
    vi.stubEnv("HEALTH_REPORT_WORKER_ENABLED", "true");
    expect((await h.service.availability("owner")).available).toBe(true);
    vi.stubEnv("BUSINESS_WRITES_PAUSED", "true");
    expect((await h.service.availability("owner")).available).toBe(false);
  });
  it("reads only the Say Ring notice and consent, not Health App authorization", async () => {
    const h = harness();
    await h.service.availability("owner");
    expect(h.prisma.consentRecord.findFirst).toHaveBeenCalledWith({
      where: { userId: "owner", documentType: SLEEP_ANALYSIS_NOTICE },
      orderBy: { acceptedAt: "desc" },
    });
    expect(
      h.prisma.globalLegalDocument.findMany.mock.calls[0][0].where,
    ).toMatchObject({
      documentType: SLEEP_ANALYSIS_NOTICE,
      active: true,
      reviewed: true,
    });
    expect(h.prisma.healthProfile.findUnique).not.toHaveBeenCalled();
  });
  it("grants the current notice under lock and updates the regrant fingerprint", async () => {
    const h = harness();
    h.state.withdrawn = new Date();
    expect(
      await h.service.setAnalysisConsent("owner", {
        granted: true,
        version: "reviewed-synthetic-v1",
      }),
    ).toMatchObject({ granted: true, version: "reviewed-synthetic-v1" });
    const args = h.prisma.consentRecord.upsert.mock.calls[0][0];
    expect(args.where.userId_documentType_version).toEqual({
      userId: "owner",
      documentType: SLEEP_ANALYSIS_NOTICE,
      version: "reviewed-synthetic-v1",
    });
    expect(args.update).toMatchObject({
      acceptedAt: expect.any(Date),
      withdrawnAt: null,
      source: "say_ring_sleep_report",
    });
    expect(h.state.acceptedAt.getTime()).toBeGreaterThan(
      new Date("2026-08-01T00:00:00Z").getTime(),
    );
    expect(h.prisma.healthProfile.upsert).not.toHaveBeenCalled();
  });
  it.each([
    { granted: true, version: "old" },
    { granted: true },
    { granted: "true" },
  ])("refuses malformed/stale confirmation %j", async (body) => {
    const h = harness();
    await expect(h.service.setAnalysisConsent("owner", body)).rejects.toThrow();
    expect(h.prisma.consentRecord.upsert).not.toHaveBeenCalled();
  });
  it("a missing or blank notice cannot be accepted", async () => {
    for (const notice of [false, true]) {
      const h = harness();
      h.state.notice = notice;
      h.state.documents[0].contentHtml = " ";
      await expect(
        h.service.setAnalysisConsent("owner", {
          granted: true,
          version: "reviewed-synthetic-v1",
        }),
      ).rejects.toThrow(/尚未发布/);
      expect(h.prisma.consentRecord.upsert).not.toHaveBeenCalled();
    }
  });
  it("withdraws only this product's consent and remains possible without a published notice", async () => {
    const h = harness();
    h.state.notice = false;
    expect(
      await h.service.setAnalysisConsent("owner", { granted: false }),
    ).toMatchObject({ granted: false, withdrawnAt: expect.any(String) });
    expect(h.prisma.consentRecord.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "owner",
        documentType: SLEEP_ANALYSIS_NOTICE,
        withdrawnAt: null,
      },
      data: { withdrawnAt: expect.any(Date) },
    });
    expect(h.prisma.healthProfile.upsert).not.toHaveBeenCalled();
    expect(h.prisma.healthReport.create).not.toHaveBeenCalled();
  });
});
