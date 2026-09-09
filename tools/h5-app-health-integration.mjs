// Explicit opt-in. No production connections, provider calls, DB creation or process startup.
// All samples are generated SYSTEM-QA data, not measurements or medical advice.
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

assert.equal(process.env.RUN_H5_APP_HEALTH_ACCEPTANCE, "1", "Explicit RUN_H5_APP_HEALTH_ACCEPTANCE=1 required");
const [repoInput, profileInput] = process.argv.slice(2);
for (const value of [repoInput, profileInput]) assert.ok(value && isAbsolute(value) && !/^[\\/]{2}/.test(value), "Absolute local paths required; UNC is forbidden");
assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, "Remove injected Node startup configuration");
const repo = resolve(repoInput);
const { privateDemoPaths, validateDemoProfile } = await import(pathToFileURL(join(repo, "tools/h5-demo-profile.mjs")).href);
privateDemoPaths(repo, profileInput);
const settings = parseEnv(await readFile(profileInput, "utf8"));
validateDemoProfile(settings, repo, profileInput);
assert.equal(settings.MAINTENANCE_READ_ONLY, "false"); assert.equal(settings.BUSINESS_WRITES_PAUSED, "false");
assert.equal(settings.WORKER_OUTBOUND_PAUSED, "true"); assert.equal(settings.CALLBACK_PROCESSING_PAUSED, "true");
for (const key of Object.keys(process.env)) if (/^(WECHAT|WECOM|ALIPAY|SMS_|JUSHUITAN|OBJECT_STORAGE|APPLE_|PUSH_|AI_)/.test(key)) delete process.env[key];
for (const key of ["NODE_ENV", "H5_DEMO_ENABLED", "DATABASE_URL", "WORKER_OUTBOUND_PAUSED", "CALLBACK_PROCESSING_PAUSED"]) process.env[key] = settings[key];
const require = createRequire(join(repo, "apps/api/package.json"));
require(join(repo, "tools/h5-demo-network-guard.cjs"));
const { PrismaClient } = require("@prisma/client"), { hash } = require("bcryptjs");
const prisma = new PrismaClient();
const base = "http://127.0.0.1:8081", v2 = "/api/saydian-app/v2", admin = "/api/saydian-app/admin/v1";
const runId = randomUUID(), marker = `SYSTEM-QA-${runId}`, started = new Date();
const owned = { members: [], admins: [], categories: [], articles: [], campaigns: [], files: [] };
let assertions = 0, requests = 0, failure, lastAction = "preflight", cleanupVerified = false;
const summaries = [], abort = new AbortController();
process.once("SIGINT", () => abort.abort()); process.once("SIGTERM", () => abort.abort());
const truth = (value, message) => { assert.ok(value, message); assertions++; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const safeError = error => error instanceof assert.AssertionError ? error.message : "Local operation failed; internal diagnostics withheld";
async function http(path, { method = "GET", token, body, headers = {} } = {}) {
  const url = new URL(path, base);
  truth(url.origin === base && !url.username && !url.password, "HTTP target is exactly isolated API 8081");
  lastAction = `${method} ${url.pathname}`;
  const response = await fetch(url, { method, redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45_000)]),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  requests++;
  const text = await response.text();
  truth(!/PrismaClient|node_modules|postgres(?:ql)?:\/\/|-----BEGIN .* KEY-----/.test(text), "No internal diagnostics or secrets in API response");
  let json; try { json = JSON.parse(text); } catch { throw new Error(`${lastAction}: expected JSON, status ${response.status}`); }
  return { status: response.status, json, data: json.data };
}
async function ok(path, options) {
  const result = await http(path, options);
  truth(result.status >= 200 && result.status < 300, `${lastAction}: expected 2xx, got ${result.status}`);
  eq(result.json.code, 200, `${lastAction}: success envelope`);
  return result.data;
}
async function status(path, expected, options) { const result = await http(path, options); eq(result.status, expected, `${lastAction}: expected status`); return result; }
async function newMember(label) {
  let mobile;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `199${randomInt(10_000_000, 100_000_000)}`;
    if (!(await prisma.user.findUnique({ where: { mobile: candidate } })) && !(await prisma.smsCode.count({ where: { mobile: candidate } }))) { mobile = candidate; break; }
  }
  truth(mobile, "Fresh reserved synthetic mobile");
  const entry = { mobile, nickname: `${marker}-${label}` }; owned.members.push(entry);
  const password = `Qa-${randomBytes(18).toString("base64url")}!`;
  const registration = { mobile, password, nickname: entry.nickname, consentVersion: "SYSTEM-QA-synthetic-v1" };
  await status(`${v2}/auth/register`, 400, { method: "POST", body: registration });
  eq(await prisma.user.count({ where: { mobile } }), 0, "Unverified bare registration creates no account");
  const otp = await ok(`${v2}/auth/sms-code`, { method: "POST", body: { mobile, usage: "register" } });
  truth(/^\d{6}$/.test(otp.devCode ?? ""), "Local test OTP only; no SMS provider used");
  await status(`${v2}/auth/register-with-sms`, 400, { method: "POST", body: { ...registration, code: "000000" } });
  const session = await ok(`${v2}/auth/register-with-sms`, { method: "POST", body: { ...registration, code: otp.devCode } });
  entry.id = session.member.id; entry.token = session.accessToken;
  truth(entry.id && entry.token, "Real V2 session returned");
  const row = await prisma.user.findUniqueOrThrow({ where: { id: entry.id } });
  eq(row.nickname, entry.nickname, "API and scoped database are the same instance"); truth(row.mobileVerifiedAt, "SMS registration verifies mobile");
  const login = await ok(`${v2}/auth/login`, { method: "POST", body: { mobile, password } });
  eq(login.member.id, entry.id, "V2 password login retains canonical member");
  return entry;
}
async function newAdmin(role) {
  const username = `${marker}-${role}`;
  const password = `Qa-${randomBytes(18).toString("base64url")}!`;
  const row = await prisma.adminUser.create({ data: { username, displayName: username, role, roles: [role], passwordHash: await hash(password, 12) } });
  owned.admins.push({ id: row.id, username });
  const session = await ok(`${admin}/auth/login`, { method: "POST", body: { username, password } });
  eq(session.user.id, row.id, "Synthetic role session comes from the scoped DB");
  return { id: row.id, token: session.token };
}
const syntheticTime = "2026-01-02T00:00:00.000Z";
function record(id, metric = "heart_rate", values = { bpm: 72, unavailable: null }) {
  return { id: `${marker}-${id}`, metric, observedAt: syntheticTime, timezoneOffsetMinutes: 480,
    values, quality: "unknown", source: { platform: "migration", model: "SYSTEM-QA-SYNTHETIC-NOT-A-MEASUREMENT" } };
}
async function batch(member, key, records) {
  return ok(`${v2}/health/records/batch`, { method: "POST", token: member.token, headers: { "idempotency-key": `${marker}-${key}` }, body: { records } });
}
async function cleanup() {
  // Resolve exact run-owned reservations even if a registration response was interrupted.
  const members = [];
  for (const entry of owned.members) {
    const row = await prisma.user.findUnique({ where: { mobile: entry.mobile } });
    if (row) { eq(row.nickname, entry.nickname, "Cleanup ownership guard"); members.push(row); }
  }
  const userIds = members.map(row => row.id), adminIds = owned.admins.map(row => row.id);
  // Discover exact run-marked resources if an HTTP create committed but its reply
  // was interrupted. UUID marker + creator/time prevent touching existing data.
  for (const [model, field, list] of [["articleCategory", "name", "categories"], ["article", "title", "articles"], ["notificationCampaign", "name", "campaigns"]]) {
    const rows = await prisma[model].findMany({ where: { [field]: { startsWith: marker }, createdAt: { gte: started }, ...(model === "notificationCampaign" ? { createdById: { in: adminIds }, status: "DRAFT" } : {}) }, select: { id: true } });
    owned[list] = [...new Set([...owned[list], ...rows.map(row => row.id)])];
  }
  await prisma.$transaction(async tx => {
    for (const entry of owned.admins) {
      const row = await tx.adminUser.findUnique({ where: { id: entry.id } });
      if (row) eq(row.username, entry.username, "Cleanup role ownership guard");
    }
    const relationships = await tx.careRelationship.findMany({ where: { inviterId: { in: userIds }, recipientId: { in: userIds } }, select: { id: true } });
    const warnings = await tx.healthWarningEvent.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    await tx.outboxEvent.deleteMany({ where: { createdAt: { gte: started }, OR: [
      { eventType: "care_invitation", aggregateId: { in: relationships.map(row => row.id) } },
      { eventType: "health_warning", aggregateId: { in: warnings.map(row => row.id) } },
    ] } });
    await tx.notificationCampaign.deleteMany({ where: { id: { in: owned.campaigns }, name: { startsWith: marker }, status: "DRAFT" } });
    // These are QA-owned audit records only; real audit history is never selected.
    await tx.auditLog.deleteMany({ where: { actorType: "ADMIN", actorId: { in: adminIds }, createdAt: { gte: started } } });
    await tx.article.deleteMany({ where: { id: { in: owned.articles }, title: { startsWith: marker } } });
    await tx.articleCategory.deleteMany({ where: { id: { in: owned.categories }, name: { startsWith: marker } } });
    await tx.fileObject.deleteMany({ where: { id: { in: owned.files }, ownerUserId: { in: userIds }, objectKey: { startsWith: marker } } });
    // Feedback uses SET NULL, so remove only this run's feedback before the user.
    await tx.feedback.deleteMany({ where: { userId: { in: userIds }, content: { startsWith: marker } } });
    // User FK cascades cover health, care, inbox, sessions and consent.
    await tx.user.deleteMany({ where: { id: { in: userIds }, nickname: { startsWith: marker } } });
    await tx.smsCode.deleteMany({ where: { mobile: { in: owned.members.map(row => row.mobile) }, createdAt: { gte: started } } });
    await tx.adminUser.deleteMany({ where: { id: { in: adminIds }, username: { startsWith: marker } } });
  }, { timeout: 30_000 });
  for (const [model, where] of [
    ["user", { mobile: { in: owned.members.map(row => row.mobile) }, nickname: { startsWith: marker } }],
    ["adminUser", { id: { in: adminIds } }], ["article", { id: { in: owned.articles } }],
    ["articleCategory", { id: { in: owned.categories } }], ["notificationCampaign", { id: { in: owned.campaigns } }],
    ["fileObject", { id: { in: owned.files } }], ["healthRecord", { userId: { in: userIds } }],
    ["feedback", { userId: { in: userIds } }], ["notification", { userId: { in: userIds } }],
  ]) eq(await prisma[model].count({ where }), 0, `Cleanup ${model}`);
  cleanupVerified = true;
}
try {
  const identity = await prisma.$queryRaw`SELECT current_database() AS name`;
  eq(identity[0].name, "saydian_h5_demo", "Exact isolated database");
  eq(await prisma.integrationSecret.count(), 0, "No provider secrets exist in demo DB");
  eq(await prisma.integrationConfig.count({ where: { state: "CONFIGURED" } }), 0, "No live integrations configured");
  console.log(JSON.stringify({ marker, target: "saydian_h5_demo:8081", stage: "start", syntheticOnly: true }));
  const A = await newMember("A"), B = await newMember("B");
  const roles = {};
  for (const role of ["APP_OPERATIONS", "CUSTOMER_SERVICE", "HEALTH_AUDITOR", "CONTENT_EDITOR", "READ_ONLY", "FINANCE"]) roles[role] = await newAdmin(role);

  const samples = Array.from({ length: 35 }, (_, i) => record(`same-time-${i}`));
  for (const metric of ["sleep", "steps", "distance", "calories", "blood_oxygen", "blood_pressure", "blood_glucose", "temperature", "hrv", "ecg", "body_composition", "blood_composition"]) samples.push(record(metric, metric, { synthetic: true, value: null }));
  const initial = await batch(A, "initial", samples); eq(initial.acceptedIds.length, samples.length, "All thirteen metric types accept synthetic scalar samples");
  eq(initial.rejected.length, 0, "No valid synthetic sample rejected");
  eq(await batch(A, "initial", samples), initial, "Exact batch replay is stable");
  eq(await prisma.healthRecord.count({ where: { userId: A.id } }), samples.length, "Replay does not duplicate rows");
  await status(`${v2}/health/records/batch`, 409, { method: "POST", token: A.token, headers: { "idempotency-key": `${marker}-initial` }, body: { records: [record("different")] } });
  const duplicate = await batch(A, "duplicate", [samples[0]]); eq(duplicate.acceptedIds, [samples[0].id], "Same record on another batch is accepted");
  const conflicting = await batch(A, "conflict", [{ ...samples[0], values: { bpm: 99 } }]);
  eq(conflicting.acceptedIds, [], "Conflicting client ID is never falsely accepted"); eq(conflicting.rejected[0].code, "record_conflict", "Per-record conflict is explicit");
  const deviceRecord = record("device-source"); deviceRecord.source.deviceId = `${marker}-device-A`;
  eq((await batch(A, "source-first", [deviceRecord])).acceptedIds, [deviceRecord.id], "Initial unbound device upload remains supported");
  eq((await batch(A, "source-other", [{ ...deviceRecord, source: { ...deviceRecord.source, deviceId: `${marker}-device-B` } }])).rejected[0].code, "record_conflict", "Different unbound device cannot reuse a record identity");
  eq((await batch(A, "source-same", [deviceRecord])).acceptedIds, [deviceRecord.id], "Same source fingerprint can safely replay");
  const mixed = await batch(A, "mixed", [record("valid-null", "heart_rate", { bpm: null }), { ...record("invalid"), metric: "fictional" }]);
  eq(mixed.acceptedIds.length, 1, "Valid null measurement retained"); eq(mixed.rejected.length, 1, "Invalid metric rejected per record");
  const invalidEcg = await batch(A, "missing-ecg", [{ ...record("missing-file", "ecg"), ecgArtifact: { uploadObjectKey: `${marker}/not-uploaded.gz`, sha256: "a".repeat(64), sampleRateHz: 100, sampleCount: 4 } }]);
  eq(invalidEcg.acceptedIds.length, 0, "Unverified ECG upload cannot be accepted");
  eq(await prisma.healthRecord.count({ where: { userId: A.id, clientRecordId: `${marker}-missing-file` } }), 0, "Rejected artifact leaves no row");
  const concurrent = await Promise.all(["race-a", "race-b"].map(id => http(`${v2}/health/records/batch`, { method: "POST", token: A.token,
    headers: { "idempotency-key": `${marker}-concurrent` }, body: { records: [record(id)] } })));
  eq(concurrent.map(row => row.status >= 200 && row.status < 300 ? 200 : row.status).sort(), [200, 409], "Only one of two concurrent different bodies claims the same key");
  eq(await prisma.healthRecord.count({ where: { userId: A.id, clientRecordId: { in: [`${marker}-race-a`, `${marker}-race-b`] } } }), 1, "Losing key request wrote nothing");
  const collected = [], seenCursors = new Set(); let cursor;
  do {
    const page = await ok(`${v2}/health/records?limit=7${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`, { token: A.token });
    truth(page.items.length <= 7, "Page size respected"); collected.push(...page.items.map(row => row.id)); cursor = page.nextCursor;
    if (cursor) { truth(!seenCursors.has(cursor), "Cursor progresses"); seenCursors.add(cursor); }
    truth(seenCursors.size < 100, "Pagination bounded");
  } while (cursor);
  eq(collected.length, new Set(collected).size, "No page overlaps");
  eq(collected.length, await prisma.healthRecord.count({ where: { userId: A.id } }), "All same-millisecond rows survive complete pagination");
  eq((await ok(`${v2}/health/records`, { token: B.token })).items, [], "Member B cannot see A's health rows");
  for (const limit of ["1.5", "Infinity"]) await status(`${v2}/health/records?limit=${limit}`, 400, { token: A.token });
  await status(`${v2}/health/records?before=not-a-cursor`, 400, { token: A.token });
  await status(`${v2}/health/records`, 401);

  // The original Flutter JSON endpoint and old response envelope are exercised too.
  const daily = { dailyDate: [{ date: "2026-01-03 08:00:00", heartReat: 73, bloodPressure: { bloodPressureHigh: 111, bloodPressureLow: 72 }, sleepData: { allSleepTime: 400, deepSleepTime: 80, lowSleepTime: 320 } }] };
  const legacyFirst = await ok("/api/v1/member/daily-date", { method: "POST", token: A.token, body: daily });
  eq(await ok("/api/v1/member/daily-date", { method: "POST", token: A.token, body: daily }), legacyFirst, "Legacy upload replay retains contract");
  const oldRows = await ok("/api/v1/member/daily-date?type=pulsereat&page=1", { token: A.token });
  truth(Array.isArray(oldRows) && oldRows.length > 0 && oldRows.some(row => row.heartReat === 73), "Legacy health list reads canonical records");
  const legacyProfile = await ok("/api/v1/member/member/my", { token: A.token }); truth(Number.isSafeInteger(legacyProfile.id) && legacyProfile.id > 0, "Legacy member numeric ID remains available");
  summaries.push("health: 13 metrics, nulls, tied-time pagination, replay/conflict/concurrency, invalid ECG, legacy daily upload/read");

  await batch(B, "b-records", [record("b-heart", "heart_rate", { bpm: 71 }), record("b-steps", "steps", { value: 42 })]);
  const relation = await ok(`${v2}/care/invitations`, { method: "POST", token: A.token, body: { mobile: B.mobile } });
  eq((await ok(`${v2}/care/invitations`, { method: "POST", token: A.token, body: { mobile: B.mobile } })).id, relation.id, "Pending invitation is idempotent");
  const carePath = `${v2}/care/relationships/${relation.id}`;
  await status(`${carePath}/health?metric=heart_rate&from=2026-01-01&to=2026-01-04`, 403, { token: A.token });
  await status(`${carePath}/respond`, 404, { method: "POST", token: A.token, body: { accepted: true } });
  await ok(`${carePath}/respond`, { method: "POST", token: B.token, body: { accepted: true } });
  await status(`${carePath}/permissions`, 403, { method: "POST", token: A.token, body: { metrics: ["heart_rate"] } });
  await ok(`${carePath}/permissions`, { method: "POST", token: B.token, body: { metrics: ["heart_rate"] } });
  const visible = await ok(`${carePath}/health?metric=heart_rate&from=2026-01-01&to=2026-01-04`, { token: A.token });
  eq(visible.map(row => row.id), [`${marker}-b-heart`], "Only authorized subject and metric visible");
  await status(`${carePath}/health?metric=steps&from=2026-01-01&to=2026-01-04`, 403, { token: A.token });
  await prisma.carePermission.updateMany({ where: { relationshipId: relation.id }, data: { expiresAt: new Date("2020-01-01T00:00:00Z") } });
  await status(`${carePath}/health?metric=heart_rate&from=2026-01-01&to=2026-01-04`, 403, { token: A.token });
  await ok(`${carePath}/permissions`, { method: "POST", token: B.token, body: { metrics: ["heart_rate"] } });
  await ok(carePath, { method: "DELETE", token: B.token });
  await status(`${carePath}/health?metric=heart_rate&from=2026-01-01&to=2026-01-04`, 403, { token: A.token });
  eq(await prisma.carePermission.count({ where: { relationshipId: relation.id } }), 0, "Revocation removes grants");
  await ok(`${v2}/care/invitations`, { method: "POST", token: A.token, body: { mobile: B.mobile } });
  await ok(`${carePath}/respond`, { method: "POST", token: B.token, body: { accepted: true } });
  await status(`${carePath}/health?metric=heart_rate&from=2026-01-01&to=2026-01-04`, 403, { token: A.token });
  truth(await prisma.careAccessAudit.count({ where: { relationshipId: relation.id, result: "ALLOWED" } }), "Allowed health view audited");
  truth(await prisma.careAccessAudit.count({ where: { relationshipId: relation.id, result: "DENIED" } }), "Denied health view audited");
  summaries.push("care: recipient consent, metric grants, revoke, reinvite without stale grants, allowed/denied audit");

  const members = await ok(`${admin}/members?search=${encodeURIComponent(marker)}`, { token: roles.CUSTOMER_SERVICE.token });
  eq(members.total, 2, "Scoped member search");
  for (const row of members.items) truth(!("mobile" in row) && !JSON.stringify(row).includes(A.mobile) && !JSON.stringify(row).includes(B.mobile) && !("passwordHash" in row), "Member list is redacted");
  const summary = await ok(`${admin}/members/${A.id}/health-summary`, { token: roles.CUSTOMER_SERVICE.token });
  truth(summary.every(row => !Object.hasOwn(row, "values")), "Customer-service health summary excludes readings");
  await status(`${admin}/members/${A.id}/health-records?reason=${marker}`, 403, { token: roles.CUSTOMER_SERVICE.token });
  await status(`${admin}/members/${A.id}/health-records?reason=${marker}`, 403, { token: roles.READ_ONLY.token });
  await status(`${admin}/members/${A.id}/health-summary`, 403, { token: roles.FINANCE.token });
  await status(`${admin}/members/${A.id}/health-records`, 400, { token: roles.HEALTH_AUDITOR.token });
  const raw = await ok(`${admin}/members/${A.id}/health-records?reason=${marker}&limit=500`, { token: roles.HEALTH_AUDITOR.token });
  eq(raw.length, await prisma.healthRecord.count({ where: { userId: A.id } }), "Authorized raw view complete");
  const rawAudit = await prisma.auditLog.findFirst({ where: { actorId: roles.HEALTH_AUDITOR.id, action: "HEALTH_RAW_READ", entityId: A.id, createdAt: { gte: started } } });
  eq(rawAudit?.afterJson?.reason, marker, "Sensitive read includes reason in audit");
  summaries.push("admin health: redacted summaries, finance/customer/read-only denied raw, auditor reason + audit required");

  const category = await ok(`${admin}/article-categories`, { method: "POST", token: roles.CONTENT_EDITOR.token, body: { name: `${marker}-category`, sort: 0 } }); owned.categories.push(category.id);
  for (const [label, publishStatus, publishedAt] of [["published-a", "PUBLISHED", "2026-01-01T00:00:00.000Z"], ["published-b", "PUBLISHED", "2026-01-01T00:00:00.000Z"], ["draft", "DRAFT", null], ["future", "PUBLISHED", "2099-01-01T00:00:00.000Z"]]) {
    const row = await ok(`${admin}/articles`, { method: "POST", token: roles.CONTENT_EDITOR.token, body: { title: `${marker}-${label}`, contentHtml: "<p>仅合成验收内容，不构成健康或功效说明。</p>", categoryId: category.id, status: publishStatus, publishedAt } }); owned.articles.push(row.id);
  }
  const publishedIds = [];
  for (const page of [1, 2]) {
    const result = await ok(`${v2}/content/articles?categoryId=${category.id}&page=${page}&pageSize=1`);
    eq(result.total, 2, "Public list excludes draft/future publication"); publishedIds.push(result.items[0].id);
  }
  eq(new Set(publishedIds).size, 2, "Content tied publish-time pages do not overlap");
  await status(`${v2}/content/articles/${owned.articles[2]}`, 404); await status(`${v2}/content/articles/${owned.articles[3]}`, 404);
  for (const query of ["page=1.5", "pageSize=Infinity"]) await status(`${v2}/content/articles?${query}`, 400);
  await status(`${admin}/articles/${owned.articles[0]}`, 403, { method: "PATCH", token: roles.READ_ONLY.token, body: { title: `${marker}-forbidden`, contentHtml: "<p>forbidden</p>" } });
  await ok(`${admin}/articles/${owned.articles[0]}`, { method: "PATCH", token: roles.CONTENT_EDITOR.token, body: { title: `${marker}-archived`, contentHtml: "<p>仅合成内容</p>", categoryId: category.id, status: "ARCHIVED" } });
  await status(`${v2}/content/articles/${owned.articles[0]}`, 404);
  const legacyArticle = await ok(`/api/rf-article/article/view?id=${owned.articles[1]}`); truth(legacyArticle, "Legacy article endpoint shares published content");
  summaries.push("content: editor write, read-only deny, published/draft/future/archive visibility and page validation");

  const attachment = await prisma.fileObject.create({ data: { ownerUserId: A.id, objectKey: `${marker}/synthetic-metadata-only.png`, originalName: "SYSTEM-QA-no-object.png", contentType: "image/png", byteSize: 1, sha256: "a".repeat(64), purpose: "feedback" } }); owned.files.push(attachment.id);
  await status(`${v2}/files/${attachment.id}`, 404); // Private feedback image is never downloadable publicly.
  await status(`${v2}/support/feedback`, 400, { method: "POST", token: B.token, body: { content: `${marker}-foreign-attachment`, attachments: [attachment.id] } });
  const feedback = await ok(`${v2}/support/feedback`, { method: "POST", token: A.token, body: { category: "SYSTEM-QA", content: `${marker}-synthetic-feedback`, attachments: [attachment.id] } });
  eq(feedback.status, "open", "New feedback opens for customer service");
  await status(`${admin}/feedback/${feedback.id}`, 403, { method: "PATCH", token: roles.READ_ONLY.token, body: { status: "CLOSED" } });
  await ok(`${admin}/feedback/${feedback.id}`, { method: "PATCH", token: roles.CUSTOMER_SERVICE.token, body: { status: "IN_PROGRESS" } });
  await ok(`${admin}/feedback/${feedback.id}`, { method: "PATCH", token: roles.CUSTOMER_SERVICE.token, body: { status: "RESOLVED" } });
  eq((await prisma.feedback.findUniqueOrThrow({ where: { id: feedback.id } })).status, "RESOLVED", "Support status persisted");
  await status(`${v2}/ai/messages`, 503, { method: "POST", token: A.token, body: { content: `${marker}-unconfigured-test`, sessionId: marker } });
  eq(await prisma.aiConversation.count({ where: { userId: { in: [A.id, B.id] } } }), 0, "Unconfigured AI creates no fake conversation/reply");
  // Fixture history is explicitly synthetic and inserted locally; it is not a provider reply.
  await prisma.aiConversation.create({ data: { userId: A.id, clientSessionId: marker, title: `${marker}-synthetic-history`, messages: { create: [
    { role: "user", content: `${marker}-synthetic-question` }, { role: "assistant", content: `${marker}-fixed-QA-text-not-generated` },
  ] } } });
  eq((await ok(`${v2}/ai/messages?sessionId=${marker}`, { token: A.token }))[0].messages.length, 2, "Owner can load synthetic history");
  eq(await ok(`${v2}/ai/messages?sessionId=${marker}`, { token: B.token }), [], "Same client session identifier cannot expose another member's history");
  summaries.push("support: attachment ownership/private-file denial, customer-service workflow, AI unconfigured without calls");

  await ok(`${v2}/health/warning-rules`, { method: "POST", token: A.token, body: { rules: [{ metric: "heart_rate", highThreshold: 500, enabled: true }] } });
  const trigger = record("synthetic-warning", "heart_rate", { bpm: 501 });
  await batch(A, "warning", [trigger]); await batch(A, "warning", [trigger]);
  eq(await prisma.healthWarningEvent.count({ where: { userId: A.id } }), 1, "Warning retry does not duplicate events");
  const adminWarnings = await ok(`${admin}/warnings`, { token: roles.CUSTOMER_SERVICE.token });
  const ownWarning = adminWarnings.find(row => row.userId === A.id);
  truth(ownWarning && !("valueSnapshot" in ownWarning) && !("ruleSnapshot" in ownWarning), "Back-office warning list remains redacted");
  const inbox = await ok(`${v2}/notifications?page=1&pageSize=1`, { token: A.token });
  truth(inbox.items.length === 1 && inbox.items[0].type === "health_warning", "Local warning inbox is real");
  truth(!inbox.items[0].body.includes("501") && !inbox.items[0].body.includes(A.mobile), "Notification body excludes health scalar/mobile");
  const noteId = inbox.items[0].id;
  await status(`${v2}/notifications/${noteId}`, 404, { token: B.token });
  eq((await ok(`${v2}/notifications/${noteId}/read`, { method: "POST", token: B.token })).read, false, "Foreign read cannot mark A notification");
  eq((await ok(`${v2}/notifications/unread-count`, { token: A.token })).count, 1, "A unread remains unchanged");
  await ok(`${v2}/notifications/${noteId}/read`, { method: "POST", token: A.token });
  eq((await ok(`${v2}/notifications/unread-count`, { token: A.token })).count, 0, "Owner mark-read works");
  for (const query of ["page=1.5", "pageSize=Infinity"]) await status(`${v2}/notifications?${query}`, 400, { token: A.token });
  const bPage1 = await ok(`${v2}/notifications?page=1&pageSize=1`, { token: B.token });
  const bPage2 = await ok(`${v2}/notifications?page=2&pageSize=1`, { token: B.token });
  eq(bPage1.total, 2, "Reinvite creates exactly second recipient notice"); truth(bPage1.items[0].id !== bPage2.items[0].id, "Inbox pagination progresses");
  eq((await ok(`${v2}/notifications/preferences`, { token: B.token })).marketingEnabled, false, "Marketing opt-out is default");
  await ok(`${v2}/notifications/preferences`, { method: "PATCH", token: A.token, body: { marketingEnabled: true } });
  eq((await ok(`${v2}/notifications/preferences`, { token: B.token })).marketingEnabled, false, "Preference belongs to each member");
  const install = `${marker}-installation`;
  await ok(`${v2}/notifications/push-installations`, { method: "POST", token: A.token, body: { installationId: install, registrationId: `${marker}-not-a-real-provider-registration`, provider: "disabled", platform: "android", appVersion: "SYSTEM-QA", buildNumber: "0" } });
  eq((await ok(`${v2}/notifications/push-installations/${install}`, { method: "DELETE", token: B.token })).unregistered, false, "Foreign member cannot unregister installation");
  eq((await ok(`${v2}/notifications/push-installations/${install}`, { method: "DELETE", token: A.token })).unregistered, true, "Owner unregister works without provider call");
  const campaign = await ok(`${admin}/notification-campaigns`, { method: "POST", token: roles.APP_OPERATIONS.token, body: { name: `${marker}-draft`, title: "仅合成草稿", body: "不排期不发送", audience: { userIds: [A.id] } } }); owned.campaigns.push(campaign.id);
  eq(campaign.status, "DRAFT", "Campaign stays draft; no push scheduled");
  await status(`${admin}/notification-campaigns/${campaign.id}`, 403, { method: "PATCH", token: roles.CUSTOMER_SERVICE.token, body: { title: "forbidden" } });
  eq(await prisma.outboxEvent.count({ where: { eventType: "notification_campaign", aggregateId: campaign.id } }), 0, "Draft does not create a delivery job");
  const outbox = await prisma.outboxEvent.findMany({ where: { OR: [{ payload: { path: ["userId"], equals: A.id } }, { payload: { path: ["userId"], equals: B.id } }] } });
  truth(outbox.length >= 3 && outbox.every(row => row.attempts === 0 && row.status === "PENDING" && !row.deliveredAt), "All synthetic care/warning outbox remains unsent");
  summaries.push("notifications: real warning + invitation inbox, ownership/read-count/preferences, disabled installations, draft-only campaigns");
} catch (error) {
  failure = error;
  console.error(JSON.stringify({ marker, stage: "failed", lastAction, error: safeError(error) }));
} finally {
  try { await cleanup(); } catch (error) { failure ??= error; console.error(JSON.stringify({ marker, stage: "cleanup-failed", error: safeError(error) })); }
  await prisma.$disconnect();
  console.log(JSON.stringify({ marker, assertions, requests, cleanupVerified, passed: !failure, scopes: summaries, boundaries: ["synthetic-only", "demo-db-only", "no-provider-calls", "no-campaign-dispatch", "no-real-files-uploaded"] }));
}
if (failure) process.exitCode = 1;
