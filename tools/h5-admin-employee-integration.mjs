// Opt-in acceptance against existing dedicated 5175 admin / 5174 shop proxies.
// Does not start processes, invoke providers, create payments, or touch UI orders.
import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseEnv } from "node:util";

assert.equal(process.env.RUN_H5_ADMIN_EMPLOYEE_ACCEPTANCE, "1", "Explicit demo acceptance opt-in required");
const [repoInput, profileInput] = process.argv.slice(2);
assert.ok(repoInput && profileInput && isAbsolute(repoInput) && isAbsolute(profileInput), "Supply absolute repository and private demo profile paths");
assert.ok(!/^[\\/]{2}/.test(repoInput) && !/^[\\/]{2}/.test(profileInput), "Repository and profile must not use UNC network paths");
const repo = resolve(repoInput), profilePath = resolve(profileInput);
const profileRelative = relative(repo, profilePath);
assert.ok(profileRelative === ".." || profileRelative.startsWith(".." + sep) || isAbsolute(profileRelative), "Profile must be outside the repository");
const profile = parseEnv(await readFile(profilePath, "utf8"));
for (const [key, value] of Object.entries({ H5_DEMO_ENABLED: "true", NODE_ENV: "development", HOST: "127.0.0.1", PORT: "8081", ALLOW_TEST_OTP: "true", WORKER_OUTBOUND_PAUSED: "true", CALLBACK_PROCESSING_PAUSED: "true", VITE_API_PROXY_TARGET: "http://127.0.0.1:8081" })) assert.equal(profile[key], value, "Wrong isolated demo setting: " + key);
assert.equal(profile.H5_DEMO_ADMIN_USERNAME, "h5-demo-admin");
assert.ok(profile.H5_DEMO_ADMIN_PASSWORD?.length >= 16, "Private demo admin password missing");
let database;
try { database = new URL(profile.DATABASE_URL); } catch { throw new Error("Invalid demo database URL; value withheld"); }
assert.ok(["postgres:", "postgresql:"].includes(database.protocol) && ["127.0.0.1", "localhost"].includes(database.hostname));
assert.equal(database.pathname, "/saydian_h5_demo");
// Only this exact safe legacy profile parameter is accepted; host/socket/other
// query overrides can bypass a connection driver's URL hostname validation.
assert.ok(["", "?schema=public"].includes(database.search) && !database.hash, "Database URL query overrides are forbidden");
database.hostname = "127.0.0.1";
assert.equal(new URL(profile.PUBLIC_BASE_URL).origin, "http://127.0.0.1:8081");
assert.equal(new URL(profile.COMMERCE_STOREFRONT_URL).origin, "http://127.0.0.1:5174");
const sessionPath = resolve(profile.H5_DEMO_SESSION_PATH ?? "");
assert.equal(dirname(sessionPath), dirname(profilePath), "Employee session must be in the private demo profile directory");
const employeeSession = JSON.parse(await readFile(sessionPath, "utf8"));
assert.equal(employeeSession.scope, "isolated-loopback-demo");
assert.ok(Date.parse(employeeSession.expiresAt) > Date.now() + 120_000, "Private demo employee session is expired or too close to expiry; regenerate with demo seed");
assert.ok(typeof employeeSession.token === "string" && employeeSession.token.length > 40);
// Applies to this executable only; it does not mutate any running API's env.
Object.assign(process.env, { H5_DEMO_ENABLED: "true", NODE_ENV: "development" });
const require = createRequire(join(repo, "apps/api/package.json"));
require(join(repo, "tools/h5-demo-network-guard.cjs"));
const { PrismaClient } = require("@prisma/client"), QRCode = require("qrcode");
const prisma = new PrismaClient({ datasources: { db: { url: database.toString() } } });
const fixtureId = name => { const h = createHash("sha256").update("saydian-h5-demo-v1:" + name).digest("hex"); return h.slice(0,8)+"-"+h.slice(8,12)+"-4"+h.slice(13,16)+"-a"+h.slice(17,20)+"-"+h.slice(20,32); };
assert.equal(employeeSession.employeeId, fixtureId("employee"));
const runId = randomUUID(), marker = "H5-DEMO-ACCEPT-" + runId, started = new Date();
const journalPath = join(dirname(profilePath), "h5-admin-employee-" + runId + ".json");
const owned = { users: [], orders: [], productId: randomUUID(), skuId: randomUUID(), couponId: randomUUID() };
const restores = [], cleanupErrors = [];
let adminToken, adminSessionId, snapshot, journalWritten = false, stage = "preflight", assertions = 0, requests = 0, failure;
const stop = new AbortController();
const onSignal = () => stop.abort();
process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
const check = (a, b, label) => { assert.deepEqual(a, b, label); assertions++; };
const truth = (value, label) => { assert.ok(value, label); assertions++; };
const bases = { admin: "http://127.0.0.1:5175", shop: "http://127.0.0.1:5174" };
const adminRoot = "/api/saydian-app/admin/v1", mallRoot = "/api/saidian-mall/v1";
async function http(surface, path, { method = "GET", token, body, cleanup = false } = {}) {
  const url = new URL(path, bases[surface]);
  truth(url.origin === bases[surface] && url.pathname.startsWith("/api/") && !url.username && !url.password, "HTTP target stays on the selected local proxy");
  const response = await fetch(url, { method, redirect: "error", signal: cleanup ? AbortSignal.timeout(15_000) : AbortSignal.any([stop.signal, AbortSignal.timeout(15_000)]), headers: {
    ...(token ? { authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  requests++;
  const raw = await response.text();
  truth(!/postgres(?:ql)?:\/\/|-----BEGIN .* KEY-----|PrismaClientKnownRequestError|node_modules/.test(raw), "No internal diagnostics or database secrets in response");
  let json; try { json = JSON.parse(raw); } catch { throw new Error("Expected JSON from local proxy; body withheld"); }
  return { status: response.status, data: surface === "admin" && Object.hasOwn(json, "data") ? json.data : json };
}
async function ok(surface, path, options) { const result = await http(surface, path, options); truth(result.status >= 200 && result.status < 300, "Expected successful local API response"); return result.data; }
const admin = (path, options = {}) => ok("admin", adminRoot + path, { ...options, token: adminToken });
const shop = (path, options) => ok("shop", mallRoot + path, options);
const employee = (path, options = {}) => shop("/wecom/me" + path, { ...options, token: employeeSession.token });
async function journal(cleanupComplete = false) {
  await writeFile(journalPath, JSON.stringify({ scope: "isolated-loopback-demo", runId, database: "saydian_h5_demo", snapshot, owned, cleanupComplete, cleanupErrors }, null, 2), { ...(journalWritten ? {} : { flag: "wx" }), mode: 0o600 });
  journalWritten = true;
}
async function newConsumer(label) {
  let mobile;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = "199" + randomInt(10_000_000, 100_000_000);
    if (!await prisma.user.findUnique({ where: { mobile: candidate } }) && !await prisma.smsCode.count({ where: { mobile: candidate } })) { mobile = candidate; break; }
  }
  truth(mobile, "Unique synthetic mobile allocated");
  const row = { id: randomUUID(), mobile, nickname: marker + ":" + label };
  owned.users.push(row); await journal();
  await prisma.user.create({ data: row });
  const otp = await shop("/auth/sms/request", { method: "POST", body: { mobile } });
  truth(/^\d{6}$/.test(otp.devCode ?? ""), "Dedicated demo OTP is supplied without SMS provider");
  const login = await shop("/auth/sms/login", { method: "POST", body: { mobile, code: otp.devCode, consentVersion: "commerce-legal-v1" } });
  check(login.user.id, row.id, "Consumer session matches own synthetic user");
  return { ...row, token: login.token };
}
async function restoreField(model, id, field, before, testValue) {
  const row = await prisma[model].findUnique({ where: { id } });
  if (row?.[field] === before) return;
  const result = await prisma[model].updateMany({ where: { id, [field]: testValue }, data: { [field]: before } });
  check(result.count, 1, "Refuse to overwrite a concurrently changed fixture field");
}
async function cleanupOwned() {
  await prisma.$transaction(async tx => {
    const userIds = owned.users.map(user => user.id);
    for (const own of owned.users) { const row = await tx.user.findUnique({ where: { id: own.id } }); if (row) check(row.nickname, own.nickname, "User cleanup ownership marker"); }
    for (const own of owned.orders) { const row = await tx.commerceOrder.findUnique({ where: { id: own.id } }); if (row) { check(row.orderNo, own.orderNo, "Order cleanup ownership marker"); check(row.status, "CANCELLED", "Never remove a progressed test order"); check(row.paidAt, null, "Never remove a paid test order"); } }
    const coupon = await tx.commerceCoupon.findUnique({ where: { id: owned.couponId } });
    if (coupon) {
      check(coupon.name, marker + ":gift", "Coupon cleanup ownership marker");
      check(await tx.commerceCouponClaim.count({ where: { couponId: coupon.id, OR: [{ userId: { notIn: userIds } }, { orderId: { not: null } }, { usedAt: { not: null } }] } }), 0, "Never remove a foreign or used coupon claim");
      await tx.commerceCouponClaim.deleteMany({ where: { couponId: coupon.id, userId: { in: userIds }, orderId: null, usedAt: null } });
      await tx.commerceCouponGift.deleteMany({ where: { couponId: coupon.id, employeeId: fixtureId("employee") } });
      await tx.commerceEmployeeCouponGrant.deleteMany({ where: { couponId: coupon.id, employeeId: fixtureId("employee") } });
      await tx.commerceCoupon.delete({ where: { id: coupon.id } });
    }
    await tx.commerceOrder.deleteMany({ where: { id: { in: owned.orders.map(row => row.id) }, orderNo: { in: owned.orders.map(row => row.orderNo) }, status: "CANCELLED", paidAt: null } });
    const product = await tx.commerceProduct.findUnique({ where: { id: owned.productId } });
    if (product) { check(product.erpItemId, marker + ":product", "Product cleanup ownership marker"); await tx.commerceProduct.delete({ where: { id: product.id } }); }
    for (const own of owned.users) {
      // No bulk deletion by phone prefix, date alone, or shared fixture user ID.
      await tx.smsCode.deleteMany({ where: { mobile: own.mobile, createdAt: { gte: started } } });
      await tx.userSession.deleteMany({ where: { userId: own.id } });
      await tx.consentRecord.deleteMany({ where: { userId: own.id } });
      await tx.commerceAddress.deleteMany({ where: { userId: own.id } });
      await tx.user.deleteMany({ where: { id: own.id, nickname: own.nickname } });
    }
  }, { timeout: 30_000 });
}

try {
  stage = "verify isolated server, fixture ownership and provider gates";
  for (const surface of ["shop", "admin"]) { const result = await http(surface, mallRoot + "/storefront/capabilities"); check(result.status, 200, "Demo capabilities through both proxies"); check(result.data.demo, true, "Proxy targets dedicated demo"); truth(result.data.payments.every(row => !row.enabled), "Real payment channels disabled"); }
  check(await prisma.integrationSecret.count(), 0, "No provider secrets in demo DB");
  check(await prisma.integrationConfig.count({ where: { state: "CONFIGURED" } }), 0, "No configured provider in demo DB");
  check(await prisma.commerceCouponGift.count({ where: { status: "RESERVED", expiresAt: { lt: new Date(Date.now() + 120_000) } } }), 0, "Prevent expireGifts from mutating unrelated expired or expiring gifts");
  const fixture = await prisma.commerceProduct.findUniqueOrThrow({ where: { id: fixtureId("product:FF2100") }, include: { skus: true } });
  check(fixture.erpItemId, "H5-DEMO-LOCAL-0", "Fixture source ownership"); check(fixture.source, "LOCAL", "Only LOCAL fixture editable"); check(fixture.status, "PUBLISHED", "Fixture remains published");
  check(fixture.skus.length, 1, "Expected the single fixture SKU"); const sku = fixture.skus[0]; check(sku.id, fixtureId("sku:FF2100"), "Fixture SKU ID"); check(sku.erpSkuId, "H5-DEMO-LOCAL-SKU-0", "Fixture SKU marker"); truth(sku.enabled && !fixture.localArchived, "Fixture remains publicly available");
  const banner = await prisma.commerceBanner.findUniqueOrThrow({ where: { id: fixtureId("banner") } }); truth(banner.enabled, "Fixture banner is visible"); truth(banner.targetUrl?.includes(fixture.id), "Fixture banner target ownership");
  const coupon = await prisma.commerceCoupon.findUniqueOrThrow({ where: { id: fixtureId("coupon") } }); check(coupon.type, "CASH", "Fixture coupon type"); truth(coupon.name.startsWith("演示券"), "Fixture coupon marker");
  const plan = await prisma.commerceCommissionPlan.findUnique({ where: { id: "default" } }); truth(!plan?.enabled || !plan.withdrawalEnabled, "Withdrawal must remain disabled throughout acceptance");
  const existingUiOrders = (await prisma.commerceOrder.findMany({ where: { userId: fixtureId("member") }, select: { id: true, orderNo: true, status: true, payableCents: true, version: true }, orderBy: { id: "asc" } }));
  snapshot = { productId: fixture.id, skuId: sku.id, price: sku.salePriceCents, stock: sku.stock, bannerId: banner.id, title: banner.title, couponId: coupon.id, couponValue: coupon.value, existingUiOrders };
  await journal();
  const login = await ok("admin", adminRoot + "/auth/login", { method: "POST", body: { username: profile.H5_DEMO_ADMIN_USERNAME, password: profile.H5_DEMO_ADMIN_PASSWORD } });
  check(login.user.id, fixtureId("admin"), "Admin proxy uses the same owned demo admin"); adminToken = login.token; adminSessionId = login.sessionId;
  const products = await admin("/commerce-products?search=H5-DEMO-LOCAL-0"); check(products.items.find(row => row.id === fixture.id)?.skus[0].salePriceCents, sku.salePriceCents, "Admin API reads current fixture price");
  check((await admin("/commerce-banners")).find(row => row.id === banner.id)?.title, banner.title, "Admin API reads current fixture banner");
  check((await admin("/commerce-coupons")).find(row => row.id === coupon.id)?.value, coupon.value, "Admin API reads current fixture coupon value");
  const a = await newConsumer("A"), b = await newConsumer("B");
  stage = "admin edit -> storefront price stock banner and coupon update";
  const newPrice = sku.salePriceCents + 137, newStock = Math.max(sku.stock + 3, 3), newTitle = "隔离验收 " + runId.slice(0,8), newValue = coupon.value + 1;
  restores.push(() => restoreField("commerceSku", sku.id, "salePriceCents", sku.salePriceCents, newPrice), () => restoreField("commerceSku", sku.id, "stock", sku.stock, newStock));
  await admin("/commerce-products/" + fixture.id, { method: "PATCH", body: { skus: [{ ...sku, salePriceCents: newPrice, stock: newStock }] } });
  restores.push(() => restoreField("commerceBanner", banner.id, "title", banner.title, newTitle)); await admin("/commerce-banners/" + banner.id, { method: "PATCH", body: { title: newTitle } });
  restores.push(() => restoreField("commerceCoupon", coupon.id, "value", coupon.value, newValue)); await admin("/commerce-coupons/" + coupon.id, { method: "PATCH", body: { value: newValue } });
  const detail = await shop("/storefront/products/" + fixture.id); check(detail.skus[0].salePriceCents, newPrice, "Public product updated price"); check(detail.skus[0].stock, newStock, "Public product updated stock"); truth(!JSON.stringify(detail.skus).includes("costPriceCents"), "No public SKU cost leak");
  const home = await shop("/storefront/bootstrap"); check(home.banners.find(row => row.id === banner.id)?.title, newTitle, "Public bootstrap updated banner");
  const quote = await shop("/storefront/orders/preview", { method: "POST", token: a.token, body: { items: [{ skuId: sku.id, quantity: 1 }] } }); check(quote.quote.subtotalCents, newPrice, "Server checkout quote uses admin price");
  check((await employee("/coupons")).find(row => row.id === coupon.id)?.value, newValue, "5174 employee coupon contract uses admin value");

  stage = "local employee promotion and separated consumer identity";
  const promotion = await employee("/promotion?productId=" + fixture.id);
  check(new URL(promotion.linkUrl).origin, bases.shop, "Promotion uses local storefront"); truth(promotion.linkUrl.includes("ref=H5DEMO") && promotion.linkUrl.includes(fixture.id), "Promotion carries employee and product");
  truth(promotion.qrDataUrl.startsWith("data:image/png;base64,"), "Promotion returns a PNG");
  const png = Buffer.from(promotion.qrDataUrl.split(",")[1], "base64"); check(png.subarray(0,8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  check(png, await QRCode.toBuffer(promotion.linkUrl, { width: 600, margin: 2, errorCorrectionLevel: "H" }), "PNG is the actual QR encoding of the returned local link");
  check((await http("shop", mallRoot + "/wecom/me/dashboard", { token: a.token })).status, 401, "Consumer cannot access employee scope");
  check((await http("shop", mallRoot + "/storefront/cart", { token: employeeSession.token })).status, 401, "Employee token is not a consumer session");
  await prisma.commerceCoupon.create({ data: { id: owned.couponId, name: marker + ":gift", type: "CASH", status: "ACTIVE", value: 137, minimumSpendCents: 0, totalQuantity: 1, employeeDistributable: true, perEmployeeLimit: 1, employeeClaimBatchSize: 1, validFrom: new Date(Date.now()-60_000), validUntil: new Date(Date.now()+86_400_000) } });
  const gifts = await employee("/coupons/" + owned.couponId + "/claim", { method: "POST", body: { quantity: 1 } }); check(gifts.length, 1, "Employee allocates one owned test gift");
  const giftUrl = new URL(gifts[0].linkUrl); check(giftUrl.origin, bases.shop, "Gift link stays local"); const giftToken = new URLSearchParams(giftUrl.hash.split("?")[1]).get("token"); truth(giftToken, "Gift token provided; never logged");
  const giftPath = "/storefront/coupon-gifts/" + encodeURIComponent(giftToken);
  check((await shop(giftPath)).coupon.id, owned.couponId, "Public gift metadata matches owned coupon");
  check((await http("shop", mallRoot + giftPath + "/claim", { method: "POST", token: employeeSession.token })).status, 401, "Employee cannot redeem as customer");
  const claim = await shop(giftPath + "/claim", { method: "POST", token: a.token }); check(claim.userId, a.id, "Gift binds to consumer A"); check(claim.sourceEmployeeId, fixtureId("employee"), "Gift attribution retains employee");
  check((await http("shop", mallRoot + giftPath + "/claim", { method: "POST", token: b.token })).status, 400, "Consumed gift cannot bind a second consumer");
  check((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).referralEmployeeId, fixtureId("employee"), "A receives referral binding"); check((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).referralEmployeeId, null, "B stays a separate unbound consumer");
  check((await shop("/storefront/coupons", { token: a.token })).some(row => row.couponId === owned.couponId), true, "A sees owned gift coupon"); check((await shop("/storefront/coupons", { token: b.token })).some(row => row.couponId === owned.couponId), false, "B does not see A coupon");

  stage = "employee real pagination and time/data scope";
  await prisma.commerceProduct.create({ data: { id: owned.productId, erpItemId: marker + ":product", name: marker, source: "LOCAL", status: "DRAFT", gallery: [], tags: [], skus: { create: { id: owned.skuId, erpSkuId: marker + ":sku", erpItemId: marker + ":product", salePriceCents: 100, stock: 0 } } } });
  const start = new Date("2020-01-01T00:00:00+08:00"), end = new Date("2020-01-02T00:00:00+08:00");
  for (const [label, createdAt, employeeId] of [["first", new Date(start.valueOf()+2000), fixtureId("employee")], ["second", new Date(start.valueOf()+1000), fixtureId("employee")], ["outside", new Date(end.valueOf()+1000), fixtureId("employee")], ["unattributed", new Date(start.valueOf()+3000), null]]) {
    const own = { id: randomUUID(), orderNo: marker + ":" + label }; owned.orders.push(own); await journal();
    // Explicit synthetic CANCELLED rows: no payment, stock hold, commission or outbound job.
    await prisma.commerceOrder.create({ data: { ...own, userId: a.id, referralEmployeeId: employeeId, status: "CANCELLED", subtotalCents: 100, payableCents: 100, recipientName: marker, recipientMobile: a.mobile, province: "测试", city: "测试", district: "测试", addressDetail: "本地合成，禁止发货", buyerRemark: marker, idempotencyKey: own.orderNo, createdAt, cancelledAt: createdAt,
      items: { create: { productId: owned.productId, skuId: owned.skuId, erpSkuIdSnapshot: marker + ":sku", nameSnapshot: marker, unitPriceCents: 100, quantity: 1, totalCents: 100 } } } });
  }
  const expected = await prisma.commerceOrder.findMany({ where: { referralEmployeeId: fixtureId("employee"), createdAt: { gte: start, lt: end } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  truth(expected.length >= 2, "Non-empty second page has real synthetic fixture rows");
  const query = "/dashboard?range=custom&from=2020-01-01&to=2020-01-01&pageSize=1&page=";
  for (const page of [1,2]) { const dashboard = await employee(query + page); check(dashboard.pagination.page, page, "Page honored"); check(dashboard.pagination.pageSize, 1, "Page size honored"); check(dashboard.pagination.total, expected.length, "Employee/time-scoped count"); check(dashboard.orders.map(row => row.id), [expected[page-1].id], "Employee/time-scoped stable page"); check(dashboard.range.start, start.toISOString(), "China-time lower bound"); check(dashboard.range.end, end.toISOString(), "Exclusive China-time upper bound"); check(dashboard.trend, null, "No fabricated daily trend"); check(dashboard.trendStatus, "UNAVAILABLE", "Unknown trend explicitly unavailable"); }
  for (const path of ["/dashboard?range=custom&from=2020-01-02&to=2020-01-01", "/dashboard?page=0", "/dashboard?range=unknown"]) check((await http("shop", mallRoot + "/wecom/me" + path, { token: employeeSession.token })).status, 400, "Invalid dashboard query rejected");

  stage = "unconfigured withdrawal fails without changing wallet";
  const beforeWallet = await prisma.commerceEmployeeWallet.findUnique({ where: { employeeId: fixtureId("employee") } });
  const beforeWithdrawals = await prisma.commerceWithdrawal.count({ where: { employeeId: fixtureId("employee") } });
  const summary = await employee("/withdrawals"); check(summary.canApply, false, "Withdrawal unavailable"); check(summary.payoutMode, "MANUAL_RECEIPT_ONLY", "No provider payout mode");
  check((await http("shop", mallRoot + "/wecom/me/withdrawals", { method: "POST", token: employeeSession.token, body: { amountCents: 100, idempotencyKey: marker + "-denied-withdrawal" } })).status, 503, "Unconfigured withdrawal rejected");
  check(await prisma.commerceWithdrawal.count({ where: { employeeId: fixtureId("employee") } }), beforeWithdrawals, "No withdrawal record created");
  check(await prisma.commerceEmployeeWallet.findUnique({ where: { employeeId: fixtureId("employee") } }), beforeWallet, "Wallet unchanged");
  check(await prisma.commerceOrder.findMany({ where: { userId: fixtureId("member") }, select: { id: true, orderNo: true, status: true, payableCents: true, version: true }, orderBy: { id: "asc" } }), existingUiOrders, "Existing UI demo orders unchanged");
} catch (error) { failure = { stage, type: error.name, detail: "Assertion/API failed; sensitive values withheld" }; }
finally {
  stage = "cleanup";
  for (const [index, restore] of [...restores].reverse().entries()) { try { await restore(); } catch { cleanupErrors.push("Fixture field restore conflict at reverse index " + index + "; inspect private journal, never blindly overwrite"); } }
  try { await cleanupOwned(); } catch { cleanupErrors.push("Owned fixture cleanup failed; inspect exact IDs in private journal; existing UI orders were not targeted"); }
  if (snapshot && cleanupErrors.length === 0) try {
    const detail = await shop("/storefront/products/" + snapshot.productId, { cleanup: true });
    check(detail.skus.find(row => row.id === snapshot.skuId)?.salePriceCents, snapshot.price, "Public price restored");
    check(detail.skus.find(row => row.id === snapshot.skuId)?.stock, snapshot.stock, "Public stock restored");
    check((await shop("/storefront/bootstrap", { cleanup: true })).banners.find(row => row.id === snapshot.bannerId)?.title, snapshot.title, "Public banner restored");
    check((await prisma.commerceCoupon.findUniqueOrThrow({ where: { id: snapshot.couponId } })).value, snapshot.couponValue, "Fixture coupon value restored");
    check(await prisma.commerceCoupon.count({ where: { id: owned.couponId } }), 0, "Owned gift coupon removed");
    check(await prisma.commerceOrder.count({ where: { id: { in: owned.orders.map(row => row.id) } } }), 0, "Only own synthetic dashboard orders removed");
    check(await prisma.user.count({ where: { id: { in: owned.users.map(row => row.id) } } }), 0, "Only own consumers removed");
  } catch { cleanupErrors.push("Post-cleanup API/database verification failed"); }
  if (adminToken) try { await admin("/auth/logout", { method: "POST", cleanup: true }); } catch { cleanupErrors.push("Demo test admin session logout failed"); }
  if (adminSessionId) try { await prisma.adminSession.deleteMany({ where: { id: adminSessionId, adminId: fixtureId("admin") } }); } catch { cleanupErrors.push("Exact test admin session cleanup failed"); }
  if (journalWritten) { try { await journal(cleanupErrors.length === 0); } catch { cleanupErrors.push("Private cleanup journal update failed"); } }
  await prisma.$disconnect(); process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
}
console.log(JSON.stringify({ scope: "isolated-demo-admin-employee", passed: !failure && cleanupErrors.length === 0, assertions, requests, failure, cleanupErrors, journal: journalWritten ? journalPath : null,
  boundaries: "Only loopback 5174/5175 API calls; no browser, providers, payment or successful withdrawal; existing UI orders preserved; audit records retained" }, null, 2));
if (failure || cleanupErrors.length) process.exitCode = 1;
