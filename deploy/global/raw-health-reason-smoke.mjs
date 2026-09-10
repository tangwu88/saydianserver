// Opt-in international QA. Never reads an existing member's health records.
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-roles"), "Synthetic-role opt-in required");
assert(process.env.APP_REALM === "global");
assert(new URL(process.env.DATABASE_URL).pathname === "/saydian_global");
setDefaultResultOrder("ipv4first");
const require = createRequire("/workspace/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const prisma = new PrismaClient();
const marker = `qa-raw-health-${randomUUID()}`;
const email = marker + "@example.invalid";
const token = randomBytes(32).toString("hex");
const origin = "https://app.saydian.cn/global/api/saydian-app/admin/v1";
let member;
let admin;
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
async function read(query = "", expected = 200) {
  const response = await fetch(`${origin}/members/${member.id}/health-records${query}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  check(response.status === expected, `Expected HTTP ${expected}, got ${response.status}`);
  if (expected !== 200) check(!Array.isArray(result.data), "Denied requests must not return records");
  else check(Array.isArray(result.data) && result.data.length === 0, "Only this synthetic empty member may be read");
  return result;
}
async function verifyAudit(result, source, reason) {
  const audit = await prisma.auditLog.findFirst({ where: {
    actorId: admin.id, entityId: member.id, action: "HEALTH_RAW_READ", requestId: result.requestId,
  } });
  check(audit?.afterJson?.reasonSource === source && audit.afterJson.recordCount === 0, "Every successful read must retain audit source and count");
  if (reason) check(audit.afterJson.reason === reason, "The supplied reason must be retained");
}
async function reportRequest(path, expected, body) {
  const response = await fetch(`${origin}/health-reports${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  check(response.status === expected, `Report endpoint expected HTTP ${expected}, got ${response.status}`);
  return result;
}
try {
  member = await prisma.user.create({ data: { email, nickname: marker, locale: "en" } });
  admin = await prisma.adminUser.create({ data: {
    username: marker, displayName: marker, passwordHash: await hash(randomBytes(32).toString("hex"), 12),
    role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"],
    sessions: { create: { tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 300_000) } },
  } });
  await verifyAudit(await read(), "SUPER_ADMIN_EXEMPTION", "超级管理员直接查看（免填原因）");
  const availability = await reportRequest(`/${"availability"}?memberId=${member.id}`, 200);
  check(availability.data.canGenerate === false, "Synthetic member cannot generate a real AI report");
  for (const code of ["insufficient_data", "consent_required", "credits_required", "ai_unconfigured", "worker_paused"]) {
    check(availability.data.reasons.some(reason => reason.code === code), `Real report gate must expose ${code}`);
  }
  check(!/apiKey|api_key|secret|baseUrl/.test(JSON.stringify(availability.data)), "Public availability must not contain provider credentials");
  await reportRequest("", 409, { memberId: member.id, idempotencyKey: randomUUID() });
  check(await prisma.healthReport.count({ where: { userId: member.id } }) === 0, "Blocked generation must not create a report");
  check(await prisma.reportCreditLedger.count({ where: { userId: member.id } }) === 0, "Blocked generation must not create credit movements");
  await prisma.adminUser.update({ where: { id: admin.id }, data: { role: "SUPER_ADMIN", roles: ["HEALTH_AUDITOR"] } });
  await read("", 400);
  await read("?role=SUPER_ADMIN&reasonExempt=true", 400);
  await reportRequest(`/availability?memberId=${member.id}`, 200);
  const reason = "合成账号原始记录权限验证";
  await verifyAudit(await read("?reason=" + encodeURIComponent(reason)), "PROVIDED", reason);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { role: "HEALTH_AUDITOR", roles: ["HEALTH_AUDITOR", "SUPER_ADMIN"] } });
  await verifyAudit(await read(), "SUPER_ADMIN_EXEMPTION");
  await prisma.adminUser.update({ where: { id: admin.id }, data: { role: "SUPER_ADMIN", roles: ["READ_ONLY"] } });
  await read("?reason=" + encodeURIComponent(reason), 403);
  await reportRequest(`/availability?memberId=${member.id}`, 403);
  await reportRequest("", 403, { memberId: member.id, idempotencyKey: randomUUID() });
  await prisma.adminUser.update({ where: { id: admin.id }, data: { active: false } });
  await read("", 401);
  check(await prisma.auditLog.count({ where: { actorId: admin.id, entityId: member.id, action: "HEALTH_RAW_READ" } }) === 3,
    "Only the three accepted reads produced successful access audits");
} finally {
  // Keep access audit history; remove only the exact synthetic principal/member.
  if (admin) await prisma.adminUser.deleteMany({ where: { id: admin.id, username: marker } });
  if (member) await prisma.user.deleteMany({ where: { id: member.id, email } });
  const removed = await prisma.adminUser.count({ where: { username: marker } }) === 0
    && await prisma.user.count({ where: { email } }) === 0;
  await prisma.$disconnect();
  check(removed, "All synthetic accounts and cascading sessions must be removed");
  console.log(JSON.stringify({ checks, syntheticRemoved: removed, auditRetained: true }));
}
