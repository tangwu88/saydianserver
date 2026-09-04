// Only an isolated CI/test database. Never run against production or original backend.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const base = process.env.API_SMOKE_BASE ?? "http://127.0.0.1:8080";
const dbUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV !== "test" || process.env.ALLOW_HTTP_FIXTURES !== "true" || !["127.0.0.1", "localhost"].includes(new URL(base).hostname) || !["127.0.0.1", "localhost"].includes(dbUrl.hostname)) throw new Error("Refusing non-local or non-test fixtures");
const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
let assertions = 0;
function check(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
async function request(route, { method = "GET", body, token, headers = {} } = {}) {
  const response = await fetch(base + route, {
    method, headers: { ...(body instanceof FormData ? {} : body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  assert.doesNotMatch(text, /PrismaClientKnownRequestError|node_modules|\bat .+\.ts:\d+/);
  return { status: response.status, json: JSON.parse(text) };
}
const v1 = "/api/v1/member";
const v2 = "/api/saydian-app/v2";
const password = "local-fixture-password-only";
try {
  const a = (await request(v2 + "/auth/register", { method: "POST", body: { mobile: "19900000001", password, nickname: "fixture-A", consentVersion: "fixture-only" } })).json;
  const b = (await request(v2 + "/auth/register", { method: "POST", body: { mobile: "19900000002", password, nickname: "fixture-B", consentVersion: "fixture-only" } })).json;
  check(a.code, 200); check(b.code, 200);
  const tokenA = a.data.accessToken; const tokenB = b.data.accessToken;
  const form = new FormData(); form.set("username", "19900000001"); form.set("password", password);
  const login = await request("/api/v1/site/login", { method: "POST", body: form });
  check(login.json.code, 200); check(typeof login.json.data.member.id, "number");
  const badPay = new FormData(); badPay.set("pay_type", "unsupported"); badPay.set("data", '{"order_id":42}');
  check((await request("/api/v1/pay", { method: "POST", token: tokenA, body: badPay })).json.message, "请选择支持的支付方式");
  const observed = new Date(Date.now() - 60_000).toISOString();
  const localDay = new Date(Date.now() + 8 * 3600_000 - 60_000).toISOString().slice(0, 10);
  const daily = { dailyDate: [{ date: observed, heartReat: 75, bloodPressure: { bloodPressureHigh: 120, bloodPressureLow: 80 } }] };
  const first = await request(v1 + "/daily-date", { method: "POST", token: tokenB, body: daily });
  const repeat = await request(v1 + "/daily-date", { method: "POST", token: tokenB, body: daily });
  check(first.json.code, 200); check(repeat.json.data.acceptedIds, first.json.data.acceptedIds);
  check((await request(v2 + "/health/records?metric=heart_rate", { token: tokenB })).json.data.items.length, 1);
  const history = await request(`${v1}/daily-date/preview?type=heartReat&date=${localDay}`, { token: tokenB });
  check(history.json.code, 200); check(history.json.data[0].heartReat, 75);
  check((await request(v1 + "/daily-date?page=1&type=heartReat", { token: tokenB })).json.data.length, 1);
  const composition = await request(v1 + "/bodycomposition", { method: "POST", token: tokenB, headers: { "idempotency-key": "fixture-body-idempotency" }, body: { data: { bmi: 20 } } });
  check(composition.json.code, 200);
  const bodyId = composition.json.data.acceptedIds[0];
  check((await request(v1 + "/bodycomposition/" + bodyId, { token: tokenB })).json.data.bmi, 20);
  check((await request(v1 + "/bodycomposition/" + bodyId, { token: tokenA })).json.code, 404);
  check(Array.isArray((await request(v1 + "/bodycomposition/preview", { token: tokenB })).json.data), true);
  check((await request(v1 + "/care", { method: "POST", token: tokenA, body: { mobile: "19900000002" } })).json.code, 200);
  const invites = (await request(v1 + "/care", { token: tokenB })).json.data;
  check(invites.length, 1);
  check((await request(v1 + "/care/save", { method: "POST", token: tokenB, body: { id: invites[0].id, examine_status: 1 } })).json.code, 200);
  const memberB = (await request(v1 + "/member/my", { token: tokenB })).json.data;
  const memberA = login.json.data.member;
  check((await request(`${v1}/daily-date/preview?type=heartReat&selectmember=${memberB.id}`, { token: tokenA })).json.code, 403);
  check((await request(v1 + "/care-setting", { method: "POST", token: tokenB, body: { to_member_id: memberA.id, setting: ["heartReat"] } })).json.code, 200);
  check((await request(`${v1}/daily-date/preview?type=heartReat&selectMemberId=${memberB.id}`, { token: tokenA })).json.data[0].heartReat, 75);
  check((await request(`${v1}/daily-date/preview?type=bloodPressure&selectmember=${memberB.id}`, { token: tokenA })).json.code, 403);
  const relation = (await request(v2 + "/care/relationships", { token: tokenB })).json.data[0];
  check((await request(v2 + "/care/relationships/" + relation.id, { method: "DELETE", token: tokenB })).json.code, 200);
  check((await request(v2 + "/care/relationships/" + relation.id + "/health?metric=heart_rate", { token: tokenA })).json.code, 403);
  const notice = await prisma.notification.create({ data: { userId: a.data.member.id, eventId: "fixture-message", type: "SYSTEM", title: "fixture", body: "fixture only" } });
  check((await request(v1 + "/notify/statistics", { token: tokenA })).json.data.announce_count, 1);
  check((await request(v1 + "/notify/" + notice.compatibilityId, { token: tokenB })).json.code, 404);
  check((await request(v1 + "/notify/" + notice.compatibilityId, { token: tokenA })).json.data.is_read, 1);
  check((await request(v1 + "/notify/statistics", { token: tokenA })).json.data.announce_count, 0);
  const category = await prisma.articleCategory.create({ data: { legacyId: "81001", name: "fixture" } });
  await prisma.article.create({ data: { legacyId: "81002", categoryId: category.id, title: "fixture", contentHtml: "<p>fixture</p>", status: "PUBLISHED", publishedAt: new Date() } });
  check((await request("/api/rf-article/article/view?id=81002")).json.data.title, "fixture");
  check((await request("/api/rf-article/article/index?cate_id=81001")).json.data.length, 1);
  check((await request(v1 + "/member/my")).json.code, 401);
  check((await request("/api/saydian-app/admin/v1/members", { token: tokenA })).status, 401);
  check((await request(v2 + "/support/feedback", { method: "POST", token: tokenA, body: { content: "fixture feedback only" } })).json.data.status, "open");
  console.log(`HTTP contract smoke passed: ${assertions} assertions; local isolated fixtures only.`);
} finally { await prisma.$disconnect(); }
