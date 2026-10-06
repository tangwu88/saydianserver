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
const legalPageVersion = `synthetic-ring-page-${Date.now()}`;
async function registerVerified(mobile, nickname) {
  const rejected = await request(v2 + "/auth/register", { method: "POST", body: { mobile, password, nickname, consentVersion: "fixture-only" } });
  check(rejected.json.code, 503); // Unverified registration stays disabled in the unified account service.
  const otp = (await request(v2 + "/auth/sms-code", { method: "POST", body: { mobile, usage: "register" } })).json;
  check(otp.code, 200);
  assert.match(otp.data.devCode ?? "", /^\d{6}$/);
  assertions++;
  return (await request(v2 + "/auth/register-with-sms", {
    method: "POST",
    body: { mobile, code: otp.data.devCode, password, nickname, consentVersion: "fixture-only" },
  })).json;
}
try {
  await prisma.globalLegalDocument.createMany({ data: ["say_ring_user_agreement", "say_ring_privacy_policy", "say_ring_sleep_analysis"].map(documentType => ({
    documentType, version: legalPageVersion, locale: "zh-Hans", title: "Say Ring synthetic legal page",
    contentHtml: `<p>${documentType}: synthetic current published text</p>`, active: true, reviewed: true, publishedAt: new Date(),
  })) });
  for (const type of ["privacy", "terms"]) {
    const response = await fetch(base + v2 + "/content/legal-page/say-ring/" + type, { signal: AbortSignal.timeout(15_000) });
    check(response.status, 200); check(response.headers.get("cache-control"), "no-store");
    check(response.headers.get("content-type").includes("text/html"), true);
    const html = await response.text();
    check(html.startsWith("<!doctype html>"), true); check(html.includes(legalPageVersion), true);
    check(html.includes('id="ios-activity-sleep-scope"'), true);
    check(html.includes('data-platform="ios" data-min-build="1062"'), true);
    check(html.includes("不会删除原有本机或云端记录"), true);
    check(html.includes('id="sleep-analysis"'), type === "privacy");
    if (type === "privacy") check(html.includes("实际提供可选睡眠 AI 的 Android 或历史版本"), true);
    check(html.includes("synthetic current published text"), true);
  }
  await prisma.globalLegalDocument.update({ where: { documentType_version_locale: { documentType: "say_ring_privacy_policy", version: legalPageVersion, locale: "zh-Hans" } }, data: { contentHtml: "<p>synthetic edited published text</p>" } });
  const updatedLegal = await fetch(base + v2 + "/content/legal-page/say-ring/privacy");
  check((await updatedLegal.text()).includes("synthetic edited published text"), true);
  check((await request(v2 + "/content/legal-page/say-ring/other-product")).status, 404);
  const a = await registerVerified("19900000001", "fixture-A");
  const b = await registerVerified("19900000002", "fixture-B");
  check(a.code, 200); check(b.code, 200);
  const tokenA = a.data.accessToken; const tokenB = b.data.accessToken;
  const form = new FormData(); form.set("username", "19900000001"); form.set("password", password);
  const login = await request("/api/v1/site/login", { method: "POST", body: form });
  check(login.json.code, 200); check(typeof login.json.data.member.id, "number");
  const wechatLogin = new FormData();
  wechatLogin.set("code", "synthetic-one-time-code");
  wechatLogin.set("state", `sd_${Date.now()}_01234567-89ab-cdef-0123456789ab`);
  wechatLogin.set("group", "app"); wechatLogin.set("platform", "harmony");
  wechatLogin.set("consent_version", "http-fixture-legal-v1");
  wechatLogin.set("consent_accepted", "1");
  check((await request("/api/v1/site/wechat-login", { method: "POST", body: wechatLogin })).json.code, 503);
  const badPay = new FormData(); badPay.set("pay_type", "unsupported"); badPay.set("data", '{"order_id":42}');
  const rejectedPayment = await request("/api/v1/pay", { method: "POST", token: tokenA, body: badPay });
  check(rejectedPayment.json.code, 400);
  check(typeof rejectedPayment.json.message, "string");
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
  const canonicalLogin = await request(v2 + "/auth/login", { method: "POST", body: { mobile: "19900000002", password } });
  const aliasLogin = await request("/global" + v2 + "/auth/login", { method: "POST", body: { username: "+8619900000002", password } });
  check(canonicalLogin.json.code, 200); check(aliasLogin.json.code, 200);
  check(canonicalLogin.json.data.member.id, b.data.member.id);
  check(aliasLogin.json.data.member.id, b.data.member.id);
  const bound = await request(v2 + "/devices", { method: "POST", token: tokenB, body: { deviceId: "synthetic-ci-device", vendor: "TEST", model: "CI-only", sdkData: "raw|connection|fixture" } });
  check(bound.json.code, 200);
  for (const suffix of ["/members/me", "/devices", "/health/records?metric=heart_rate"]) {
    const direct = await request(v2 + suffix, { token: canonicalLogin.json.data.accessToken });
    const alias = await request("/global" + v2 + suffix, { token: aliasLogin.json.data.accessToken });
    check(direct.json.code, 200); check(alias.json.code, 200); check(alias.json.data, direct.json.data);
  }
  check((await prisma.deviceConnectionEvent.findFirstOrThrow({ where: { deviceBindingId: bound.json.data.id } })).rawPayload.includes("sdkData=raw\\|connection\\|fixture"), true);
  const canonicalOrders = await request("/api/saidian-mall/v1/storefront/orders", { token: tokenB });
  const aliasOrders = await request("/global/api/saidian-mall/v1/storefront/orders", { token: aliasLogin.json.data.accessToken });
  check(canonicalOrders.status, 200); check(aliasOrders.json.data ?? aliasOrders.json, canonicalOrders.json.data ?? canonicalOrders.json);
  check((await request(`${v1}/daily-date/preview?type=heartReat&selectmember=${memberB.id}`, { token: tokenA })).json.code, 403);
  check((await request(v1 + "/care-setting", { method: "POST", token: tokenB, body: { to_member_id: memberA.id, setting: ["heartReat"] } })).json.code, 200);
  check((await request(`${v1}/daily-date/preview?type=heartReat&selectMemberId=${memberB.id}`, { token: tokenA })).json.data[0].heartReat, 75);
  check((await request(`${v1}/daily-date/preview?type=bloodPressure&selectmember=${memberB.id}`, { token: tokenA })).json.code, 403);
  const relation = (await request(v2 + "/care/relationships", { token: tokenB })).json.data[0];
  for (const prefix of [v2, "/global" + v2]) {
    const carePath = `${prefix}/care/relationships/${relation.id}`;
    const summary = await request(carePath + "/summary", { token: tokenA });
    check(summary.status, 200);
    check(summary.json.data.metrics, ["heart_rate"]);
    check(summary.json.data.records[0].values.value, 75);
    check((await request(carePath + "/summary", { token: tokenB })).status, 403);
    check((await request(carePath + "/summary")).status, 401);
    check((await request(carePath + "/health?metric=heart_rate&from=2000-01-01&to=2000-02-01", { token: tokenA })).json.data, []);
    check((await request(carePath + "/health/missing-fixture-record/ecg", { token: tokenA })).status, 403);
    check((await request(prefix + "/health/records/missing-fixture-record/ecg")).status, 401);
    check((await request(prefix + "/health/records/missing-fixture-record/ecg", { token: tokenA })).status, 404);
  }
  check((await request(v2 + "/care/relationships/" + relation.id + "/permissions", {
    method: "POST", token: tokenB, body: { metrics: ["heart_rate", "ecg"] },
  })).json.code, 200);
  check((await request(v2 + "/care/relationships/" + relation.id + "/health/missing-fixture-record/ecg", { token: tokenA })).status, 404);
  check((await request(v2 + "/care/relationships/" + relation.id + "/permissions", {
    method: "POST", token: tokenB, body: { metrics: ["heart_rate"] },
  })).json.code, 200);
  check((await request(v2 + "/care/relationships/" + relation.id + "/health/missing-fixture-record/ecg", { token: tokenA })).status, 403);
  check((await request(v2 + "/care/relationships/" + relation.id, { method: "DELETE", token: tokenB })).json.code, 200);
  check((await request(v2 + "/care/relationships/" + relation.id + "/health?metric=heart_rate", { token: tokenA })).json.code, 403);
  check((await request(v2 + "/care/relationships/" + relation.id + "/summary", { token: tokenA })).status, 403);
  check((await request(v2 + "/care/relationships/" + relation.id + "/health/missing-fixture-record/ecg", { token: tokenA })).status, 403);
  const notice = await prisma.notification.create({ data: { userId: a.data.member.id, eventId: "fixture-message", type: "SYSTEM", title: "fixture", body: "fixture only" } });
  check((await request(v1 + "/notify/statistics", { token: tokenA })).json.data.announce_count, 1);
  check((await request(v1 + "/notify/" + notice.compatibilityId, { token: tokenB })).json.code, 404);
  check((await request(v1 + "/notify/" + notice.compatibilityId, { token: tokenA })).json.data.is_read, 1);
  check((await request(v1 + "/notify/statistics", { token: tokenA })).json.data.announce_count, 0);
  const category = await prisma.articleCategory.create({ data: { legacyId: "81001", name: "fixture", locale: "en" } });
  await prisma.article.create({ data: { legacyId: "81002", categoryId: category.id, title: "fixture", locale: "en", contentHtml: "<p>fixture</p>", status: "PUBLISHED", publishedAt: new Date() } });
  check((await request("/api/rf-article/article/view?id=81002")).json.data.title, "fixture");
  check((await request("/api/rf-article/article/index?cate_id=81001")).json.data.length, 1);
  check((await request(v1 + "/member/my")).json.code, 401);
  check((await request("/api/saydian-app/admin/v1/members", { token: tokenA })).status, 401);
  const feedbackReceipt = await request(v2 + "/support/feedback", { method: "POST", token: tokenA, body: { content: "fixture feedback only" } });
  check(feedbackReceipt.json.data.status, "open");
  const admin = "/api/saydian-app/admin/v1";
  const adminLogin = await request(admin + "/auth/login", { method: "POST", body: { username: process.env.ADMIN_BOOTSTRAP_USERNAME, password: process.env.ADMIN_BOOTSTRAP_PASSWORD } });
  check(adminLogin.json.code, 200);
  const adminToken = adminLogin.json.data.token;
  const zhCategory = await request(admin + "/article-categories", { method: "POST", token: adminToken, body: { name: "Chinese fixture" } });
  check(zhCategory.json.code, 200); check(zhCategory.json.data.locale, "zh-Hans");
  const contentInput = { title: "Chinese fixture", contentHtml: "<p>Synthetic only</p>", categoryId: zhCategory.json.data.id, status: "PUBLISHED" };
  const zhArticle = await request(admin + "/articles", { method: "POST", token: adminToken, body: contentInput });
  check(zhArticle.json.code, 200); check(zhArticle.json.data.locale, "zh-Hans");
  check((await request(admin + "/articles/" + zhArticle.json.data.id, { method: "PATCH", token: adminToken, body: contentInput })).json.data.locale, "zh-Hans");
  check((await request(admin + "/article-categories/" + zhCategory.json.data.id, { method: "PATCH", token: adminToken, body: { name: "Renamed Chinese fixture" } })).json.data.locale, "zh-Hans");
  for (const prefix of [v2, "/global" + v2]) {
    const list = await request(prefix + "/content/articles?locale=zh-CN&categoryId=" + zhCategory.json.data.id);
    check(list.json.data.total, 1); check(list.json.data.items[0].id, zhArticle.json.data.id);
    check((await request(prefix + "/content/articles/" + zhArticle.json.data.id + "?locale=zh-Hans")).json.data.contentHtml, contentInput.contentHtml);
    check((await request(prefix + "/content/articles/" + zhArticle.json.data.id + "?locale=en")).status, 404);
  }
  check((await request(admin + "/articles", { method: "POST", token: adminToken, body: { ...contentInput, categoryId: category.id } })).json.errorKey, "content_article_locale_mismatch");
  check((await request(admin + "/article-categories/" + zhCategory.json.data.id, { method: "PATCH", token: adminToken, body: { name: "Conflict", locale: "en" } })).json.errorKey, "content_category_locale_conflict");
  const raceCategory = (await request(admin + "/article-categories", { method: "POST", token: adminToken, body: { name: "Race fixture" } })).json.data;
  const race = await Promise.all([
    request(admin + "/articles", { method: "POST", token: adminToken, body: { ...contentInput, categoryId: raceCategory.id } }),
    request(admin + "/article-categories/" + raceCategory.id, { method: "PATCH", token: adminToken, body: { name: "Race fixture", locale: "en" } }),
  ]);
  check(race.filter(result => result.json.code === 200).length, 1);
  check(race.filter(result => result.json.code === 400).length, 1);
  const account = { username: "fixture-feedback-support", displayName: "Fixture support", password, roles: ["CUSTOMER_SERVICE"], active: true };
  const shortPassword = await request(admin + "/admin-users", { method: "POST", token: adminToken, body: { ...account, password: "12345678" } });
  check(shortPassword.status, 400); check(shortPassword.json.errorKey, "admin_password_invalid");
  check(shortPassword.json.message, "初始密码至少需要12位");
  const createdAccount = await request(admin + "/admin-users", { method: "POST", token: adminToken, body: account });
  check(createdAccount.json.code, 200); check(createdAccount.json.data.roles, account.roles);
  check(Object.hasOwn(createdAccount.json.data, "passwordHash"), false);
  const duplicate = await request(admin + "/admin-users", { method: "POST", token: adminToken, body: account });
  check(duplicate.status, 409); check(duplicate.json.errorKey, "admin_username_exists");
  const supportLogin = await request(admin + "/auth/login", { method: "POST", body: { username: account.username, password } });
  check(supportLogin.json.code, 200);
  const supportToken = supportLogin.json.data.token;
  check((await request(admin + "/admin-users", { method: "POST", token: supportToken, body: { ...account, username: "forbidden-fixture" } })).status, 403);
  const feedbackId = feedbackReceipt.json.data.id;
  const reply = "Synthetic feedback reply for the authenticated inbox only";
  const savedReplies = await Promise.all([1, 2].map(() => request(admin + "/feedback/" + feedbackId, { method: "PATCH", token: supportToken, body: { status: "RESOLVED", replyContent: reply } })));
  for (const saved of savedReplies) check(saved.json.code, 200);
  const replyNotices = await prisma.notification.findMany({ where: { userId: a.data.member.id, metadata: { path: ["feedbackId"], equals: feedbackId } } });
  check(replyNotices.length, 1); check(replyNotices[0].body, reply);
  check(await prisma.outboxEvent.count({ where: { aggregateType: "feedback", aggregateId: feedbackId } }), 1);
  const inbox = await request(v2 + "/notifications", { token: tokenA });
  check(inbox.json.data.items.some(item => item.eventId === replyNotices[0].eventId && item.body === reply), true);
  const legacyInbox = await request(v1 + "/notify?type=2", { token: tokenA });
  check(legacyInbox.json.data.some(item => item.event_id === replyNotices[0].eventId && item.content === reply), true);
  check((await request(v2 + "/notifications/" + replyNotices[0].id, { token: tokenB })).status, 404);
  check((await request(v2 + "/notifications/unread-count", { token: tokenA })).json.data.count, 1);
  check((await request(v1 + "/notify/statistics", { token: tokenA })).json.data.unread_count, 1);
  check((await request(v2 + "/notifications/" + replyNotices[0].id + "/read", { method: "POST", token: tokenA })).json.data.read, true);
  check((await request(v2 + "/notifications/unread-count", { token: tokenA })).json.data.count, 0);
  await request(admin + "/feedback/" + feedbackId, { method: "PATCH", token: supportToken, body: { status: "CLOSED", replyContent: reply } });
  check(await prisma.notification.count({ where: { userId: a.data.member.id, readAt: null } }), 0);
  console.log(`HTTP contract smoke passed: ${assertions} assertions; local isolated fixtures only.`);
} finally {
  await prisma.globalLegalDocument.deleteMany({ where: { version: legalPageVersion } });
  await prisma.$disconnect();
}
