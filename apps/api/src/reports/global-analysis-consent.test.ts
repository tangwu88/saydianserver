import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HealthReportsService } from "./health-reports.service";

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

function harness(documents: unknown[]) {
  const upsert = vi.fn(async ({ create }: any) => create);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = { consentRecord: { upsert, updateMany }, healthProfile: { upsert } };
  const prisma = { globalLegalDocument: { findMany: vi.fn(async () => documents) }, user: { findUnique: vi.fn(async () => ({ locale: "de" })) }, $transaction: vi.fn(async (run: any) => run(tx)) };
  return { service: new HealthReportsService(prisma as any), prisma, upsert, updateMany };
}

describe("global health-analysis reviewed consent", () => {
  it("does not persist a guessed version when the notice has not been published", async () => {
    const h = harness([]);
    await expect(h.service.setAnalysisConsent("user", { granted: true, version: "guessed-v1" })).rejects.toThrow("not available yet");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("rejects an old version without changing consent", async () => {
    const h = harness([{ version: "reviewed-2", locale: "en", contentHtml: "Synthetic notice" }]);
    await expect(h.service.setAnalysisConsent("user", { granted: true, version: "old" })).rejects.toThrow("latest");
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it("accepts only the published version with an explicit language fallback", async () => {
    const h = harness([{ version: "reviewed-2", locale: "en", contentHtml: "Synthetic notice" }]);
    expect(await h.service.setAnalysisConsent("user", { granted: true, version: "reviewed-2", locale: "en" })).toMatchObject({ granted: true, version: "reviewed-2" });
    expect(h.prisma.globalLegalDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ reviewed: true, active: true, documentType: "health_ai_analysis" }) }));
  });
  it("always permits withdrawal even when the notice is no longer published", async () => {
    const h = harness([]);
    expect(await h.service.setAnalysisConsent("user", { granted: false })).toMatchObject({ granted: false, version: null });
    expect(h.updateMany).toHaveBeenCalledOnce();
    expect(h.prisma.globalLegalDocument.findMany).not.toHaveBeenCalled();
  });
});

function retryHarness(profile: unknown, documents: unknown[]) {
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ locale: "en" })) },
    healthProfile: { findUnique: vi.fn(async () => profile) },
    globalLegalDocument: { findMany: vi.fn(async () => documents) },
    healthReport: { findFirst: vi.fn(async () => ({ id: "report", userId: "user", status: "FAILED" })), update: vi.fn(async () => ({})) },
    outboxEvent: { upsert: vi.fn(async () => ({})) },
  };
  const service = new HealthReportsService(prisma as any);
  vi.spyOn(service, "get").mockResolvedValue({ id: "report", status: "queued" } as any);
  return { service, prisma };
}

describe("global failed-report retry consent", () => {
  const current = { analysisConsentedAt: new Date(), analysisConsentWithdrawn: null, analysisConsentVersion: "reviewed-2" };
  const documents = [{ version: "reviewed-2", locale: "en", contentHtml: "Synthetic analysis notice" }];
  it.each([null, { ...current, analysisConsentedAt: null }, { ...current, analysisConsentWithdrawn: new Date() }])(
    "does not enqueue without current consent: %j", async (profile) => {
      const h = retryHarness(profile, documents);
      await expect(h.service.retry("user", "report")).rejects.toThrow("Agree to health analysis");
      expect(h.prisma.healthReport.update).not.toHaveBeenCalled();
      expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
    });
  it.each([{ documents: [] }, { documents: [{ ...documents[0], version: "reviewed-3" }] }])("does not enqueue for unavailable or replaced notice: %j", async (testCase) => {
    const h = retryHarness(current, testCase.documents);
    await expect(h.service.retry("user", "report")).rejects.toThrow("latest health analysis");
    expect(h.prisma.healthReport.update).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
  });
  it("allows retry only after checking current published consent", async () => {
    const h = retryHarness(current, documents);
    expect(await h.service.retry("user", "report")).toMatchObject({ id: "report", status: "queued" });
    expect(h.prisma.healthProfile.findUnique).toHaveBeenCalledWith({ where: { userId: "user" } });
    expect(h.prisma.healthReport.update).toHaveBeenCalledOnce();
    expect(h.prisma.outboxEvent.upsert).toHaveBeenCalledOnce();
    expect(h.prisma.globalLegalDocument.findMany.mock.invocationCallOrder[0]).toBeLessThan(h.prisma.healthReport.update.mock.invocationCallOrder[0]!);
  });
  it("does not change domestic retry behavior or require global documents", async () => {
    vi.stubEnv("APP_REALM", "domestic");
    const h = retryHarness(null, []);
    await h.service.retry("user", "report");
    expect(h.prisma.globalLegalDocument.findMany).not.toHaveBeenCalled();
    expect(h.prisma.healthProfile.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.outboxEvent.upsert).toHaveBeenCalledOnce();
  });
});
