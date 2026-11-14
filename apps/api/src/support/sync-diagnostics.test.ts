import { describe, expect, it, vi } from "vitest";
import { parseSyncDiagnostic, submitSyncDiagnostic, memberSyncDiagnostics, decodeDiagnosticSlot, syncDiagnosticCategory } from "./sync-diagnostics";
import { SupportService } from "./support.service";
import { AdminController } from "../admin/admin.controller";

function report(index = 1): any {
  return { schemaVersion: 1, product: "say-ring", reportId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, connectionId: "22222222-2222-4222-8222-222222222222", mode: "automatic", platform: "android", appVersion: "1.0.14", buildNumber: 1307, sdk: "coolwear", model: "R7Pro", firmware: "819.0.1.0.0", connectionState: "ready", initializationState: "ready", capabilityState: "ready", metrics: ["heart_rate", "blood_oxygen"], stages: [{ stage: "read", state: "partial", code: "capabilities_missing", elapsedMs: 85000, received: 0 }] };
}
function harness() {
  const slots = new Map<string, any>();
  const feedback = {
    findFirst: vi.fn(async ({ where }: any) => slots.get(where.userId) ?? null),
    create: vi.fn(async ({ data }: any) => { const row = { id: data.userId, ...data }; slots.set(data.userId, row); return row; }),
    update: vi.fn(async ({ where, data }: any) => { const row = { ...slots.get(where.id), ...data }; slots.set(where.id, row); return row; }),
  };
  const tx = { feedback, $queryRaw: vi.fn(async () => [{ id: "member-a" }]) };
  let tail = Promise.resolve();
  const prisma = {
    feedback, user: { findUnique: vi.fn(async () => ({ id: "member-a" })) },
    $transaction: vi.fn((run: any) => { const next = tail.then(() => run(tx)); tail = next.catch(() => {}); return next; }),
  };
  return { prisma: prisma as any, feedback, slots, tx };
}

describe("Say Ring bounded sync diagnostics", () => {
  it("accepts only the fixed product, catalogue and bounded counters", () => {
    const clean = parseSyncDiagnostic(report());
    expect(clean.metrics).toEqual(["blood_oxygen", "heart_rate"]);
    expect(JSON.stringify(clean)).not.toMatch(/token|mobile|deviceId|values/);
  });

  it.each(["userId", "deviceId", "mac", "mobile", "accessToken", "healthValues", "logs", "message"])("rejects arbitrary top-level field %s before persistence", async key => {
    const h = harness();
    await expect(submitSyncDiagnostic(h.prisma, "member-a", { ...report(), [key]: "synthetic-private" })).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    { product: "another-app" }, { schemaVersion: 2 }, { appVersion: "token-secret" },
    { firmware: "https://private.example/key" }, { model: "R7Pro customer-name" },
    { metrics: ["unreviewed_private_metric"] }, { stages: [{ stage: "read", state: "failed", code: "secret-message", elapsedMs: 1 }] },
    { stages: [{ stage: "read", state: "failed", code: "unknown", elapsedMs: 1, value: 72 }] },
    { stages: [{ stage: "read", state: "failed", code: "unknown", elapsedMs: -1 }] },
    { stages: Array.from({ length: 17 }, () => report().stages[0]) },
  ])("rejects invalid shape %#", patch => expect(() => parseSyncDiagnostic({ ...report(), ...patch })).toThrow());

  it("associates reports only with the authenticated member and keeps at most five", async () => {
    const h = harness(), start = Date.parse("2026-11-14T00:00:00Z");
    for (let i = 1; i <= 8; i++) await submitSyncDiagnostic(h.prisma, "member-a", report(i), new Date(start + i * 3_600_000));
    expect(h.feedback.create).toHaveBeenCalledTimes(1);
    expect(h.feedback.create.mock.calls[0]![0].data).toMatchObject({ userId: "member-a", category: syncDiagnosticCategory, contact: null, attachments: [] });
    const rows = decodeDiagnosticSlot(h.slots.get("member-a").content);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.report.reportId).toBe(report(8).reportId);
    expect(rows.some(r => r.report.reportId === report(1).reportId)).toBe(false);
    expect(h.tx.$queryRaw).toHaveBeenCalled();
  });

  it("deduplicates retries without consuming quota or replacing a receipt", async () => {
    const h = harness();
    await submitSyncDiagnostic(h.prisma, "member-a", report());
    expect(await submitSyncDiagnostic(h.prisma, "member-a", report())).toMatchObject({ accepted: true, duplicate: true });
    expect(h.feedback.update).not.toHaveBeenCalled();
  });

  it("limits all modes together to four reports an hour using server time", async () => {
    const h = harness(), now = new Date("2026-11-14T00:00:00Z");
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => submitSyncDiagnostic(h.prisma, "member-a", { ...report(i + 1), mode: i % 2 ? "manual" : "automatic" }, now)));
    expect(results.filter(r => r.accepted)).toHaveLength(4);
    expect(results.filter(r => !r.accepted)).toHaveLength(4);
    expect(h.feedback.create).toHaveBeenCalledTimes(1);
    expect(h.feedback.update).toHaveBeenCalledTimes(3);
    expect(results[4]).toMatchObject({ reason: "rate_limited", retryAfterSeconds: 3600 });
  });

  it("never returns another member's slot", async () => {
    const h = harness();
    await submitSyncDiagnostic(h.prisma, "member-a", report());
    expect(await memberSyncDiagnostics(h.prisma, "member-b")).toMatchObject({ reports: [] });
    expect(h.feedback.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: "member-b", category: syncDiagnosticCategory } }));
  });

  it("invalid stored content is not exposed as JSON or untrusted strings", () => {
    expect(decodeDiagnosticSlot('{"reports":[{"receivedAt":"2026-11-14","report":{"token":"private"}}]}')).toEqual([]);
    expect(decodeDiagnosticSlot("not JSON")).toEqual([]);
  });

  it("ordinary feedback cannot bypass validation and quota", async () => {
    const h = harness(), support = new SupportService(h.prisma, {} as any);
    await expect(support.createFeedback("member-a", { category: syncDiagnosticCategory, content: "synthetic bypass" })).rejects.toThrow("同步诊断");
    expect(h.feedback.create).not.toHaveBeenCalled();
  });

  it("requires a logged-in member on both report endpoints and restricted admin roles", async () => {
    const { SupportController } = await import("./support.controller");
    expect(Reflect.getMetadata("__guards__", SupportController.prototype.syncDiagnostics)).toBeDefined();
    expect(Reflect.getMetadata("__guards__", SupportController.prototype.syncDiagnosticsConfig)).toBeDefined();
    const keys = Reflect.getMetadataKeys(AdminController.prototype.memberSyncDiagnostics);
    const roles = keys.map(k => Reflect.getMetadata(k, AdminController.prototype.memberSyncDiagnostics)).find(v => Array.isArray(v) && v.includes("SUPER_ADMIN"));
    expect(roles).toEqual(["SUPER_ADMIN", "APP_OPERATIONS"]);
  });
});
