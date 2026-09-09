// Explicit production QA: one synthetic registration, then exact-ID cleanup.
// Run inside the global API container; stdin supplies administrator credentials.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-registration"), "Explicit synthetic-registration opt-in is required");
assert(process.env.APP_REALM === "global", "Only the international instance may run this check");
assert(new URL(process.env.DATABASE_URL).pathname === "/saydian_global", "Unexpected database");
setDefaultResultOrder("ipv4first");
const { PrismaClient } = createRequire("/workspace/apps/api/package.json")("@prisma/client");
const prisma = new PrismaClient();
let input = "";
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input);
input = "";
const root = "https://app.saydian.cn";
const adminBase = "/global/api/saydian-app/admin/v1";
const appBase = "/global/api/saydian-app/v2";
const identifier = `qa.member-admin.${Date.now()}.${randomBytes(3).toString("hex")}@example.invalid`;
const password = randomBytes(24).toString("base64url");
let adminToken;
let registeredId;
let checks = 0;
const evidence = { requests: [], syntheticRemoved: false };
function check(value, message) { assert(value, message); checks++; }
async function request(path, token, body, expected = body ? 201 : 200) {
  const response = await fetch(root + path, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const envelope = await response.json();
  check(response.status === expected, `${path}: unexpected HTTP ${response.status}`);
  evidence.requests.push({ path: path.split("?")[0], status: response.status, requestId: envelope.requestId });
  return envelope.data;
}
try {
  const login = await request(adminBase + "/auth/login", null, credentials);
  adminToken = login.token;
  credentials.password = "";
  const before = await request(adminBase + "/members", adminToken);
  evidence.membersBefore = before.total;
  check(before.items.every(row => /^[1-9]\d*$/.test(row.memberNo)), "Existing members must have numeric display IDs");
  for (const path of ["/dashboard", "/settings", "/legal-documents", "/articles", "/integrations"]) await request(adminBase + path, adminToken);
  await request("/api/saydian-app/admin/v1/members", adminToken, undefined, 401);
  const capabilities = await request(appBase + "/auth/capabilities");
  check(capabilities.realm === "global" && capabilities.registration.verificationRequired === false, "Temporary QA registration is not enabled; do not change it here");
  const session = await request(appBase + "/auth/register", null, { channel: "email", identifier, password, nickname: "QA temporary member-number check", locale: "en", consentVersion: capabilities.consentVersion });
  registeredId = session.member.id;
  check(/^[1-9]\d*$/.test(session.member.memberNo), "Registration display number must be numeric");
  const profile = await request(appBase + "/members/me", session.accessToken);
  check(profile.id === registeredId && profile.memberNo === session.member.memberNo && profile.promo_code === profile.memberNo, "Profile and registration display aliases must agree without replacing the UUID");
  check(!Object.hasOwn(profile, "email") && !Object.hasOwn(profile, "passwordHash"), "Sensitive profile fields must be absent");
  const found = await request(adminBase + "/members?search=" + encodeURIComponent(identifier), adminToken);
  check(found.total === 1 && found.items[0].id === registeredId && found.items[0].memberNo === profile.memberNo, "The newly registered App member must appear immediately in admin search");
  const byNumber = await request(adminBase + "/members?search=" + profile.memberNo, adminToken);
  check(byNumber.items.some(row => row.id === registeredId), "Numeric member search must find the same UUID");
  const page = await request(adminBase + "/members?page=2&pageSize=1", adminToken);
  check(page.page === 2 && page.pageSize === 1 && page.items.length === 1 && page.total >= before.total + 1, "Server pagination must retain the complete count, including concurrent registrations");
  await request(adminBase + "/members/" + registeredId + "/health-summary", adminToken);
  await request(appBase + "/auth/logout", session.accessToken, {});
  evidence.memberNumber = profile.memberNo;
} finally {
  // Only this run's exact synthetic email/UUID can be removed, never real members.
  const created = await prisma.user.findUnique({ where: { email: identifier }, select: { id: true, email: true } });
  if (created) {
    assert(created.email === identifier && (!registeredId || created.id === registeredId));
    await prisma.user.delete({ where: { id: created.id } });
  }
  evidence.syntheticRemoved = (await prisma.user.count({ where: { email: identifier } })) === 0;
  evidence.membersAfter = await prisma.user.count();
  if (adminToken) await request(adminBase + "/auth/logout", adminToken, {});
  await prisma.$disconnect();
  console.log(JSON.stringify({ ...evidence, checks }));
}
