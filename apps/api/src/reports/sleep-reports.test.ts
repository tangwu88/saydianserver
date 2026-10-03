import { beforeEach, describe, expect, it, vi } from "vitest";
import { SleepReportsService } from "./sleep-reports.service";

const input = () => ({ sdkDate: "2026-08-04", timezone: "+08:00", sourceKey: "a".repeat(64), totalSeconds: 25200, deepSeconds: 7200, lightSeconds: 14400, remSeconds: 3600, awakeSeconds: 1200, sessions: [{ kind: "night", startAt: "2026-08-03T16:00:00.000Z", endAt: "2026-08-04T00:00:00.000Z", asleepSeconds: 25200 }] });
function harness() {
  const state: any = { enabled: true, configured: true, consent: true, version: "reviewed-synthetic-v1", active: true, previous: null, withdrawn: false };
  const prisma: any = {
    integrationConfig: { findUnique: vi.fn(async () => ({ state: state.configured ? "CONFIGURED" : "UNCONFIGURED", publicConfig: { provider: "synthetic" } })) },
    appSetting: { findFirst: vi.fn(async () => ({ value: { hideAi: true, sleepAiEnabled: state.enabled } })) },
    user: { findUnique: vi.fn(async () => ({ status: state.active ? "ACTIVE" : "DISABLED" })) },
    healthProfile: { findUnique: vi.fn(async () => ({ analysisConsentVersion: state.version, analysisConsentedAt: new Date(), analysisConsentWithdrawn: state.withdrawn ? new Date() : null })) },
    healthReport: { findFirst: vi.fn(async () => state.previous), create: vi.fn(async ({ data }: any) => ({ ...data, id: "synthetic-report", createdAt: new Date(), generatedAt: null, aiGenerated: false, fullContent: null })) },
    outboxEvent: { upsert: vi.fn(async () => ({})) }, $executeRaw: vi.fn(async () => undefined),
  };
  prisma.$transaction = vi.fn(async (run: any) => run(prisma));
  const reports = { profile: vi.fn(async () => ({ analysisConsent: { granted: state.consent, availableVersion: "reviewed-synthetic-v1", version: state.version, document: { version: "reviewed-synthetic-v1" } } })) };
  return { state, prisma, reports, service: new SleepReportsService(prisma, reports as any) };
}
beforeEach(() => vi.unstubAllEnvs());
describe("sleep reports reuse the existing audited AI channel", () => {
  it("persists only aggregate evidence, queues once, and never consumes paid credits", async () => {
    const h = harness();
    expect(await h.service.create("synthetic-owner", input())).toMatchObject({ reportType: "sleep", sleepScore: null, status: "queued", needsPayment: false });
    const data = h.prisma.healthReport.create.mock.calls[0][0].data;
    expect(data.metricSummary[0]).toMatchObject({ metric: "sleep", unit: "seconds", totalSeconds: 25200 });
    expect(data.metricSummary[0]).not.toHaveProperty("sourceKey");
    expect(JSON.stringify(data.metricSummary)).not.toContain("synthetic-owner");
    expect(data.windowStart.toISOString()).toBe("2026-08-03T16:00:00.000Z");
    expect(h.prisma.outboxEvent.upsert).toHaveBeenCalledOnce();
    expect(h.prisma.$executeRaw).toHaveBeenCalledOnce();
  });
  it.each(["enabled", "configured", "consent", "active"])("rejects missing %s before creating a report", async (field) => { const h = harness(); h.state[field] = false; await expect(h.service.create("owner", input())).rejects.toThrow(); expect(h.prisma.healthReport.create).not.toHaveBeenCalled(); expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled(); });
  it("rejects stale consent and withdrawal during transaction", async () => { for (const patch of [{ version: "old" }, { withdrawn: true }]) { const h = harness(); Object.assign(h.state, patch); await expect(h.service.create("owner", input())).rejects.toThrow(/授权已变更/); expect(h.prisma.healthReport.create).not.toHaveBeenCalled(); } });
  it("reuses exact inputs including failed reports, leaving retry explicit", async () => {
    const h = harness(); h.state.previous = { id: "old", status: "FAILED", templateVersion: "sleep-report-v1", windowStart: new Date(), windowEnd: new Date(), createdAt: new Date(), generatedAt: null, distinctDays: 1, validRecordCount: 1, freePreview: {}, aiGenerated: false };
    expect(await h.service.create("owner", input())).toMatchObject({ id: "old", reused: true, status: "failed", sleepScore: null });
    expect(h.prisma.healthReport.create).not.toHaveBeenCalled(); expect(h.prisma.outboxEvent.upsert).not.toHaveBeenCalled();
  });
  it("queries only the exact owner's SDK date and snapshot, never another user's report", async () => {
    const h = harness(); expect(await h.service.find("owner", "2026-08-04", "a".repeat(64), "b".repeat(64))).toEqual({ report: null });
    expect(h.prisma.healthReport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "owner", templateVersion: "sleep-report-v1", AND: expect.arrayContaining([{ freePreview: { path: ["sourceHash"], equals: "b".repeat(64) } }]) }) }));
  });
  it("invalid uploads do not access health data, queue or call AI", async () => { const h = harness(); await expect(h.service.create("owner", { ...input(), totalSeconds: 0 })).rejects.toThrow(); expect(h.reports.profile).not.toHaveBeenCalled(); });
});
