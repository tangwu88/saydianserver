import { describe, expect, it, vi } from "vitest";
import { parseSyncDiagnostic, submitSyncDiagnostic, beginFirstConnectionDiagnostic, memberSyncDiagnostics, decodeDiagnosticSlot, syncDiagnosticCategory } from "./sync-diagnostics";
import { ringDecisionRequestHash } from "../devices/ring-binding-decision";
import { SupportService } from "./support.service";
import { AdminController } from "../admin/admin.controller";

function report(index = 1): any {
  return { schemaVersion: 1, product: "say-ring", reportId: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`, connectionId: "22222222-2222-4222-8222-222222222222", mode: "first_connection", platform: "android", appVersion: "1.0.14", buildNumber: 1307, sdk: "coolwear", model: "R7Pro", firmware: "819.0.1.0.0", connectionState: "ready", initializationState: "ready", capabilityState: "ready", metrics: ["heart_rate", "blood_oxygen"], stages: [{ stage: "read", state: "partial", code: "capabilities_missing", elapsedMs: 85000, received: 0 }] };
}
function harness() {
  const slots = new Map<string, any>();
  const feedback = {
    findFirst: vi.fn(async ({ where }: any) => slots.get(where.userId) ?? null),
    create: vi.fn(async ({ data }: any) => { const row = { id: data.userId, ...data }; slots.set(data.userId, row); return row; }),
    update: vi.fn(async ({ where, data }: any) => { const row = { ...slots.get(where.id), ...data }; slots.set(where.id, row); return row; }),
  };
  const bindingCount = vi.fn(async () => 0), decision = vi.fn(async (): Promise<any> => null);
  const tx = { feedback, deviceBinding: { count: bindingCount }, idempotencyRecord: { findUnique: decision }, $queryRaw: vi.fn(async () => [{ id: "member-a" }]) };
  let tail = Promise.resolve();
  const prisma = {
    feedback, user: { findUnique: vi.fn(async () => ({ id: "member-a" })) },
    $transaction: vi.fn((run: any) => { const next = tail.then(() => run(tx)); tail = next.catch(() => {}); return next; }),
  };
  return { prisma: prisma as any, feedback, slots, tx, bindingCount, decision };
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
    { firmware: "https://private.example/key" }, { osVersion: "private-system-build" }, { model: "R7Pro customer-name" },
    { metrics: ["unreviewed_private_metric"] }, { stages: [{ stage: "read", state: "failed", code: "secret-message", elapsedMs: 1 }] },
    { stages: [{ stage: "read", state: "failed", code: "unknown", elapsedMs: 1, value: 72 }] },
    { stages: [{ stage: "read", state: "failed", code: "unknown", elapsedMs: -1 }] },
    { stages: Array.from({ length: 17 }, () => report().stages[0]) },
  ])("rejects invalid shape %#", patch => expect(() => parseSyncDiagnostic({ ...report(), ...patch })).toThrow());

  const begin = (h: ReturnType<typeof harness>, owner = "member-a", connectionId = report().connectionId, extra: any = {}) => beginFirstConnectionDiagnostic(h.prisma, owner, { product: "say-ring", connectionId, ...extra });
  it("accepts only the new account's reserved first connection summary", async () => {
    const h = harness();
    expect(await begin(h)).toMatchObject({ accepted: true });
    expect(await submitSyncDiagnostic(h.prisma, "member-a", { ...report(), osVersion: "12.0", osMajor: 12 })).toMatchObject({ accepted: true });
    expect(h.feedback.create).toHaveBeenCalledTimes(1);
    expect(decodeDiagnosticSlot(h.slots.get("member-a").content)).toHaveLength(1);
    expect(h.feedback.create.mock.calls[0]![0].data).toMatchObject({ contact: null, attachments: [] });
    expect(await submitSyncDiagnostic(h.prisma, "member-a", report(2))).toMatchObject({ accepted: false, reason: "already_reported" });
    expect(await begin(h, "member-a", "33333333-3333-4333-8333-333333333333")).toMatchObject({ accepted: false });
  });
  it.each([1, 2, 10])("rejects lifetime binding history including unbound devices: %i", async count => {
    const h = harness(); h.bindingCount.mockResolvedValue(count);
    expect(await begin(h)).toMatchObject({ accepted: false, reason: "has_binding_history" });
    expect(h.bindingCount).toHaveBeenCalledWith({ where: { userId: "member-a" } });
    expect(h.feedback.create).not.toHaveBeenCalled();
  });
  it("does not collect again after reinstall or a different phone claims another ID", async () => {
    const h = harness(); await begin(h);
    expect(await begin(h)).toMatchObject({ accepted: true });
    expect(await begin(h, "member-a", "33333333-3333-4333-8333-333333333333")).toMatchObject({ accepted: false, reason: "already_started" });
    expect(h.feedback.create).toHaveBeenCalledOnce();
  });
  it("keeps the first immutable report idempotent but refuses changed payloads", async () => {
    const h = harness(); await begin(h); await submitSyncDiagnostic(h.prisma, "member-a", report());
    expect(await submitSyncDiagnostic(h.prisma, "member-a", report())).toMatchObject({ accepted: true, duplicate: true });
    expect(await submitSyncDiagnostic(h.prisma, "member-a", { ...report(), osMajor: 12 })).toMatchObject({ accepted: false, reason: "report_conflict" });
    expect(h.feedback.update).toHaveBeenCalledOnce();
  });
  it("serializes competing first reservations and accepts at most one report", async () => {
    const h = harness(), other = "33333333-3333-4333-8333-333333333333";
    const results = await Promise.all([begin(h), begin(h, "member-a", other)]);
    expect(results.filter(r => r.accepted)).toHaveLength(1);
    const writes = await Promise.all([submitSyncDiagnostic(h.prisma, "member-a", report()), submitSyncDiagnostic(h.prisma, "member-a", report(2))]);
    expect(writes.filter(r => r.accepted)).toHaveLength(1);
  });
  it.each(["manual", "automatic", "recovery"])("rejects legacy %s uploads without persisting new data", async mode => {
    const h = harness();
    expect(await submitSyncDiagnostic(h.prisma, "member-a", { ...report(), mode })).toMatchObject({ accepted: false, reason: "first_connection_only" });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("preserves legacy history but does not start another collection", async () => {
    const h = harness();
    h.slots.set("member-a", { id: "member-a", content: JSON.stringify({ schemaVersion: 1, reports: [{ receivedAt: new Date().toISOString(), report: { ...report(), mode: "automatic" } }] }) });
    expect(await begin(h)).toMatchObject({ accepted: false, reason: "already_reported" });
    expect((await memberSyncDiagnostics(h.prisma, "member-a")).reports).toHaveLength(1);
    expect(h.feedback.update).not.toHaveBeenCalled();
  });
  it("repairs the reservation/binding race only with a genuine existing first-binding receipt", async () => {
    const h = harness(), operationId = "44444444-4444-4444-8444-444444444444", deviceId = "qring:synthetic";
    h.bindingCount.mockResolvedValue(1);
    const { sha256 } = await import("../common/crypto");
    h.decision.mockResolvedValue({ responseCode: 200, requestHash: ringDecisionRequestHash("member-a", deviceId, operationId), responseBody: { schemaVersion: 1, ownerId: "member-a", hardwareKey: sha256(`member-a:${deviceId}`), product: "say-ring", deviceId, operationId, decision: "clear-issued" } });
    expect(await begin(h, "member-a", report().connectionId, { firstBindingOperationId: operationId })).toMatchObject({ accepted: true });
    expect(JSON.stringify(h.slots.get("member-a"))).not.toContain(deviceId);
    expect(JSON.stringify(h.slots.get("member-a"))).not.toContain(operationId);
  });
  it.each(["preserve", "wrong-owner", "wrong-hash", "multiple-bindings"])("cannot use invalid first-binding proof: %s", async failure => {
    const h = harness(), operationId = "44444444-4444-4444-8444-444444444444", deviceId = "qring:synthetic";
    const { sha256 } = await import("../common/crypto");
    h.bindingCount.mockResolvedValue(failure === "multiple-bindings" ? 2 : 1);
    h.decision.mockResolvedValue({ responseCode: 200, requestHash: failure === "wrong-hash" ? "bad" : ringDecisionRequestHash("member-a", deviceId, operationId), responseBody: { schemaVersion: 1, ownerId: failure === "wrong-owner" ? "member-b" : "member-a", hardwareKey: sha256(`member-a:${deviceId}`), product: "say-ring", deviceId, operationId, decision: failure === "preserve" ? "preserve" : "clear-issued" } });
    expect(await begin(h, "member-a", report().connectionId, { firstBindingOperationId: operationId })).toMatchObject({ accepted: false });
    expect(h.feedback.create).not.toHaveBeenCalled();
  });
  it("refuses reports without a matching first-connection reservation", async () => {
    const h = harness();
    expect(await submitSyncDiagnostic(h.prisma, "member-a", report())).toMatchObject({ accepted: false, reason: "collection_not_active" });
    await begin(h, "member-b");
    expect(await submitSyncDiagnostic(h.prisma, "member-a", report())).toMatchObject({ accepted: false });
  });
  it.each(["mobile", "token", "deviceId", "userId"])("rejects extra reservation field %s", async key => {
    const h = harness();
    await expect(begin(h, "member-a", report().connectionId, { [key]: "private" })).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("never returns another member's slot", async () => {
    const h = harness();
    await begin(h); await submitSyncDiagnostic(h.prisma, "member-a", report());
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
    expect(Reflect.getMetadata("__guards__", SupportController.prototype.beginFirstConnectionDiagnostics)).toBeDefined();
    const keys = Reflect.getMetadataKeys(AdminController.prototype.memberSyncDiagnostics);
    const roles = keys.map(k => Reflect.getMetadata(k, AdminController.prototype.memberSyncDiagnostics)).find(v => Array.isArray(v) && v.includes("SUPER_ADMIN"));
    expect(roles).toEqual(["SUPER_ADMIN", "APP_OPERATIONS"]);
  });
});
