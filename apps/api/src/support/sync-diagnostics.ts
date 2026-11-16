import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RING_BINDING_DECISION_SCOPE, readRingBindingDecision } from "../devices/ring-binding-decision";
import type { PrismaService } from "../common/prisma.service";

// A bounded private slot reuses Feedback storage, never ordinary user feedback.
// No migration, raw logs, addresses, record IDs, readings or arbitrary messages.
export const syncDiagnosticCategory = "say_ring_sync_diagnostics_v1";
export const diagnosticMetrics = ["heart_rate", "blood_oxygen", "body_temperature", "hrv", "stress", "sleep", "steps", "distance", "calories", "blood_pressure", "ecg", "blood_glucose"] as const;
export const diagnosticStages = ["connect", "initialization", "capabilities", "read", "persist", "upload", "recover"] as const;
export const diagnosticStates = ["pending", "ok", "partial", "failed", "blocked", "empty"] as const;
export const diagnosticCodes = ["none", "unknown", "not_connected", "connection_lost", "connect_failed", "initialization_pending", "decision_unknown", "clear_requested", "clear_acknowledged", "capabilities_missing", "read_timeout", "read_partial", "no_data", "save_failed", "upload_failed", "upload_rejected", "unsupported_metric", "record_conflict", "invalid_record", "network_error", "auth_expired", "backend_unavailable", "busy", "cancelled"] as const;
const models = ["R7Pro", "R7Ultra", "R7", "R7p", "R8", "R8Pro", "R21", "R22", "HR01", "HR05", "K80", "U19", "U19S", "U19M", "other", "unknown"];
type Stage = { stage: string; state: string; code: string; elapsedMs: number; received?: number; saved?: number; uploaded?: number; rejected?: number };
export type SyncDiagnosticReport = {
  schemaVersion: 1; product: "say-ring"; reportId: string; connectionId: string;
  mode: "automatic" | "manual" | "recovery" | "first_connection"; platform: "android" | "ios" | "harmonyos";
  appVersion: string; buildNumber: number; sdk: string; model: string; firmware?: string; osMajor?: number; osVersion?: string;
  connectionState: string; initializationState: string; capabilityState: string;
  metrics: string[]; stages: Stage[];
};
type StoredReport = { receivedAt: string; report: SyncDiagnosticReport };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !keys.includes(k))) throw new BadRequestException("诊断包含不支持的字段");
  return input as Record<string, unknown>;
}
function choice(input: unknown, values: readonly string[]): string {
  if (typeof input !== "string" || !values.includes(input)) throw new BadRequestException("诊断状态无效");
  return input;
}
function count(input: unknown, maximum = 1_000_000): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input > maximum) throw new BadRequestException("诊断数量无效");
  return input;
}
export function parseSyncDiagnostic(input: unknown): SyncDiagnosticReport {
  if (Buffer.byteLength(JSON.stringify(input) ?? "", "utf8") > 4096) throw new BadRequestException("诊断摘要过大");
  const b = object(input, ["schemaVersion", "product", "reportId", "connectionId", "mode", "platform", "appVersion", "buildNumber", "sdk", "model", "firmware", "osMajor", "osVersion", "connectionState", "initializationState", "capabilityState", "metrics", "stages"]);
  if (b.schemaVersion !== 1 || b.product !== "say-ring" || typeof b.reportId !== "string" || !uuid.test(b.reportId) || typeof b.connectionId !== "string" || !uuid.test(b.connectionId)) throw new BadRequestException("诊断产品或版本无效");
  if (typeof b.appVersion !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(b.appVersion)) throw new BadRequestException("应用版本无效");
  if (b.firmware !== undefined && (typeof b.firmware !== "string" || !/^\d[\d.]{0,31}$/.test(b.firmware))) throw new BadRequestException("设备版本无效");
  if (b.osVersion !== undefined && (typeof b.osVersion !== "string" || !/^\d{1,2}(\.\d{1,4}){0,3}$/.test(b.osVersion))) throw new BadRequestException("系统版本无效");
  if (!Array.isArray(b.metrics) || b.metrics.length > diagnosticMetrics.length || !Array.isArray(b.stages) || b.stages.length > 16) throw new BadRequestException("诊断摘要无效");
  const stages = b.stages.map(input => {
    const s = object(input, ["stage", "state", "code", "elapsedMs", "received", "saved", "uploaded", "rejected"]);
    return { stage: choice(s.stage, diagnosticStages), state: choice(s.state, diagnosticStates), code: choice(s.code, diagnosticCodes), elapsedMs: count(s.elapsedMs, 3_600_000), ...Object.fromEntries(["received", "saved", "uploaded", "rejected"].filter(k => s[k] !== undefined).map(k => [k, count(s[k])])) };
  });
  return {
    schemaVersion: 1, product: "say-ring", reportId: b.reportId, connectionId: b.connectionId,
    mode: choice(b.mode, ["automatic", "manual", "recovery", "first_connection"]) as SyncDiagnosticReport["mode"],
    platform: choice(b.platform, ["android", "ios", "harmonyos"]) as SyncDiagnosticReport["platform"],
    appVersion: b.appVersion, buildNumber: count(b.buildNumber, 2_147_483_647),
    sdk: choice(b.sdk, ["coolwear", "qring", "yucheng", "veepoo", "urion", "unknown"]), model: choice(b.model, models),
    ...(b.firmware === undefined ? {} : { firmware: b.firmware as string }), ...(b.osMajor === undefined ? {} : { osMajor: count(b.osMajor, 100) }), ...(b.osVersion === undefined ? {} : { osVersion: b.osVersion as string }),
    connectionState: choice(b.connectionState, ["disconnected", "scanning", "connecting", "authenticating", "measuring", "syncing", "ready", "error"]),
    initializationState: choice(b.initializationState, ["ready", "decision_required", "decision_unknown", "reset_attempted", "history_clear_acknowledged", "native_pending", "unavailable"]),
    capabilityState: choice(b.capabilityState, ["disconnected", "loading", "ready", "unavailable"]),
    metrics: [...new Set(b.metrics.map(v => choice(v, diagnosticMetrics)))].sort(), stages,
  };
}
export function decodeDiagnosticSlot(content: string | undefined): StoredReport[] {
  try {
    const value = JSON.parse(content ?? "null");
    if (!Array.isArray(value?.reports) || value.reports.length > 5) return [];
    return value.reports.flatMap((row: any) => {
      try { if (typeof row.receivedAt !== "string" || !Number.isFinite(Date.parse(row.receivedAt))) return []; return [{ receivedAt: row.receivedAt, report: parseSyncDiagnostic(row.report) }]; } catch { return []; }
    });
  } catch { return []; }
}
type Collection = { connectionId: string; startedAt: string };
function readCollection(content?: string): Collection | null {
  try {
    const value = JSON.parse(content ?? "null")?.collection;
    if (!value || !uuid.test(value.connectionId) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) return null;
    return { connectionId: value.connectionId, startedAt: value.startedAt };
  } catch { return null; }
}

export async function beginFirstConnectionDiagnostic(prisma: PrismaService, userId: string, input: unknown, now = new Date()) {
  const body = object(input, ["product", "connectionId", "firstBindingOperationId"]);
  if (body.product !== "say-ring" || typeof body.connectionId !== "string" || !uuid.test(body.connectionId) ||
      (body.firstBindingOperationId !== undefined && (typeof body.firstBindingOperationId !== "string" || !uuid.test(body.firstBindingOperationId)))) throw new BadRequestException("首次连接摘要标识无效");
  const connectionId = body.connectionId;
  return prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!users.length) throw new NotFoundException("会员不存在");
    const slot = await tx.feedback.findFirst({ where: { userId, category: syncDiagnosticCategory }, select: { id: true, content: true }, orderBy: { createdAt: "desc" } });
    const collection = readCollection(slot?.content);
    if (collection) return { accepted: collection.connectionId === connectionId, connectionId, ...(collection.connectionId === connectionId ? {} : { reason: "already_started" }) };
    if (decodeDiagnosticSlot(slot?.content).length) return { accepted: false, connectionId, reason: "already_reported" };
    const bindings = await tx.deviceBinding.count({ where: { userId } });
    let genuineFirstBinding = false;
    if (bindings === 1 && typeof body.firstBindingOperationId === "string") {
      // Read the existing first-binding decision only. Never call bind/clear or
      // create another initialization authorization for diagnostic purposes.
      const record = await tx.idempotencyRecord.findUnique({ where: { userId_scope_key: { userId, scope: RING_BINDING_DECISION_SCOPE, key: body.firstBindingOperationId } } });
      const raw = record?.responseBody;
      const deviceId = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>).deviceId : undefined;
      if (record && typeof deviceId === "string") {
        try { genuineFirstBinding = readRingBindingDecision(record, userId, deviceId, body.firstBindingOperationId).decision === "clear-issued"; } catch { /* Invalid proof cannot open collection. */ }
      }
    }
    if (bindings !== 0 && !genuineFirstBinding) return { accepted: false, connectionId, reason: "has_binding_history" };
    const content = JSON.stringify({ schemaVersion: 2, collection: { connectionId, startedAt: now.toISOString() }, reports: [] });
    if (slot) await tx.feedback.update({ where: { id: slot.id }, data: { content } });
    else await tx.feedback.create({ data: { userId, category: syncDiagnosticCategory, content, contact: null, attachments: [] } });
    return { accepted: true, connectionId };
  });
}

export async function submitSyncDiagnostic(prisma: PrismaService, userId: string, input: unknown, now = new Date()) {
  const report = parseSyncDiagnostic(input);
  if (report.mode !== "first_connection") return { accepted: false, reportId: report.reportId, reason: "first_connection_only" };
  return prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!users.length) throw new NotFoundException("会员不存在");
    const slot = await tx.feedback.findFirst({ where: { userId, category: syncDiagnosticCategory }, select: { id: true, content: true }, orderBy: { createdAt: "desc" } });
    const collection = readCollection(slot?.content);
    if (!slot || !collection || collection.connectionId !== report.connectionId) return { accepted: false, reportId: report.reportId, reason: "collection_not_active" };
    const reports = decodeDiagnosticSlot(slot.content);
    const previous = reports.find(r => r.report.reportId === report.reportId);
    if (previous) {
      const same = JSON.stringify(previous.report) === JSON.stringify(report);
      return { accepted: same, reportId: report.reportId, ...(same ? { duplicate: true } : { reason: "report_conflict" }) };
    }
    if (reports.length) return { accepted: false, reportId: report.reportId, reason: "already_reported" };
    await tx.feedback.update({ where: { id: slot.id }, data: { content: JSON.stringify({ schemaVersion: 2, collection, reports: [{ receivedAt: now.toISOString(), report }] }) } });
    return { accepted: true, reportId: report.reportId, duplicate: false };
  });
}
export async function memberSyncDiagnostics(prisma: PrismaService, userId: string) {
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!member) throw new NotFoundException("会员不存在");
  const slot = await prisma.feedback.findFirst({ where: { userId, category: syncDiagnosticCategory }, select: { content: true }, orderBy: { createdAt: "desc" } });
  return { reports: decodeDiagnosticSlot(slot?.content), maximumReports: 5, firstConnectionOnly: true, collection: readCollection(slot?.content) };
}
