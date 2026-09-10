import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthReportWorker, PermanentTaskError } from "./health-report-worker";

vi.mock("./integration-secrets", () => ({
  resolveWorkerSecrets: vi.fn(async () => ({ apiKey: "synthetic-test-key", baseUrl: "https://ai.example.invalid", model: "synthetic" })),
  markWorkerIntegrationVerified: vi.fn(async () => undefined),
}));

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function harness() {
  const state: any = {
    report: {
      id: "synthetic-report", userId: "synthetic-member", status: "QUEUED", fullContent: null,
      metricSummary: [{ metric: "heart_rate" }], evidenceIndex: { byMetric: [{ metric: "heart_rate", recordIds: ["synthetic-record"] }] },
      windowStart: new Date("2026-08-01T00:00:00Z"), windowEnd: new Date("2026-08-31T00:00:00Z"), distinctDays: 3, validRecordCount: 3,
    },
    user: { status: "ACTIVE", locale: "en" },
    profile: { analysisConsentedAt: new Date("2026-08-01T00:00:00Z"), analysisConsentWithdrawn: null, analysisConsentVersion: "reviewed-v1" },
    documents: [{ locale: "en", version: "reviewed-v1", contentHtml: "Synthetic reviewed notice" }],
    consumed: { membershipId: null }, restored: null, membership: null,
  };
  const prisma: any = {
    user: { findUnique: vi.fn(async () => state.user) },
    healthProfile: { findUnique: vi.fn(async () => state.profile) },
    globalLegalDocument: { findMany: vi.fn(async () => state.documents) },
    healthReport: {
      findUnique: vi.fn(async () => state.report ? { ...state.report } : null),
      update: vi.fn(async ({ data }: any) => Object.assign(state.report, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!where.status.in.includes(state.report.status)) return { count: 0 };
        Object.assign(state.report, data);
        return { count: 1 };
      }),
    },
    integrationConfig: { findUnique: vi.fn(async () => ({ state: "CONFIGURED", publicConfig: { provider: "synthetic" } })) },
    notification: { upsert: vi.fn(async () => ({ id: "synthetic-notification" })) },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
    reportCreditLedger: {
      findUnique: vi.fn(async ({ where }: any) => where.idempotencyKey.startsWith("report-restore:") ? state.restored : state.consumed),
      aggregate: vi.fn(async () => ({ _sum: { delta: 0 } })),
      create: vi.fn(async ({ data }: any) => { state.restored = data; return data; }),
    },
    healthMembership: {
      findUnique: vi.fn(async () => state.membership),
      update: vi.fn(async () => ({})),
    },
    $queryRaw: vi.fn(async () => []),
  };
  prisma.$transaction = vi.fn(async (run: any) => run(prisma));
  const beforeResponse = vi.fn<() => void>(() => undefined);
  const fetch = vi.fn(async () => {
    beforeResponse();
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        overview: "仅基于已获取的记录。", trends: [{ metric: "heart_rate", text: "继续观察个人趋势。" }],
        suggestions: ["保持规律作息。"], limitations: ["不用于诊断或治疗。"],
      }) } }] }),
    };
  });
  vi.stubGlobal("fetch", fetch);
  return { state, prisma, fetch, beforeResponse, worker: new HealthReportWorker(prisma) };
}

describe("global health report execution consent", () => {
  it("checks current reviewed consent before transmission and again under locks before publishing", async () => {
    const h = harness();
    await h.worker.generate(h.state.report.id);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.prisma.healthProfile.findUnique).toHaveBeenCalledTimes(3);
    expect(h.prisma.globalLegalDocument.findMany).toHaveBeenCalledWith({
      where: { documentType: "health_ai_analysis", locale: { in: ["en"] }, active: true, reviewed: true, publishedAt: { lte: expect.any(Date) } },
      orderBy: { publishedAt: "desc" },
    });
    expect(h.prisma.healthProfile.findUnique.mock.invocationCallOrder[0]).toBeLessThan(h.fetch.mock.invocationCallOrder[0]!);
    expect(h.prisma.$queryRaw).toHaveBeenCalledTimes(3);
    expect(h.prisma.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(h.prisma.healthProfile.findUnique.mock.invocationCallOrder[2]!);
    expect(h.state.report).toMatchObject({ status: "READY", aiGenerated: true });
    expect(h.prisma.notification.upsert).toHaveBeenCalledOnce();
    expect(h.prisma.outboxEvent.upsert).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing profile", (s: any) => { s.profile = null; }],
    ["never consented", (s: any) => { s.profile.analysisConsentedAt = null; }],
    ["withdrawn", (s: any) => { s.profile.analysisConsentWithdrawn = new Date(); }],
    ["outdated notice", (s: any) => { s.profile.analysisConsentVersion = "old"; }],
    ["no published notice", (s: any) => { s.documents = []; }],
    ["empty notice", (s: any) => { s.documents[0].contentHtml = "  "; }],
    ["disabled member", (s: any) => { s.user.status = "DISABLED"; }],
    ["pending deletion", (s: any) => { s.user.status = "DELETION_PENDING"; }],
    ["deleted member", (s: any) => { s.user.status = "DELETED"; }],
    ["missing member", (s: any) => { s.user = null; }],
  ])("does not transmit data for %s", async (_name, change) => {
    const h = harness();
    change(h.state);
    await expect(h.worker.generate(h.state.report.id)).rejects.toBeInstanceOf(PermanentTaskError);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.prisma.healthReport.update).not.toHaveBeenCalled();
    expect(h.prisma.notification.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["withdrawal", (s: any) => { s.profile.analysisConsentWithdrawn = new Date(); }],
    ["notice replacement", (s: any) => { s.documents[0].version = "reviewed-v2"; }],
    ["account disable", (s: any) => { s.user.status = "DISABLED"; }],
    ["withdrawal then regrant", (s: any) => { s.profile.analysisConsentedAt = new Date("2026-08-02T00:00:00Z"); }],
  ])("discards AI results after %s and restores the credit once through permanent failure", async (_name, change) => {
    const h = harness();
    h.beforeResponse.mockImplementation(() => change(h.state));
    const error = await h.worker.generate(h.state.report.id).catch(error => error);
    expect(error).toBeInstanceOf(PermanentTaskError);
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.prisma.notification.upsert).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
    expect(h.state.report.fullContent).toBeNull();
    // OutboxWorker invokes this on PermanentTaskError and records DEAD_LETTER.
    await h.worker.failPermanently(h.state.report.id, error);
    await h.worker.failPermanently(h.state.report.id, error);
    expect(h.state.report.status).toBe("FAILED");
    expect(h.prisma.reportCreditLedger.create).toHaveBeenCalledOnce();
    expect(h.state.restored).toMatchObject({ delta: 1, idempotencyKey: "report-restore:synthetic-report" });
    await h.worker.generate(h.state.report.id);
    expect(h.fetch).toHaveBeenCalledOnce();
  });

  it("does not overwrite a report revoked while AI is running", async () => {
    const h = harness();
    h.beforeResponse.mockImplementation(() => { h.state.report.status = "REVOKED"; });
    await h.worker.generate(h.state.report.id);
    expect(h.state.report).toMatchObject({ status: "REVOKED", fullContent: null });
    expect(h.prisma.notification.upsert).not.toHaveBeenCalled();
  });

  it("does not send data when consent is withdrawn during the GENERATING transition", async () => {
    const h = harness();
    h.prisma.healthReport.updateMany.mockImplementation(async () => {
      h.state.profile.analysisConsentWithdrawn = new Date();
      return { count: 1 };
    });
    await expect(h.worker.generate(h.state.report.id)).rejects.toBeInstanceOf(PermanentTaskError);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("does not resurrect a report revoked before its GENERATING transition", async () => {
    const h = harness();
    h.prisma.healthReport.updateMany.mockImplementation(async () => {
      h.state.report.status = "REVOKED";
      return { count: 0 };
    });
    await h.worker.generate(h.state.report.id);
    expect(h.state.report.status).toBe("REVOKED");
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "REVOKED", "AWAITING_PAYMENT", "READY"])("does not generate a stale %s task", async status => {
    const h = harness();
    h.state.report.status = status;
    await h.worker.generate(h.state.report.id);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.prisma.healthReport.update).not.toHaveBeenCalled();
  });

  it("uses the preferred-language latest notice before English fallback", async () => {
    const h = harness();
    h.state.user.locale = "zh_TW";
    h.state.profile.analysisConsentVersion = "traditional-v1";
    h.state.documents = [
      { locale: "en", version: "newer-english", contentHtml: "English notice" },
      { locale: "zh-Hant", version: "traditional-v1", contentHtml: "繁體聲明" },
    ];
    await h.worker.generate(h.state.report.id);
    expect(h.state.report.status).toBe("READY");
    expect(h.prisma.globalLegalDocument.findMany.mock.calls[0][0].where.locale.in).toEqual(["zh-Hant", "en"]);
  });

  it("falls back to reviewed English when the member's language is unavailable", async () => {
    const h = harness();
    h.state.user.locale = "de-DE";
    await h.worker.generate(h.state.report.id);
    expect(h.state.report.status).toBe("READY");
    expect(h.prisma.globalLegalDocument.findMany.mock.calls[0][0].where.locale.in).toEqual(["de", "en"]);
  });

  it("restores active membership credit once and never grants an unconsumed credit", async () => {
    const h = harness();
    h.state.consumed.membershipId = "synthetic-membership";
    h.state.membership = { id: "synthetic-membership", status: "ACTIVE", expiresAt: new Date(Date.now() + 86_400_000) };
    await h.worker.failPermanently(h.state.report.id, new PermanentTaskError("consent withdrawn"));
    await h.worker.failPermanently(h.state.report.id, new PermanentTaskError("consent withdrawn"));
    expect(h.prisma.healthMembership.update).toHaveBeenCalledOnce();
    expect(h.state.restored.membershipId).toBe("synthetic-membership");
    const withoutCredit = harness();
    withoutCredit.state.consumed = null;
    await withoutCredit.worker.failPermanently(withoutCredit.state.report.id, new Error("consent withdrawn"));
    expect(withoutCredit.prisma.reportCreditLedger.create).not.toHaveBeenCalled();
  });

  it("checks fresh report state under the failure lock before restoring credit", async () => {
    const h = harness();
    h.prisma.$queryRaw.mockImplementation(async () => { h.state.report.status = "READY"; return []; });
    await h.worker.failPermanently(h.state.report.id, new Error("late failure"));
    expect(h.prisma.reportCreditLedger.create).not.toHaveBeenCalled();
    expect(h.state.report.status).toBe("READY");
  });

  it("does not add global legal requirements or row locks to the domestic worker", async () => {
    vi.stubEnv("APP_REALM", "domestic");
    const h = harness();
    h.state.profile = null;
    h.state.documents = [];
    await h.worker.generate(h.state.report.id);
    expect(h.state.report.status).toBe("READY");
    expect(h.prisma.healthProfile.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.globalLegalDocument.findMany).not.toHaveBeenCalled();
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
