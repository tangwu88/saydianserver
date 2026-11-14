import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../common/prisma.service";

// A bounded private slot reuses Feedback storage, never ordinary user feedback.
// No migration, raw logs, addresses, record IDs, readings or arbitrary messages.
export const syncDiagnosticCategory = "say_ring_sync_diagnostics_v1";
export const diagnosticMetrics = ["heart_rate", "blood_oxygen", "body_temperature", "hrv", "stress", "sleep", "steps", "distance", "calories", "blood_pressure", "ecg", "blood_glucose"] as const;
export const diagnosticStages = ["connect", "initialization", "capabilities", "read", "persist", "upload", "recover"] as const;
export const diagnosticStates = ["pending", "ok", "partial", "failed", "blocked", "empty"] as const;
export const diagnosticCodes = ["none", "unknown", "not_connected", "connection_lost", "connect_failed", "initialization_pending", "decision_unknown", "clear_requested", "clear_acknowledged", "capabilities_missing", "read_timeout", "read_partial", "no_data", "save_failed", "upload_failed", "upload_rejected", "unsupported_metric", "record_conflict", "invalid_record", "network_error", "auth_expired", "backend_unavailable", "busy", "cancelled"] as const;
const diagnosticV2Codes = [...diagnosticCodes, "bluetooth_off", "bluetooth_permission", "connection_timeout", "handshake_failed"];
const models = ["R7Pro", "R7Ultra", "R7", "R7p", "R8", "R8Pro", "R21", "R22", "HR01", "HR05", "K80", "U19", "U19S", "U19M", "other", "unknown"];
type Stage = { stage: string; state: string; code: string; elapsedMs: number; received?: number; saved?: number; uploaded?: number; rejected?: number };
export type SyncDiagnosticReport = {
  schemaVersion: 1 | 2; product: "say-ring"; reportId: string; connectionId: string;
  mode: "automatic" | "manual" | "recovery"; platform: "android" | "ios" | "harmonyos";
  appVersion: string; buildNumber: number; sdk: string; model: string; firmware?: string; osMajor?: number;
  connectionState: string; initializationState: string; capabilityState: string;
  metrics: string[]; stages: Stage[];
  phone?: {brand?:string; modelId?:string; modelName?:string; osVersion?:string; osBuild?:string; apiLevel?:number; locale?:string};
  connectionKind?: "explicit" | "automatic_recovery" | "first";
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
  const versionTwo = (input as {schemaVersion?:unknown} | null)?.schemaVersion === 2;
  const b = object(input, ["schemaVersion", "product", "reportId", "connectionId", "mode", "platform", "appVersion", "buildNumber", "sdk", "model", "firmware", "osMajor", "connectionState", "initializationState", "capabilityState", "metrics", "stages", ...(versionTwo ? ["phone","connectionKind"] : [])]);
  if ((b.schemaVersion !== 1 && b.schemaVersion !== 2) || b.product !== "say-ring" || typeof b.reportId !== "string" || !uuid.test(b.reportId) || typeof b.connectionId !== "string" || !uuid.test(b.connectionId)) throw new BadRequestException("诊断产品或版本无效");
  if (typeof b.appVersion !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(b.appVersion)) throw new BadRequestException("应用版本无效");
  if (b.firmware !== undefined && (typeof b.firmware !== "string" || !/^\d[\d.]{0,31}$/.test(b.firmware))) throw new BadRequestException("设备版本无效");
  if (!Array.isArray(b.metrics) || b.metrics.length > diagnosticMetrics.length || !Array.isArray(b.stages) || b.stages.length > 16) throw new BadRequestException("诊断摘要无效");
  const stages = b.stages.map(input => {
    const s = object(input, ["stage", "state", "code", "elapsedMs", "received", "saved", "uploaded", "rejected"]);
    return { stage: choice(s.stage, diagnosticStages), state: choice(s.state, diagnosticStates), code: choice(s.code, versionTwo ? diagnosticV2Codes : diagnosticCodes), elapsedMs: count(s.elapsedMs, 3_600_000), ...Object.fromEntries(["received", "saved", "uploaded", "rejected"].filter(k => s[k] !== undefined).map(k => [k, count(s[k])])) };
  });
  return {
    schemaVersion: versionTwo ? 2 : 1, product: "say-ring", reportId: b.reportId, connectionId: b.connectionId,
    mode: choice(b.mode, ["automatic", "manual", "recovery"]) as SyncDiagnosticReport["mode"],
    platform: choice(b.platform, ["android", "ios", "harmonyos"]) as SyncDiagnosticReport["platform"],
    appVersion: b.appVersion, buildNumber: count(b.buildNumber, 2_147_483_647),
    sdk: choice(b.sdk, ["coolwear", "qring", "yucheng", "veepoo", "urion", "unknown"]), model: choice(b.model, models),
    ...(b.firmware === undefined ? {} : { firmware: b.firmware as string }), ...(b.osMajor === undefined ? {} : { osMajor: count(b.osMajor, 100) }),
    connectionState: choice(b.connectionState, ["disconnected", "scanning", "connecting", "authenticating", "syncing", "ready", "error"]),
    initializationState: choice(b.initializationState, ["ready", "decision_required", "decision_unknown", "reset_attempted", "history_clear_acknowledged", "native_pending", "unavailable"]),
    capabilityState: choice(b.capabilityState, ["disconnected", "loading", "ready", "unavailable"]),
    metrics: [...new Set(b.metrics.map(v => choice(v, diagnosticMetrics)))].sort(), stages,
    ...(b.phone === undefined ? {} : {phone: parsePhone(b.phone, b.platform)}),
    ...(b.connectionKind === undefined ? {} : {connectionKind: choice(b.connectionKind, ["explicit","automatic_recovery","first"]) as NonNullable<SyncDiagnosticReport["connectionKind"]>}),
  };
}

const phoneFields = {
  brand: /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]{0,39}$/u,
  modelId: /^[A-Za-z0-9][A-Za-z0-9 ,._+()-]{0,63}$/,
  modelName: /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]{0,63}$/u,
  osVersion: /^\d{1,3}(?:\.\d{1,4}){0,4}(?:[ -][A-Za-z0-9]{1,12})?$/,
  osBuild: /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/,
  locale: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/,
} as const;

function parsePhone(value: unknown, platform: unknown): NonNullable<SyncDiagnosticReport["phone"]> {
  const body = object(value,[...Object.keys(phoneFields),"apiLevel"]);
  const phone: NonNullable<SyncDiagnosticReport["phone"]> = {};
  for (const key of Object.keys(phoneFields) as (keyof typeof phoneFields)[]) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !phoneFields[key].test(v) || /[0-9]{11,}/.test(v)) throw new BadRequestException("手机诊断字段无效");
    phone[key]=v;
  }
  if (body.apiLevel !== undefined) {
    if (platform !== "android") throw new BadRequestException("手机平台字段无效");
    phone.apiLevel=count(body.apiLevel,200);
  }
  return phone;
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
export async function submitSyncDiagnostic(prisma: PrismaService, userId: string, input: unknown, now = new Date()) {
  const report = parseSyncDiagnostic(input);
  return prisma.$transaction(async tx => {
    // Serialize one member's bounded slot/rate limit across API instances.
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!users.length) throw new NotFoundException("会员不存在");
    const slot = await tx.feedback.findFirst({ where: { userId, category: syncDiagnosticCategory }, select: { id: true, content: true }, orderBy: { createdAt: "desc" } });
    const reports = decodeDiagnosticSlot(slot?.content);
    if (reports.some(r => r.report.reportId === report.reportId)) return { accepted: true, reportId: report.reportId, duplicate: true };
    const recent = reports.filter(r => now.getTime() - Date.parse(r.receivedAt) < 3_600_000);
    if (recent.length >= 4) return { accepted: false, reportId: report.reportId, reason: "rate_limited", retryAfterSeconds: Math.max(60, Math.ceil((Date.parse(recent[recent.length - 1]!.receivedAt) + 3_600_000 - now.getTime()) / 1000)) };
    const content = JSON.stringify({ schemaVersion: 1, reports: [{ receivedAt: now.toISOString(), report }, ...reports].slice(0, 5) });
    if (slot) await tx.feedback.update({ where: { id: slot.id }, data: { content } });
    else await tx.feedback.create({ data: { userId, category: syncDiagnosticCategory, content, contact: null, attachments: [] } });
    return { accepted: true, reportId: report.reportId, duplicate: false };
  });
}
export async function memberSyncDiagnostics(prisma: PrismaService, userId: string) {
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!member) throw new NotFoundException("会员不存在");
  const slot = await prisma.feedback.findFirst({ where: { userId, category: syncDiagnosticCategory }, select: { content: true }, orderBy: { createdAt: "desc" } });
  return { reports: decodeDiagnosticSlot(slot?.content), maximumReports: 5 };
}
