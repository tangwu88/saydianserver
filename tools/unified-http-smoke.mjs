// Repeatable local-only HTTP consumer acceptance. Never contacts payment/SMS/ERP providers.
// PowerShell: $env:NODE_ENV='test'; $env:ALLOW_UNIFIED_HTTP_FIXTURES='true'; node tools/unified-http-smoke.mjs
// Reads apps/api/.env silently, without overriding explicit process environment.
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../apps/api/package.json", import.meta.url));
// Check opt-in before loading any connection configuration or instantiating Prisma.
if (process.env.NODE_ENV !== "test" || process.env.ALLOW_UNIFIED_HTTP_FIXTURES !== "true") {
  throw new Error("Refusing fixtures: NODE_ENV=test and ALLOW_UNIFIED_HTTP_FIXTURES=true are required");
}
require("dotenv").config({ path: fileURLToPath(new URL("../apps/api/.env", import.meta.url)), quiet: true });
function safeUrl(value, label) {
  try { return new URL(value); } catch { throw new Error(`Refusing invalid ${label} URL (value withheld)`); }
}
const base = safeUrl(process.env.UNIFIED_SMOKE_BASE ?? "http://127.0.0.1:8080", "API");
const database = safeUrl(process.env.DATABASE_URL ?? "http://invalid", "database");
const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
if (!loopback.has(base.hostname) || !["http:", "https:"].includes(base.protocol) || base.username || base.password ||
  base.pathname !== "/" || base.search || base.hash || !loopback.has(database.hostname) ||
  !["postgres:", "postgresql:"].includes(database.protocol)) {
  throw new Error("Refusing non-loopback API/database or ambiguous API base URL");
}
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const prisma = new PrismaClient();
const runId = randomUUID();
const marker = `unified-http-smoke:${runId}`;
const owned = { users: [], productId: null, skuId: null, legacyMapIds: [], cartItemIds: new Set(), feedbackIds: [] };
const interruption = new AbortController();
const onSignal = () => interruption.abort(new Error("Smoke interrupted; cleaning owned fixtures"));
process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
let assertions = 0, requests = 0, cleanupVerified = false;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function truth(value, message) { assert.ok(value, message); assertions++; }
function form(input) { const result = new FormData(); for (const [key, value] of Object.entries(input)) result.set(key, String(value)); return result; }
async function http(path, { method = "GET", token, body } = {}) {
  const target = new URL(path, base);
  if (target.origin !== base.origin || !path.startsWith("/api/") && path !== "/health/ready") throw new Error("Refusing unapproved HTTP target");
  const response = await fetch(target, { method, redirect: "error", headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body ? { body } : {}), signal: AbortSignal.any([interruption.signal, AbortSignal.timeout(15_000)]) });
  requests++;
  const text = await response.text();
  truth(!/PrismaClientKnownRequestError|node_modules|\bat .+\.ts:\d+/.test(text), `${method} ${path}: no internal stack leak`);
  let json; try { json = JSON.parse(text); } catch { throw new Error(`${method} ${path}: response is not JSON`); }
  return { status: response.status, json };
}
async function success(path, options, label) {
  const result = await http(path, options);
  truth(result.status >= 200 && result.status < 300, `${label}: HTTP success`);
  check(result.json.code, 200, `${label}: legacy envelope`);
  return result.json.data;
}
async function newUser(suffix, passwordHash) {
  let mobile;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `199${randomInt(10_000_000, 100_000_000)}`;
    if (!(await prisma.user.findUnique({ where: { mobile: candidate }, select: { id: true } }))) { mobile = candidate; break; }
  }
  if (!mobile) throw new Error("Cannot allocate an unused synthetic mobile");
  const row = await prisma.user.create({ data: { id: randomUUID(), mobile, passwordHash, nickname: `${marker}:${suffix}` } });
  owned.users.push({ id: row.id, nickname: row.nickname });
  return { id: row.id, mobile, publicId: row.compatibilityId };
}
async function legacyAlias(entityType, targetId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const numeric = randomInt(1_000_000_000, 2_000_000_000);
    const [old, compatibility] = await Promise.all([
      prisma.legacyIdMap.findUnique({ where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_app", entityType, legacyId: String(numeric) } } }),
      prisma.compatibilityId.findUnique({ where: { id: numeric } }),
    ]);
    if (old || compatibility) continue;
    const map = await prisma.legacyIdMap.create({ data: { id: randomUUID(), sourceSystem: "legacy_app", entityType,
      legacyId: String(numeric), targetId, sourceTable: marker } });
    owned.legacyMapIds.push(map.id); return numeric;
  }
  throw new Error("Cannot allocate isolated legacy alias");
}
async function rememberCartRows() {
  if (!owned.users.length) return;
  const rows = await prisma.commerceCartItem.findMany({ where: { cart: { userId: { in: owned.users.map((user) => user.id) } } }, select: { id: true } });
  rows.forEach((row) => owned.cartItemIds.add(row.id));
}
async function cleanup() {
  await rememberCartRows();
  const userIds = owned.users.map((user) => user.id);
  const externalIds = [owned.productId, owned.skuId, ...owned.cartItemIds].filter(Boolean);
  const compatibilityWhere = { OR: [
    { entityType: "mall_product", externalId: owned.productId ?? "no-owned-product" },
    { entityType: "mall_sku", externalId: owned.skuId ?? "no-owned-sku" },
    { entityType: "mall_cart_item", externalId: { in: [...owned.cartItemIds] } },
  ] };
  await prisma.$transaction(async (tx) => {
    // Validate positive ownership markers before scoped deletes. No prefix, broad table or fixed-ID cleanup.
    for (const owner of owned.users) {
      const row = await tx.user.findUnique({ where: { id: owner.id }, select: { nickname: true } });
      if (row && row.nickname !== owner.nickname) throw new Error("Owned user marker changed; refusing cleanup");
    }
    if (owned.productId) {
      const product = await tx.commerceProduct.findUnique({ where: { id: owned.productId }, select: { erpItemId: true } });
      if (product && product.erpItemId !== marker) throw new Error("Owned product marker changed; refusing cleanup");
    }
    await tx.feedback.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { id: { in: owned.feedbackIds } }] } });
    await tx.healthWarningRule.deleteMany({ where: { userId: { in: userIds } } });
    await tx.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await tx.legacySessionCredential.deleteMany({ where: { userId: { in: userIds } } });
    await tx.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
    await tx.commerceCartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } });
    await tx.commerceCart.deleteMany({ where: { userId: { in: userIds } } });
    await tx.compatibilityId.deleteMany({ where: compatibilityWhere });
    await tx.legacyIdMap.deleteMany({ where: { id: { in: owned.legacyMapIds }, sourceTable: marker } });
    if (owned.skuId) await tx.commerceSku.deleteMany({ where: { id: owned.skuId, erpSkuId: marker } });
    if (owned.productId) await tx.commerceProduct.deleteMany({ where: { id: owned.productId, erpItemId: marker } });
    await tx.user.deleteMany({ where: { id: { in: userIds }, nickname: { in: owned.users.map((owner) => owner.nickname) } } });
  });
  const remaining = {
    users: await prisma.user.count({ where: { id: { in: userIds } } }), sessions: await prisma.userSession.count({ where: { userId: { in: userIds } } }),
    feedback: await prisma.feedback.count({ where: { OR: [{ userId: { in: userIds } }, { id: { in: owned.feedbackIds } }] } }),
    warnings: await prisma.healthWarningRule.count({ where: { userId: { in: userIds } } }), carts: await prisma.commerceCart.count({ where: { userId: { in: userIds } } }),
    cartItems: await prisma.commerceCartItem.count({ where: { id: { in: [...owned.cartItemIds] } } }),
    legacyMaps: await prisma.legacyIdMap.count({ where: { id: { in: owned.legacyMapIds } } }),
    compatibilityIds: await prisma.compatibilityId.count({ where: compatibilityWhere }),
    products: await prisma.commerceProduct.count({ where: { id: { in: externalIds } } }),
    skus: await prisma.commerceSku.count({ where: { id: { in: externalIds } } }),
  };
  for (const [table, count] of Object.entries(remaining)) check(count, 0, `cleanup: no owned ${table} remain`);
  cleanupVerified = true;
  console.log(`Owned fixture cleanup verified: ${JSON.stringify(remaining)}`);
}

let failure;
try {
  const ready = await http("/health/ready");
  check(ready.status, 200, "compiled API and database ready");
  const password = `local-only-${randomBytes(18).toString("hex")}`;
  const passwordHash = await hash(password, 12);
  const a = await newUser("A", passwordHash), b = await newUser("B", passwordHash);
  const product = await prisma.commerceProduct.create({ data: { id: randomUUID(), erpItemId: marker, source: "LOCAL", name: marker,
    status: "PUBLISHED", gallery: [], tags: [], coverImage: "https://example.invalid/synthetic.png" } });
  owned.productId = product.id;
  const sku = await prisma.commerceSku.create({ data: { id: randomUUID(), erpSkuId: marker, erpItemId: marker, productId: product.id,
    salePriceCents: 1234, stock: 20, enabled: true, specification: "synthetic-local-sku" } });
  owned.skuId = sku.id;
  const productAlias = await legacyAlias("mall_product", product.id), skuAlias = await legacyAlias("mall_sku", sku.id);
  const sessionA = await success("/api/v1/site/login", { method: "POST", body: form({ username: a.mobile, password }) }, "old multipart login A");
  const sessionB = await success("/api/v1/site/login", { method: "POST", body: form({ username: b.mobile, password }) }, "old multipart login B");
  check(sessionA.member.id, a.publicId, "legacy member numeric identity");
  truth(typeof sessionA.access_token === "string" && sessionA.access_token.length > 20, "old access_token field");
  truth(typeof sessionA.refresh_token === "string" && sessionA.refresh_token.length > 20, "old refresh_token field");
  check(sessionA.expiration_time, 900, "old expiration_time seconds");
  const token = sessionA.access_token;
  const cart = "/api/inv-shop/v1/member/cart-item";
  check(await success(`${cart}/index`, { token }, "initial cart"), [], "new user cart is empty");
  check(await prisma.commerceCart.count({ where: { userId: a.id } }), 0, "GET empty cart does not create a database row");
  let rows = await success(`${cart}/create`, { token, method: "POST", body: form({ sku_id: skuAlias, num: 2 }) }, "old add cart");
  await rememberCartRows();
  check(rows.length, 1, "one cart row"); check(rows[0].num, 2, "initial quantity"); check(rows[0].price, 12.34, "old cart yuan price");
  check(rows[0].sku_id, skuAlias, "preserve old SKU ID"); check(rows[0].product_id, productAlias, "preserve old product ID");
  truth(Number.isInteger(rows[0].id) && rows[0].id > 0, "old cart row ID is numeric"); check(rows[0].available, true, "local active SKU available");
  rows = await success(`${cart}/create`, { token, method: "POST", body: form({ sku_id: skuAlias, num: 3 }) }, "old increment cart");
  check(rows[0].num, 5, "second add increments, does not replace");
  rows = await success(`${cart}/update-num`, { token, method: "POST", body: form({ sku_id: skuAlias, num: 7 }) }, "old set quantity");
  check(rows[0].num, 7, "update replaces quantity");
  const invalid = await http(`${cart}/update-num`, { token, method: "POST", body: form({ sku_id: skuAlias, num: 0 }) });
  check(invalid.status, 200, "legacy transport keeps HTTP 200 for business errors"); check(invalid.json.code, 400, "invalid quantity old error envelope");
  check((await success(`${cart}/index`, { token }, "cart after invalid update"))[0].num, 7, "invalid update does not mutate quantity");
  check(await success(`${cart}/delete-ids`, { token: sessionB.access_token, method: "POST", body: form({ sku_ids: skuAlias }) }, "other user delete"), [], "delete remains scoped to current user");
  check((await success(`${cart}/index`, { token }, "owner cart after foreign delete"))[0].num, 7, "foreign delete does not remove owner row");
  check(await success(`${cart}/delete-ids`, { token, method: "POST", body: form({ sku_ids: skuAlias }) }, "old delete by SKU"), [], "owner cart cleared");
  check(await success(`${cart}/index`, { token }, "final cart"), [], "deleted cart remains empty");
  check((await http(`${cart}/index`)).json.code, 401, "cart requires login");
  const warning = "/api/v1/member/health-warning";
  const initial = await success(`${warning}/preview`, { token }, "warning preview");
  check(initial, { heart_auto: 0, heart_num: 120, blood_pressure_auto: 0, blood_glucose_auto: 0, body_temperature_auto: 0 }, "warning defaults stay disabled");
  const saved = await success(warning, { token, method: "POST", body: form({ heart_auto: 1, heart_num: 135, blood_pressure_auto: 0, blood_glucose_auto: 0, body_temperature_auto: 0 }) }, "old save warning");
  check(saved.heart_auto, 1, "warning enabled"); check(saved.heart_num, 135, "warning threshold persisted in response");
  const readback = await success(`${warning}/preview`, { token }, "warning readback"); check(readback.heart_num, 135, "warning persisted over HTTP");
  const rule = await prisma.healthWarningRule.findUnique({ where: { userId_metric: { userId: a.id, metric: "HEART_RATE" } } });
  check(Number(rule.highThreshold), 135, "warning canonical database threshold"); check(rule.shareWithCare, false, "warning does not silently grant care access");
  const feedback = await success("/api/v1/member/feedback", { token, method: "POST", body: form({ type: "other", content: `${marker}: synthetic feedback only` }) }, "old feedback");
  owned.feedbackIds.push(feedback.id); check(feedback.status, "open", "feedback is actually accepted");
  const storedFeedback = await prisma.feedback.findUnique({ where: { id: feedback.id } }); check(storedFeedback.userId, a.id, "feedback belongs to synthetic user");
  const version = await http("/api/v1/site/version?platform=android&v=2147483647");
  truth(!/^Cannot GET\b/.test(String(version.json.message)), "version route is registered, not a router 404");
  check(version.status, 200, "version preserves legacy HTTP envelope");
  if (version.json.code === 404) {
    check(version.json.message, "暂未发布正式更新信息", "unconfigured production update is explicit business 404");
    check(version.json.code, 404, "unconfigured update legacy error code");
  } else if (version.json.code === 503) {
    check(version.json.message, "正式更新配置无效，请联系管理员", "invalid existing update config is an explicit business error");
  } else { check(version.status, 200, "configured update HTTP success"); check(version.json.code, 200, "configured update legacy envelope"); check(version.json.data, null, "higher client build has no upgrade"); }
} catch (error) { failure = error; }
finally {
  try { await cleanup(); } catch (error) { failure ??= error; console.error(`Cleanup failed for run ${runId}; do not rerun blindly.`); }
  await prisma.$disconnect();
  process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
}
if (failure) {
  // Never print Prisma connection diagnostics, environment, synthetic credentials or access tokens.
  console.error(`Unified HTTP smoke FAILED: ${failure instanceof assert.AssertionError ? failure.message : String(failure?.name || "Error")}; assertions=${assertions}; requests=${requests}; cleanup=${cleanupVerified}; run=${runId}`);
  process.exitCode = 1;
} else console.log(`Unified HTTP smoke passed: ${assertions} assertions; ${requests} HTTP requests; cleanup=${cleanupVerified}; run=${runId}`);
