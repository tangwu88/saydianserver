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
