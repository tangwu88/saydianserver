import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminHealthReportsService } from "./admin-health-reports.service";
import { AdminHealthReportsController } from "./admin-health-reports.controller";
import { HealthReportsService } from "../reports/health-reports.service";

const memberId = "11111111-1111-4111-8111-111111111111";
const reportId = "22222222-2222-4222-8222-222222222222";
const current = { id: "synthetic-admin", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };
const request = { memberId, idempotencyKey: "synthetic-request-0001" };

function harness(initialCredits = 1) {
  let state: any = { reports: [], keys: [], credits: initialCredits, ledgers: [], outbox: [], audits: [] };
  const records = [1, 2, 3].map(day => ({ id: `synthetic-${day}`, metric: "HEART_RATE", observedAt: new Date(Date.now() - day * 86_400_000), timezoneOffsetMinutes: 0, values: { bpm: 65 + day }, quality: "VALID", sourceModel: "TEST", ecgArtifact: null }));
  const db: any = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    user: { findUnique: vi.fn().mockResolvedValue({ status: "ACTIVE", locale: "en" }) },
    healthProfile: { findUnique: vi.fn().mockResolvedValue({ analysisConsentedAt: new Date(), analysisConsentWithdrawn: null, analysisConsentVersion: "reviewed-test" }) },
    globalLegalDocument: { findMany: vi.fn().mockResolvedValue([{ version: "reviewed-test", locale: "en", contentHtml: "Synthetic reviewed notice" }]) },
    healthRecord: { findMany: vi.fn().mockResolvedValue(records) },
    healthMembership: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null), aggregate: vi.fn().mockResolvedValue({ _sum: { remainingCredits: 0 } }) },
    reportCreditLedger: {
      aggregate: vi.fn(async () => ({ _sum: { delta: state.credits } })),
      findUnique: vi.fn(async ({ where }: any) => state.ledgers.find((r: any) => r.idempotencyKey === where.idempotencyKey)),
      create: vi.fn(async ({ data }: any) => { state.ledgers.push(data); state.credits += data.delta; return data; }),
    },
    integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: "CONFIGURED", publicConfig: { provider: "synthetic-openai-compatible" } }) },
    integrationSecret: { findUnique: vi.fn().mockResolvedValue(null) },
    healthReport: {
      findFirst: vi.fn(async ({ where }: any) => [...state.reports].reverse().find((r: any) => (!where.userId || r.userId === where.userId) && (!where.id || r.id === where.id) && (!where.inputDigest || r.inputDigest === where.inputDigest) && (!where.status || where.status.in.includes(r.status)))),
      findUnique: vi.fn(async ({ where }: any) => state.reports.find((r: any) => r.id === where.id)),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => state.reports.find((r: any) => r.id === where.id)),
      create: vi.fn(async ({ data }: any) => { const r = { ...data, id: reportId, status: "AWAITING_PAYMENT", createdAt: new Date(), generatedAt: null, aiGenerated: false }; state.reports.push(r); return r; }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.reports.find((r: any) => r.id === where.id), data)),
    },
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: any) => state.keys.find((r: any) => r.userId === where.userId_scope_key.userId && r.scope === where.userId_scope_key.scope && r.key === where.userId_scope_key.key)),
      create: vi.fn(async ({ data }: any) => { state.keys.push(data); return data; }),
    },
    outboxEvent: { upsert: vi.fn(async ({ create }: any) => { state.outbox.push(create); return create; }) },
    auditLog: { create: vi.fn(async ({ data }: any) => { state.audits.push(data); return data; }) },
  };
  // Serial synthetic transactions model the member lock and rollback; the SQL
  // assertion below ensures production uses a database, not process-local lock.
  let tail = Promise.resolve();
  db.$transaction = vi.fn((run: any) => {
    const result = tail.then(async () => { const before = structuredClone(state); try { return await run(db); } catch (error) { state = before; throw error; } });
    tail = result.then(() => undefined, () => undefined); return result;
  });
  const secrets = { resolve: vi.fn().mockResolvedValue({ apiKey: "SYNTHETIC-NOT-A-KEY", baseUrl: "https://provider.invalid" }) };
  const reports = new HealthReportsService(db);
  return { db, secrets, reports, service: new AdminHealthReportsService(db, reports, secrets as any), get state() { return state; } };
}

beforeEach(() => {
  for (const [name, value] of Object.entries({ APP_REALM: "global", WORKER_OUTBOUND_PAUSED: "false", BUSINESS_WRITES_PAUSED: "false", MAINTENANCE_READ_ONLY: "false", H5_DEMO_ENABLED: "false", AI_PROVIDER: "disabled" })) vi.stubEnv(name, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Third-party calls are forbidden in these tests"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("international admin health-report availability", () => {
  it("returns public Chinese readiness without credentials or health record values", async () => {
    const h = harness(); const result = await h.service.availability(memberId, current);
    expect(result).toMatchObject({ canGenerate: true, reasons: [], validRecordCount: 3, distinctDays: 3, minimumDistinctDays: 3, consentRequired: false, availableCredits: 1, latestReport: null });
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC-NOT-A-KEY|provider.invalid|bpm|recordIds/);
  });
  it.each(["WORKER_OUTBOUND_PAUSED", "BUSINESS_WRITES_PAUSED", "MAINTENANCE_READ_ONLY"])("blocks %s without creating or consuming", async flag => {
    vi.stubEnv(flag, "true"); const h = harness();
    expect((await h.service.availability(memberId, current)).reasons).toContainEqual(expect.objectContaining({ code: "worker_paused" }));
    await expect(h.service.create(request, current)).rejects.toMatchObject({ response: expect.objectContaining({ errorKey: "health_report_unavailable" }), status: 409 });
    expect(h.state).toMatchObject({ reports: [], outbox: [], credits: 1 });
  });
  it.each(["member", "data", "consent", "outdated", "notice", "credits", "provider", "credentials", "demo"])("fails closed for %s", async scenario => {
    const h = harness(scenario === "credits" ? 0 : 1);
    if (scenario === "member") h.db.user.findUnique.mockResolvedValue({ status: "FROZEN", locale: "en" });
    if (scenario === "data") h.db.healthRecord.findMany.mockResolvedValue([]);
    if (scenario === "consent") h.db.healthProfile.findUnique.mockResolvedValue(null);
    if (scenario === "outdated") h.db.globalLegalDocument.findMany.mockResolvedValue([{ version: "new-version", locale: "en", contentHtml: "Test" }]);
    if (scenario === "notice") h.db.globalLegalDocument.findMany.mockResolvedValue([]);
    if (scenario === "provider") h.db.integrationConfig.findUnique.mockResolvedValue({ state: "UNCONFIGURED" });
    if (scenario === "credentials") h.secrets.resolve.mockRejectedValue(new Error("secret read failed"));
    if (scenario === "demo") vi.stubEnv("H5_DEMO_ENABLED", "true");
    expect((await h.service.availability(memberId, current)).canGenerate).toBe(false);
    await expect(h.service.create(request, current)).rejects.toMatchObject({ status: 409 });
    expect(h.state).toMatchObject({ reports: [], outbox: [], ledgers: [] });
  });
  it("enforces current roles, global scope and valid member IDs before data access", async () => {
    const h = harness();
    await expect(h.service.availability(memberId, { ...current, roles: ["READ_ONLY"] })).rejects.toMatchObject({ status: 403 });
    await expect(h.service.availability("not-a-uuid", current)).rejects.toMatchObject({ status: 400 });
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
    h.db.user.findUnique.mockResolvedValue(null);
    await expect(h.service.availability(memberId, current)).rejects.toMatchObject({ status: 404 });
    vi.stubEnv("APP_REALM", "domestic");
    await expect(h.service.availability(memberId, current)).rejects.toMatchObject({ status: 404 });
  });
  it.each(["http://provider.invalid", "https://user:password@provider.invalid", "not-a-url"])("rejects an unsafe AI endpoint without external probes: %s", async baseUrl => {
    const h = harness(); h.secrets.resolve.mockResolvedValue({ apiKey: "SYNTHETIC", baseUrl });
    expect((await h.service.availability(memberId, current)).reasons).toContainEqual(expect.objectContaining({ code: "ai_credentials_unavailable" }));
    await expect(h.service.create(request, current)).rejects.toMatchObject({ status: 409 });
    expect(h.state.reports).toHaveLength(0);
  });
});

describe("atomic report creation and admin read", () => {
  it("serializes concurrent admin keys and consumer creation for one snapshot, consuming exactly once", async () => {
    const h = harness();
    const result = await Promise.all([h.service.create(request, current), h.service.create({ ...request, idempotencyKey: "different-admin-key" }, current), h.reports.create(memberId)]);
    expect(result[0]).toMatchObject({ report: { id: reportId, status: "queued", needsPayment: false } });
    expect(result[1]).toMatchObject({ report: { id: reportId, status: "queued", needsPayment: false } });
    expect(result[2]).toMatchObject({ id: reportId, status: "queued", needsPayment: false });
    expect(result[2]).not.toHaveProperty("reused");
    expect(h.state).toMatchObject({ credits: 0 });
    expect(h.state.reports).toHaveLength(1); expect(h.state.ledgers).toHaveLength(1); expect(h.state.outbox).toHaveLength(1);
    expect(h.db.$executeRaw.mock.calls[0]![0].join("")).toContain("pg_advisory_xact_lock");
    expect(h.db.$executeRaw.mock.calls[0]![1]).toBe(`health-report-create:${memberId}`);
    expect(h.db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(h.db.healthReport.create.mock.invocationCallOrder[0]);
  });
  it("returns the same keyed report without a second credit and rechecks withdrawn consent", async () => {
    const h = harness(); expect(await h.service.create(request, current)).toMatchObject({ reused: false });
    expect(await h.service.create(request, current)).toMatchObject({ reused: true, report: { id: reportId } });
    h.db.healthProfile.findUnique.mockResolvedValue({ analysisConsentedAt: new Date(), analysisConsentWithdrawn: new Date(), analysisConsentVersion: "reviewed-test" });
    await expect(h.service.create(request, current)).rejects.toMatchObject({ status: 409 });
    expect(h.state.ledgers).toHaveLength(1);
  });
  it("resolves credentials before taking a transaction connection, without nested secret pool queries", async () => {
    const h = harness(); await h.service.create(request, current);
    expect(h.secrets.resolve).toHaveBeenCalledOnce();
    expect(h.secrets.resolve.mock.invocationCallOrder[0]).toBeLessThan(h.db.$executeRaw.mock.invocationCallOrder[0]);
  });
  it("refuses a credentials snapshot if its configuration changed before the transaction", async () => {
    const h = harness();
    h.db.integrationSecret.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ updatedAt: new Date() });
    await expect(h.service.create(request, current)).rejects.toThrow("配置已变更");
    expect(h.state).toMatchObject({ reports: [], credits: 1, outbox: [], ledgers: [] });
  });
  it("rolls back report, credit and outbox when audit persistence fails", async () => {
    const h = harness(); h.db.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(h.service.create(request, current)).rejects.toThrow("audit unavailable");
    expect(h.state).toMatchObject({ reports: [], keys: [], credits: 1, ledgers: [], outbox: [] });
  });
  it("preserves the consumer awaiting-payment shape without credits and does not expose admin bypass inputs", async () => {
    const h = harness(0); expect(await h.reports.create(memberId)).toMatchObject({ status: "awaiting_payment", needsPayment: true });
    expect(h.state.outbox).toHaveLength(0);
    await expect(h.service.create({ ...request, granted: true }, current)).rejects.toMatchObject({ status: 400 });
    await expect(h.service.create({ ...request, idempotencyKey: "short" }, current)).rejects.toMatchObject({ status: 400 });
  });
  it("queues an existing unpaid report only with a real available credit", async () => {
    const h = harness(0); await h.reports.create(memberId); h.state.credits = 1;
    expect(await h.service.create(request, current)).toMatchObject({ reused: true, report: { status: "queued", needsPayment: false } });
    expect(h.state.credits).toBe(0); expect(h.state.reports).toHaveLength(1);
  });
  it("returns audited ready content, never raw evidence or internal failure details", async () => {
    const h = harness(); await h.service.create(request, current);
    Object.assign(h.state.reports[0], { status: "READY", fullContent: { overview: "Synthetic reference only" }, aiGenerated: true });
    expect(await h.service.detail(reportId, current, "test-read")).toMatchObject({ id: reportId, memberId, status: "ready", content: { overview: "Synthetic reference only" } });
    expect(await h.service.detail(reportId, current)).not.toHaveProperty("evidence");
    h.db.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    await expect(h.service.detail(reportId, current)).rejects.toThrow("audit unavailable");
  });
  it("keeps report content absent for revoked/failed states and checks authorization", async () => {
    const h = harness(); await h.service.create(request, current);
    Object.assign(h.state.reports[0], { status: "REVOKED", fullContent: { sensitive: true } });
    expect(await h.service.detail(reportId, current)).not.toHaveProperty("content");
    await expect(h.service.detail(reportId, { ...current, roles: ["CUSTOMER_SERVICE"] })).rejects.toMatchObject({ status: 403 });
    expect(Reflect.getMetadata("saydian.admin-roles", AdminHealthReportsController)).toEqual(["SUPER_ADMIN", "HEALTH_AUDITOR"]);
  });
});
