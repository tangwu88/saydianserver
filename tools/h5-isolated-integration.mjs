// Opt-in local-only acceptance. This executable is not imported by AppModule.
// It never starts/stops/reconfigures the existing 8080/5173/8081 processes.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join, isAbsolute } from "node:path";
import { parseEnv } from "node:util";

assert.equal(process.env.RUN_H5_ISOLATED_ACCEPTANCE, "1", "Set RUN_H5_ISOLATED_ACCEPTANCE=1 for the isolated local test");
const [repoInput, profileInput] = process.argv.slice(2);
assert.ok(repoInput && profileInput && isAbsolute(repoInput) && isAbsolute(profileInput), "Supply absolute repo and isolated demo profile paths");
const repo = resolve(repoInput), profile = parseEnv(await readFile(profileInput, "utf8"));
assert.equal(profile.H5_DEMO_ENABLED, "true"); assert.equal(profile.NODE_ENV, "development");
assert.equal(profile.HOST, "127.0.0.1"); assert.equal(profile.PORT, "8081");
assert.equal(profile.ALLOW_TEST_OTP, "true");
let database;
try { database = new URL(profile.DATABASE_URL); } catch { throw new Error("Invalid demo database URL; value withheld"); }
assert.ok(["postgres:", "postgresql:"].includes(database.protocol));
assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
assert.equal(database.pathname, "/saydian_h5_demo");
assert.ok(["", "?schema=public"].includes(database.search) && !database.hash);
assert.equal(new URL(profile.PUBLIC_BASE_URL).origin, "http://127.0.0.1:8081");
for (const key of ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_PEPPER"]) assert.ok(profile[key]?.length >= 32, "Demo-only signing material is required");
// Explicit whitelist: never inherit or load provider environment credentials.
for (const key of Object.keys(process.env)) if (/^(WECHAT|WECOM|ALIPAY|SMS_|JUSHUITAN|OBJECT_STORAGE|APPLE_|PUSH_|AI_)/.test(key)) delete process.env[key];
for (const key of ["DATABASE_URL", "ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_PEPPER", "EMPLOYEE_TOKEN_SECRET", "INTEGRATION_MASTER_KEY", "COMMERCE_STOREFRONT_URL"]) {
  if (profile[key]) process.env[key] = profile[key];
}
Object.assign(process.env, { NODE_ENV: "development", H5_DEMO_ENABLED: "true", ALLOW_TEST_OTP: "true",
  MAINTENANCE_READ_ONLY: "false", BUSINESS_WRITES_PAUSED: "false", WORKER_OUTBOUND_PAUSED: "false",
  CALLBACK_PROCESSING_PAUSED: "false", LEGACY_SESSION_BRIDGE_ENABLED: "false", LEGACY_TOKEN_EXCHANGE_ENABLED: "false",
  SMS_PROVIDER: "disabled", PUBLIC_BASE_URL: "http://127.0.0.1:8081",
  TS_NODE_PROJECT: join(repo, "apps/api/tsconfig.json"), DOTENV_CONFIG_PATH: join(repo, "does-not-exist.test-env") });

const require = createRequire(join(repo, "apps/api/package.json"));
// Install the same TCP/TLS/HTTP/DNS/UNC boundary before loading Prisma or Nest.
// The extra fetch allowlist below further limits this test's HTTP ports.
require(join(repo, "tools/h5-demo-network-guard.cjs"));
const { PrismaClient } = require("@prisma/client"), { hash } = require("bcryptjs");
const prisma = new PrismaClient();
const runId = randomUUID(), marker = `h5-acceptance:${runId}`, started = new Date();
const owned = { users: [], products: [], coupons: [], eventKeys: [], admins: [] };
const allowedPorts = new Set(["8080", "8081", "5173"]);
const realFetch = globalThis.fetch;
let blockedOutbound = 0, assertions = 0, requests = 0, app, failure, cleanupVerified = false, beforeListeners;
let lastAction = "preflight";
const interrupted = new AbortController();
const onSignal = () => interrupted.abort();
process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !allowedPorts.has(url.port) || url.username || url.password) {
    blockedOutbound++; throw new Error("Non-allowlisted network request blocked by local acceptance");
  }
  return realFetch(input, { ...init, redirect: "error", signal: AbortSignal.any([interrupted.signal, AbortSignal.timeout(15_000)]) });
};
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const truth = (value, message) => { assert.ok(value, message); assertions++; };
async function rejects(work, message) {
  let rejected = false; try { await work(); } catch { rejected = true; }
  truth(rejected, message);
}
function listeners() {
  assert.equal(process.platform, "win32", "This acceptance includes Windows PID/start-time preservation checks");
  // Query all listeners before filtering: Get-NetTCPConnection -LocalPort throws
  // when one optional service is absent. Always serialize an array, including [].
  const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in 8080,5173,8081 } | Select-Object LocalPort,OwningProcess -Unique | ForEach-Object { $p=Get-Process -Id $_.OwningProcess; [pscustomobject]@{port=$_.LocalPort;pid=$_.OwningProcess;start=$p.StartTime.ToUniversalTime().ToString('o')} } | Sort-Object port,pid)";
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true }).trim());
}
async function http(base, path, { method = "GET", token, body, headers = {} } = {}) {
  lastAction = `${method} ${path}`;
  const response = await fetch(new URL(path, base), { method, headers: { ...(body ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  requests++;
  const text = await response.text();
  truth(!/PrismaClient|node_modules|postgres(?:ql)?:\/\/|-----BEGIN .* KEY-----/.test(text), `${method} ${path}: no internal diagnostics/secrets`);
  let json; try { json = JSON.parse(text); } catch { throw new assert.AssertionError({ message: `${path}: expected JSON`, actual: response.status, expected: 200 }); }
  return { status: response.status, json };
}
async function ok(base, path, options) {
  const result = await http(base, path, options);
  truth(result.status >= 200 && result.status < 300, `${options?.method ?? "GET"} ${path}: expected 2xx, got ${result.status} (${String(result.json.message ?? "").slice(0,100)})`);
  return result.json;
}
async function denied(base, path, options) {
  const result = await http(base, path, options);
  truth([400, 401, 403, 404, 409].includes(result.status), `${path}: foreign/invalid request denied, got ${result.status}`);
  return result;
}
async function newUser(label, passwordHash) {
  let mobile;
  for (let i = 0; i < 20; i++) {
    const candidate = `199${randomInt(10_000_000, 100_000_000)}`;
    if (!(await prisma.user.findUnique({ where: { mobile: candidate } })) && !(await prisma.smsCode.count({ where: { mobile: candidate } }))) { mobile = candidate; break; }
  }
  truth(mobile, "allocated an unused synthetic mobile");
  const row = await prisma.user.create({ data: { mobile, passwordHash, nickname: `${marker}:${label}` } });
  owned.users.push({ id: row.id, mobile, nickname: row.nickname });
  return row;
}
async function newProduct(price, stock, label) {
  const erpItemId = `${marker}:${label}`;
  const row = await prisma.commerceProduct.create({ data: {
    erpItemId, name: erpItemId, source: "LOCAL", status: "PUBLISHED", gallery: [], tags: [],
    skus: { create: { erpSkuId: erpItemId, erpItemId, salePriceCents: price, stock, enabled: true } },
  }, include: { skus: true } });
  owned.products.push({ id: row.id, erpItemId });
  return row.skus[0];
}
async function smsLogin(base, member) {
  const otp = await ok(base, "/api/saidian-mall/v1/auth/sms/request", { method: "POST", body: { mobile: member.mobile } });
  truth(/^\d{6}$/.test(otp.devCode ?? ""), "local test OTP is available without SMS provider");
  const session = await ok(base, "/api/saidian-mall/v1/auth/sms/login", { method: "POST", body: {
    mobile: member.mobile, code: otp.devCode, consentVersion: "commerce-legal-v1",
  } });
  check(session.user.id, member.id, "SMS login reuses canonical mobile account");
  truth(session.token && session.refreshToken && !session.data, "raw mall session is preserved");
  return session.token;
}
async function cleanup() {
  const userIds = owned.users.map(row => row.id);
  let ownedOrderIds = [], ownedSaleIds = [];
  await prisma.$transaction(async tx => {
    for (const own of owned.users) {
      const row = await tx.user.findUnique({ where: { id: own.id } });
      if (row && row.nickname !== own.nickname) throw new Error("User fixture ownership marker changed; refusing cleanup");
    }
    for (const own of owned.products) {
      const row = await tx.commerceProduct.findUnique({ where: { id: own.id } });
      if (row && row.erpItemId !== own.erpItemId) throw new Error("Product fixture marker changed; refusing cleanup");
    }
    const orders = await tx.commerceOrder.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const orderIds = orders.map(row => row.id);
    ownedOrderIds = orderIds;
    ownedSaleIds = (await tx.commerceAfterSale.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })).map(row => row.id);
    const intents = await tx.paymentIntent.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    await tx.auditLog.deleteMany({ where: { actorId: { in: owned.admins.map(row => row.id) }, createdAt: { gte: started } } });
    await tx.providerEvent.deleteMany({ where: { provider: "wechat_pay", eventKey: { in: owned.eventKeys } } });
    await tx.commerceCommissionLedger.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.commerceCommissionAccrual.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.paymentRefund.deleteMany({ where: { paymentIntentId: { in: intents.map(row => row.id) } } });
    await tx.paymentIntent.deleteMany({ where: { id: { in: intents.map(row => row.id) } } });
    await tx.commerceAfterSale.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.commercePointLedger.deleteMany({ where: { userId: { in: userIds } } });
    await tx.commerceCouponClaim.deleteMany({ where: { userId: { in: userIds } } });
    await tx.commerceIntegrationJob.deleteMany({ where: { OR: [
      { aggregateType: "commerce_order", aggregateId: { in: orderIds } },
      { aggregateType: "commerce_after_sale", aggregateId: { in: ownedSaleIds } },
    ] } });
    await tx.commerceShipment.deleteMany({ where: { orderId: { in: orderIds } } });
    // CommerceReview's user/product/orderItem FKs are restrictive, not cascading.
    // Delete only reviews attached to this run's verified owned orders before their items.
    await tx.commerceReview.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
    await tx.commerceOrder.deleteMany({ where: { id: { in: orderIds } } });
    await tx.commerceCartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } });
    await tx.commerceCart.deleteMany({ where: { userId: { in: userIds } } });
    await tx.commerceAddress.deleteMany({ where: { userId: { in: userIds } } });
    await tx.commercePointAccount.deleteMany({ where: { userId: { in: userIds } } });
    await tx.smsCode.deleteMany({ where: { mobile: { in: owned.users.map(row => row.mobile) }, createdAt: { gte: started } } });
    await tx.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await tx.consentRecord.deleteMany({ where: { userId: { in: userIds } } });
    await tx.idempotencyRecord.deleteMany({ where: { userId: { in: userIds } } });
    await tx.commerceCoupon.deleteMany({ where: { id: { in: owned.coupons } } });
    await tx.commerceProduct.deleteMany({ where: { id: { in: owned.products.map(row => row.id) } } });
    await tx.user.deleteMany({ where: { id: { in: userIds }, nickname: { in: owned.users.map(row => row.nickname) } } });
    await tx.adminSession.deleteMany({ where: { adminId: { in: owned.admins.map(row => row.id) } } });
    await tx.adminUser.deleteMany({ where: { id: { in: owned.admins.map(row => row.id) }, username: { in: owned.admins.map(row => row.username) } } });
  }, { timeout: 60_000 });
  check(await prisma.user.count({ where: { id: { in: userIds } } }), 0, "no owned users remain");
  check(await prisma.commerceProduct.count({ where: { id: { in: owned.products.map(row => row.id) } } }), 0, "no owned products remain");
  check(await prisma.commerceOrder.count({ where: { userId: { in: userIds } } }), 0, "no owned orders remain");
  check(await prisma.commerceReview.count({ where: { userId: { in: userIds } } }), 0, "no owned reviews remain");
  check(await prisma.commerceIntegrationJob.count({ where: { OR: [
    { aggregateType: "commerce_order", aggregateId: { in: ownedOrderIds } },
    { aggregateType: "commerce_after_sale", aggregateId: { in: ownedSaleIds } },
  ] } }), 0, "no owned order or after-sale integration jobs remain");
  check(await prisma.providerEvent.count({ where: { eventKey: { in: owned.eventKeys } } }), 0, "no owned callback events remain");
  check(await prisma.smsCode.count({ where: { mobile: { in: owned.users.map(row => row.mobile) }, createdAt: { gte: started } } }), 0, "no owned OTP records remain");
  check(await prisma.commercePointLedger.count({ where: { userId: { in: userIds } } }), 0, "no owned point ledger remains");
  check(await prisma.adminUser.count({ where: { id: { in: owned.admins.map(row => row.id) } } }), 0, "no owned test approvers remain");
  cleanupVerified = true;
}

try {
  beforeListeners = listeners();
  if (beforeListeners.some(row => row.port === 8080)) check((await http("http://127.0.0.1:8080", "/health/ready")).status, 200, "original API ready");
  if (beforeListeners.some(row => row.port === 5173)) check((await fetch("http://127.0.0.1:5173/admin/")).status, 200, "original admin responds");
  check(await prisma.integrationSecret.count(), 0, "demo DB contains no stored provider secrets");
  const suppliers = ["sms","wechat_pay","alipay","wechat_official","wechat_login","wecom","jushuitan","push","ai"];
  check(await prisma.integrationConfig.count({ where: { key: { in: suppliers }, state: "CONFIGURED" } }), 0, "real supplier integrations remain unconfigured");
  const base = "http://127.0.0.1:8081";
  const capabilities = await ok(base, "/api/saidian-mall/v1/storefront/capabilities");
  check(capabilities.demo, true, "dedicated API declares demo mode");
  check(capabilities.login.sms.enabled, true, "demo SMS enabled");
  truth(capabilities.payments.every(row => !row.enabled), "no real payment channel is advertised");
  truth(!/secret|privateKey|merchantId|accessToken|appId/i.test(JSON.stringify(capabilities)), "capabilities have no private fields");
  const password = randomBytes(24).toString("hex"), passwordHash = await hash(password, 12);
  const a = await newUser("A", passwordHash), b = await newUser("B", passwordHash);
  const aToken = await smsLogin(base, a), bToken = await smsLogin(base, b);
  truth((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).mobileVerifiedAt, "SMS verification persisted");
  const passwordSession = await ok(base, "/api/saidian-mall/v1/auth/password/login", { method: "POST", body: { mobile: a.mobile, password } });
  check(passwordSession.user.id, a.id, "password and SMS share stable user ID");
  const refreshRace = await Promise.all([1,2].map(() => http(base, "/api/saidian-mall/v1/auth/refresh",
    { method: "POST", body: { refreshToken: passwordSession.refreshToken } })));
  check(refreshRace.filter(row => row.status >= 200 && row.status < 300).length, 1, "only one HTTP refresh request wins");
  check(refreshRace.filter(row => row.status === 401).length, 1, "losing refresh is explicitly unauthorized");
  check(refreshRace.find(row => row.status >= 200 && row.status < 300).json.user.id, a.id, "refresh keeps stable user ID");
  await denied(base, "/api/saidian-mall/v1/auth/refresh", { method: "POST", body: { refreshToken: passwordSession.refreshToken } });
  await denied(base, "/api/saidian-mall/v1/storefront/cart", { token: passwordSession.token });
  await denied(base, "/api/saidian-mall/v1/auth/password/login", { method: "POST", body: { mobile: a.mobile, password: "wrong-local-password" } });
  const sku = await newProduct(1001, 20, "normal");
  const addressInput = { name: marker, mobile: a.mobile, province: "测试省", city: "测试市", district: "测试区", detail: "本地合成地址禁止发货" };
  const address = await ok(base, "/api/saidian-mall/v1/storefront/addresses", { method: "POST", token: aToken, body: addressInput });
  await denied(base, `/api/saidian-mall/v1/storefront/addresses/${address.id}`, { method: "PATCH", token: bToken, body: { ...addressInput, name: "foreign-attempt" } });
  check((await prisma.commerceAddress.findUniqueOrThrow({ where: { id: address.id } })).name, marker, "foreign address update did not mutate owner");
  const cartPath = "/api/saidian-mall/v1/storefront/cart/items";
  await ok(base, cartPath, { method: "POST", token: aToken, body: { skuId: sku.id, quantity: 2, mode: "increment" } });
  await ok(base, cartPath, { method: "POST", token: aToken, body: { skuId: sku.id, quantity: 3, mode: "increment" } });
  const cart = await ok(base, "/api/saidian-mall/v1/storefront/cart", { token: aToken });
  check(cart.items[0].quantity, 5, "cart increment is additive");
  await prisma.commercePointAccount.create({ data: { userId: a.id, balanceCents: 2000 } });
  const coupon = await prisma.commerceCoupon.create({ data: { name: marker, type: "CASH", status: "ACTIVE", value: 101,
    validFrom: new Date(Date.now()-1000), validUntil: new Date(Date.now()+3600_000) } });
  owned.coupons.push(coupon.id);
  const claim = await prisma.commerceCouponClaim.create({ data: { userId: a.id, couponId: coupon.id } });
  const orderBody = { addressId: address.id, items: [{ skuId: sku.id, quantity: 3 }], pointCents: 901, couponClaimId: claim.id };
  const preview = await ok(base, "/api/saidian-mall/v1/storefront/orders/preview", { method: "POST", token: aToken, body: orderBody });
  check(preview.quote.subtotalCents, 3003, "quote subtotal uses integer cents");
  check(preview.quote.couponDiscountCents, 101, "quote applies coupon");
  check(preview.quote.pointDiscountCents, 901, "quote applies verified points");
  check(preview.quote.payableCents, 2001+preview.quote.shippingCents, "quote money conservation");
  await denied(base, "/api/saidian-mall/v1/storefront/orders/preview", { method: "POST", token: bToken, body: orderBody });
  const createOptions = { method: "POST", token: aToken, headers: { "idempotency-key": `${marker}:blackbox-order` }, body: orderBody };
  const order = await ok(base, "/api/saidian-mall/v1/storefront/orders", createOptions);
  check(order.payableCents, preview.quote.payableCents, "order and preview agree");
  check((await ok(base, "/api/saidian-mall/v1/storefront/orders", createOptions)).id, order.id, "duplicate order returns existing ID");
  await denied(base, "/api/saidian-mall/v1/storefront/orders", { ...createOptions, body: { ...orderBody, pointCents: 900 } });
  check(await prisma.commerceOrder.count({ where: { userId: a.id } }), 1, "only one order was created");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 1099, "order debits points exactly once");
  await denied(base, `/api/saidian-mall/v1/storefront/orders/${order.id}`, { token: bToken });
  const samplePayment = await prisma.paymentIntent.create({ data: { userId: a.id, businessType: "COMMERCE_ORDER", businessId: order.id,
    commerceOrderId: order.id, paymentNo: `${marker}:query-only`, channel: "WECHAT_H5", amountCents: order.payableCents,
    description: marker, idempotencyKey: `${marker}:query-only` } });
  await denied(base, `/api/saidian-mall/v1/payments/${samplePayment.id}`, { token: bToken });
  check((await ok(base, `/api/saidian-mall/v1/payments/${samplePayment.id}`, { token: aToken })).id, samplePayment.id, "owner can query synthetic unpaid relation");
  await prisma.paymentIntent.delete({ where: { id: samplePayment.id } });
  await ok(base, `/api/saidian-mall/v1/storefront/orders/${order.id}/cancel`, { method: "POST", token: aToken });
  await denied(base, `/api/saidian-mall/v1/storefront/orders/${order.id}/cancel`, { method: "POST", token: aToken });
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 2000, "cancel returns points once");
  check((await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.id } })).stock, 20, "cancel restores inventory once");
  console.log(`Black-box phase passed; assertions=${assertions}; no existing process changed.`);

  // Dedicated Nest composition with actual guards/controllers/services but an
  // injected payment adapter. No test routes are added to the production app.
  require("reflect-metadata"); require("ts-node/register/transpile-only");
  const load = file => require(join(repo, "apps/api/src", file));
  const { Module, UnauthorizedException } = require("@nestjs/common"), { NestFactory, Reflector } = require("@nestjs/core");
  const { json, urlencoded } = require("express");
  const { PrismaService } = load("common/prisma.service.ts");
  const { AuthService } = load("auth/auth.service.ts"), { WechatH5AuthService } = load("auth/wechat-h5-auth.service.ts");
  const { UserAuthGuard } = load("common/user-auth.guard.ts");
  const { CommerceStoreService } = load("commerce/commerce-store.service.ts"), { CommerceService } = load("commerce/commerce.service.ts");
  const { CommerceCapabilitiesService } = load("commerce/commerce-capabilities.service.ts");
  const { CommerceCompatibilityController } = load("commerce/commerce-compat.controller.ts");
  const { PaymentProviderService } = load("billing/payment-provider.service.ts"), { BillingService } = load("billing/billing.service.ts");
  const { ApiEnvelopeInterceptor } = load("common/api-envelope.interceptor.ts"), { SafeHttpExceptionFilter } = load("common/http-exception.filter.ts");
  const callbackKey = randomBytes(32), calls = { create: 0, refund: 0, decode: 0 };
  let refundMode = "processing";
  const fake = {
    identity: async () => ({ merchantId: "LOCAL_TEST_MERCHANT", appId: "LOCAL_TEST_APP" }),
    assertIdentity: async intent => { assert.equal(intent.providerMerchantId, "LOCAL_TEST_MERCHANT"); assert.equal(intent.providerAppId, "LOCAL_TEST_APP"); },
    create: async intent => { calls.create++; return { type: "TEST_ONLY", paymentNo: intent.paymentNo, testRun: runId }; },
    refund: async request => {
      calls.refund++;
      if (refundMode === "unknown") throw new Error("Synthetic unknown refund outcome; no network attempted");
      return { completed: false, providerRefundId: `LOCAL_REFUND_${request.refundNo}`, amountCents: request.amountCents,
        refundNo: request.refundNo, paymentNo: request.paymentNo, providerTransactionId: request.providerTransactionId,
        currency: request.currency, payload: { status: "PROCESSING", testRun: runId } };
    },
    decodeWechatNotification: async (headers, body, raw) => {
      const supplied = Buffer.from(headers["x-local-test-signature"] ?? "", "hex");
      const expected = createHmac("sha256", callbackKey).update(raw).digest();
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || body.testRun !== runId) throw new UnauthorizedException("Invalid isolated test callback signature");
      calls.decode++; return body.resource;
    },
  };
  const disabledSecrets = { resolve: async () => { throw new Error("Real provider secret access blocked in test composition"); } };
  const auth = new AuthService(prisma, { send: async () => { throw new Error("Real SMS blocked"); } }, disabledSecrets, {});
  const official = new WechatH5AuthService(prisma, auth, disabledSecrets);
  const store = new CommerceStoreService(prisma), billing = new BillingService(prisma, fake, {});
  const commerce = new CommerceService(prisma, store, billing), capabilityService = new CommerceCapabilitiesService(prisma, disabledSecrets, official);
  class IsolatedAcceptanceModule {}
  Module({ controllers: [CommerceCompatibilityController], providers: [
    [PrismaService, prisma], [AuthService, auth], [WechatH5AuthService, official], [BillingService, billing],
    [PaymentProviderService, fake], [CommerceService, commerce], [CommerceCapabilitiesService, capabilityService],
    [UserAuthGuard, new UserAuthGuard(prisma)],
  ].map(([provide, useValue]) => ({ provide, useValue })) })(IsolatedAcceptanceModule);
  app = await NestFactory.create(IsolatedAcceptanceModule, { logger: false, bodyParser: false });
  app.use(json({ verify: (request, response, buffer) => { request.rawBody = Buffer.from(buffer); } }), urlencoded({ extended: true }));
  app.useGlobalFilters(new SafeHttpExceptionFilter()); app.useGlobalInterceptors(new ApiEnvelopeInterceptor(app.get(Reflector)));
  await app.listen(0, "127.0.0.1");
  const port = String(app.getHttpServer().address().port);
  truth(!["8080","8081","5173","5174","5175"].includes(port), "test bootstrap uses a distinct ephemeral loopback port");
  allowedPorts.add(port); const injected = `http://127.0.0.1:${port}`;
  async function callback(path, resource, label) {
    const id = `${marker}:${label}`; owned.eventKeys.push(id);
    const body = { id, testRun: runId, resource };
    const signature = createHmac("sha256", callbackKey).update(JSON.stringify(body)).digest("hex");
    return ok(injected, path, { method: "POST", body, headers: { "x-local-test-signature": signature } });
  }
  const financed = await ok(injected, "/api/saidian-mall/v1/storefront/orders", {
    method: "POST", token: aToken, headers: { "idempotency-key": `${marker}:financed` }, body: orderBody,
  });
  const paymentInput = { orderId: financed.id, channel: "wechat_h5", idempotencyKey: `${marker}:pay` };
  const payment = await ok(injected, "/api/saidian-mall/v1/payments/create", { method: "POST", token: aToken, body: paymentInput });
  check((await ok(injected, "/api/saidian-mall/v1/payments/create", { method: "POST", token: aToken, body: paymentInput })).id, payment.id, "payment retry reuses intent");
  check(calls.create, 1, "fake provider create dispatched exactly once");
  const paidPayload = { out_trade_no: payment.paymentNo, transaction_id: `${marker}:paid-transaction`, trade_state: "SUCCESS",
    mchid: "LOCAL_TEST_MERCHANT", appid: "LOCAL_TEST_APP", amount: { total: payment.amountCents, currency: "CNY" } };
  await denied(injected, "/api/saidian-mall/v1/payments/wechat/notify", { method: "POST", body: { id: `${marker}:unsigned`, testRun: runId, resource: paidPayload } });
  check(await prisma.providerEvent.count({ where: { eventKey: `${marker}:unsigned` } }), 0, "unsigned callback never persists");
  await Promise.all([callback("/api/saidian-mall/v1/payments/wechat/notify", paidPayload, "paid-a"), callback("/api/saidian-mall/v1/payments/wechat/notify", paidPayload, "paid-b")]);
  check((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } })).status, "SUCCEEDED", "duplicate callbacks converge to paid");
  check((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: financed.id } })).status, "PAID", "paid order transition persisted");
  check(await prisma.commercePointLedger.count({ where: { orderId: financed.id, type: "ORDER_REDEMPTION" } }), 1, "payment callbacks cannot debit points again");
  const item = await prisma.commerceOrderItem.findFirstOrThrow({ where: { orderId: financed.id } });
  async function afterSale(quantity, label) {
    const body = { type: "REFUND_ONLY", reason: `${marker}:${label}`, items: [{ orderItemId: item.id, quantity }] };
    const quote = await ok(injected, `/api/saidian-mall/v1/storefront/orders/${financed.id}/after-sales/preview`,
      { method: "POST", token: aToken, body });
    const sale = await ok(injected, `/api/saidian-mall/v1/storefront/orders/${financed.id}/after-sales`, { method: "POST", token: aToken, body: { ...body, orderVersion: quote.orderVersion } });
    await prisma.commerceAfterSale.update({ where: { id: sale.id }, data: { status: "APPROVED" } });
    return sale;
  }
  const first = await afterSale(1, "first-partial");
  check(first.shippingRefundCents, 0, "first partial merchandise return does not infer shipping compensation");
  await rejects(() => store.afterSaleQuote(a.id, financed.id, { type: "REFUND_ONLY", items: [{ orderItemId: item.id, quantity: 1 }] }), "in-flight same item cannot reserve a second refund");
  const refund = await billing.refundAfterSale(first.id, { reason: "本地合成退款" });
  check(calls.refund, 1, "one fake refund dispatch");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 1099, "processing refund does not release points");
  await billing.createRefund(payment.id, { amountCents: refund.amountCents, afterSaleId: first.id, reason: "本地合成退款", idempotencyKey: `after-sale-refund:${first.id}` });
  check(calls.refund, 1, "processing refund retry never dispatches twice");
  const refundPayload = { out_refund_no: refund.refundNo, refund_id: refund.providerRefundId, out_trade_no: payment.paymentNo,
    transaction_id: paidPayload.transaction_id, mchid: paidPayload.mchid, appid: paidPayload.appid,
    amount: { refund: refund.amountCents, total: payment.amountCents, currency: "CNY" } };
  await Promise.all([
    callback("/api/saidian-mall/v1/payments/wechat/refund-notify", { ...refundPayload, refund_status: "CLOSED" }, "refund-closed"),
    callback("/api/saidian-mall/v1/payments/wechat/refund-notify", { ...refundPayload, refund_status: "SUCCESS" }, "refund-success"),
  ]);
  check((await prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })).status, "SUCCEEDED", "closed/success race preserves success");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 1399, "first quantity returns exactly 300 point cents");
  await callback("/api/saidian-mall/v1/payments/wechat/refund-notify", { ...refundPayload, refund_status: "SUCCESS" }, "refund-replay");
  check(await prisma.commercePointLedger.count({ where: { afterSaleId: first.id, type: "AFTER_SALE_RETURN" } }), 1, "point return ledger is idempotent");
  const second = await afterSale(2, "second-partial");
  check(second.pointReturnCents, 601, "last quantity receives the exact point remainder");
  check(second.shippingRefundCents, 0, "last partial merchandise return still does not automatically refund shipping");
  refundMode = "unknown";
  await rejects(() => billing.refundAfterSale(second.id, {}), "unknown provider outcome is not a success");
  const uncertain = await prisma.paymentRefund.findUniqueOrThrow({ where: { idempotencyKey: `after-sale-refund:${second.id}` } });
  const beforeRetry = calls.refund;
  await billing.createRefund(payment.id, { amountCents: uncertain.amountCents, afterSaleId: second.id, reason: "本地合成退款", idempotencyKey: uncertain.idempotencyKey });
  check(calls.refund, beforeRetry, "unknown refund is not automatically resent");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 1399, "unknown refund keeps remaining point reservation");
  await callback("/api/saidian-mall/v1/payments/wechat/refund-notify", { ...refundPayload, out_refund_no: uncertain.refundNo,
    refund_id: `LOCAL_REFUND_${uncertain.refundNo}`, refund_status: "SUCCESS", amount: { refund: uncertain.amountCents, total: payment.amountCents, currency: "CNY" } }, "unknown-reconciled");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 2000, "all quantities restore the original points exactly");
  const pointOnlySku = await newProduct(1, 1, "point-only-line"), cashSku = await newProduct(100, 1, "cash-line");
  const mixedBody = { addressId: address.id, items: [{ skuId: pointOnlySku.id, quantity: 1 }, { skuId: cashSku.id, quantity: 1 }], pointCents: 100 };
  const mixedOrder = await ok(injected, "/api/saidian-mall/v1/storefront/orders", {
    method: "POST", token: aToken, headers: { "idempotency-key": `${marker}:mixed-lines` }, body: mixedBody,
  });
  const mixedPayment = await ok(injected, "/api/saidian-mall/v1/payments/create", { method: "POST", token: aToken,
    body: { orderId: mixedOrder.id, channel: "wechat_h5", idempotencyKey: `${marker}:mixed-pay` } });
  await callback("/api/saidian-mall/v1/payments/wechat/notify", { ...paidPayload, out_trade_no: mixedPayment.paymentNo,
    transaction_id: `${marker}:mixed-paid`, amount: { total: mixedPayment.amountCents, currency: "CNY" } }, "mixed-paid");
  const pointOnlyItem = await prisma.commerceOrderItem.findFirstOrThrow({ where: { orderId: mixedOrder.id, skuId: pointOnlySku.id } });
  check(pointOnlyItem.cashPaidCentsSnapshot, 0, "largest remainder creates a pure-point merchandise line");
  check(pointOnlyItem.pointDiscountCentsSnapshot, 1, "pure-point line allocation is exact");
  const pureRequest = { type: "REFUND_ONLY", reason: `${marker}:point-only`, items: [{ orderItemId: pointOnlyItem.id, quantity: 1 }] };
  const pureQuote = await ok(injected, `/api/saidian-mall/v1/storefront/orders/${mixedOrder.id}/after-sales/preview`, { method: "POST", token: aToken, body: pureRequest });
  check(pureQuote.requestedCents, 0, "pure-point item before other returns has no cash refund");
  const pureSale = await ok(injected, `/api/saidian-mall/v1/storefront/orders/${mixedOrder.id}/after-sales`,
    { method: "POST", token: aToken, body: { ...pureRequest, orderVersion: pureQuote.orderVersion } });
  await prisma.commerceAfterSale.update({ where: { id: pureSale.id }, data: { status: "APPROVED" } });
  const beforePureRefund = calls.refund;
  const localSettlement = await billing.refundAfterSale(pureSale.id, {});
  await billing.refundAfterSale(pureSale.id, {});
  check(localSettlement.cashRefundCents, 0, "pure-point settlement is local and explicit");
  check(calls.refund, beforePureRefund, "pure-point settlement never dispatches a channel refund");
  check(await prisma.paymentRefund.count({ where: { afterSaleId: pureSale.id } }), 0, "no zero-money channel refund row exists");
  check(await prisma.commercePointLedger.count({ where: { afterSaleId: pureSale.id, type: "AFTER_SALE_RETURN" } }), 1, "pure-point settlement is idempotent");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, 1901, "pure-point settlement returns only its own allocation");
  truth((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: mixedOrder.id } })).status !== "REFUNDED", "remaining cash merchandise is not hidden");
  // Customer return-logistics acceptance: the remaining line has cash=1 and points=99.
  // Only this run's newly created after-sale is put into WAITING_RETURN as a review fixture.
  const mixedCashItem = await prisma.commerceOrderItem.findFirstOrThrow({ where: { orderId: mixedOrder.id, skuId: cashSku.id } });
  check(mixedCashItem.cashPaidCentsSnapshot, 1, "remaining mixed-order merchandise cash is one cent");
  check(mixedCashItem.pointDiscountCentsSnapshot, 99, "remaining mixed-order merchandise points are 99 cents");
  const returnRequest = { type: "RETURN_REFUND", reason: `${marker}:return-logistics`, items: [{ orderItemId: mixedCashItem.id, quantity: 1 }] };
  const returnQuote = await ok(injected, `/api/saidian-mall/v1/storefront/orders/${mixedOrder.id}/after-sales/preview`,
    { method: "POST", token: aToken, body: returnRequest });
  check(returnQuote.requestedCents, 1, "return logistics scenario reserves only its own cash");
  check(returnQuote.pointReturnCents, 99, "return logistics scenario reserves only its own points");
  const returnSale = await ok(injected, `/api/saidian-mall/v1/storefront/orders/${mixedOrder.id}/after-sales`,
    { method: "POST", token: aToken, body: { ...returnRequest, orderVersion: returnQuote.orderVersion } });
  check(returnSale.orderId, mixedOrder.id, "new return claim belongs to the owned mixed order");
  const waitingFixture = await prisma.commerceAfterSale.updateMany({
    where: { id: returnSale.id, orderId: mixedOrder.id, type: "RETURN_REFUND", status: "APPLIED", executionOwner: "NEW_SYSTEM" },
    data: { status: "WAITING_RETURN", version: { increment: 1 } },
  });
  check(waitingFixture.count, 1, "only the owned pending return claim is changed by the review fixture");
  const waitingSale = await prisma.commerceAfterSale.findUniqueOrThrow({ where: { id: returnSale.id } });
  const returnPath = `/api/saidian-mall/v1/storefront/orders/${mixedOrder.id}/after-sales/${returnSale.id}/return-logistics`;
  const returnInput = { logisticsCompany: "本地合成物流", trackingNo: `LOCAL-${runId}`, version: waitingSale.version };
  await denied(injected, returnPath, { method: "POST", token: bToken, body: returnInput });
  const beforeLogisticsCalls = calls.refund;
  const beforeLogisticsPoints = (await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents;
  const returnSaved = await http(injected, returnPath, { method: "POST", token: aToken, body: returnInput });
  check(returnSaved.status, 200, "owner registers return logistics over the real HTTP route");
  check(returnSaved.json.status, "WAITING_RETURN", "parcel registration is not proof of return receipt");
  check(returnSaved.json.returnLogisticsCompany, returnInput.logisticsCompany, "return carrier is persisted");
  check(returnSaved.json.returnTrackingNo, returnInput.trackingNo, "return tracking number is persisted");
  check(returnSaved.json.version, waitingSale.version + 1, "return logistics increments only the after-sale version");
  const returnRepeated = await ok(injected, returnPath, { method: "POST", token: aToken, body: returnInput });
  check(returnRepeated.version, returnSaved.json.version, "identical old-version retry does not write again");
  const returnStale = await denied(injected, returnPath, { method: "POST", token: aToken, body: { ...returnInput, trackingNo: `CHANGED-${runId}` } });
  check(returnStale.status, 409, "changed tracking with the stale version is rejected");
  const returnFinal = await prisma.commerceAfterSale.findUniqueOrThrow({ where: { id: returnSale.id } });
  check(returnFinal.status, "WAITING_RETURN", "HTTP retries and foreign requests never mark the return received");
  check(returnFinal.returnTrackingNo, returnInput.trackingNo, "stale request cannot overwrite original tracking");
  check(calls.refund, beforeLogisticsCalls, "parcel registration does not dispatch a channel refund");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, beforeLogisticsPoints, "parcel registration does not settle points");
  check(await prisma.paymentRefund.count({ where: { afterSaleId: returnSale.id } }), 0, "parcel registration creates no cash refund");
  // Explicit shipping-compensation fixture: set only this owned order's
  // shipping/payable fields before payment, preserving item conservation.
  // No global store configuration or pre-existing order is changed.
  const shippingOrder = await store.createOrder(a.id, { addressId: address.id, items: [{ skuId: sku.id, quantity: 2 }],
    idempotencyKey: `${marker}:shipping-order` });
  await prisma.commerceOrder.update({ where: { id: shippingOrder.id }, data: {
    shippingCents: 599, payableCents: shippingOrder.payableCents - shippingOrder.shippingCents + 599,
  } });
  const shippingPayment = await ok(injected, "/api/saidian-mall/v1/payments/create", { method: "POST", token: aToken,
    body: { orderId: shippingOrder.id, channel: "wechat_h5", idempotencyKey: `${marker}:shipping-pay` } });
  const shippingPaidPayload = { ...paidPayload, out_trade_no: shippingPayment.paymentNo, transaction_id: `${marker}:shipping-paid`,
    amount: { total: shippingPayment.amountCents, currency: "CNY" } };
  await callback("/api/saidian-mall/v1/payments/wechat/notify", shippingPaidPayload, "shipping-paid");
  const shippingItem = await prisma.commerceOrderItem.findFirstOrThrow({ where: { orderId: shippingOrder.id } });
  refundMode = "processing";
  for (const number of [1,2]) {
    const body = { type: "REFUND_ONLY", reason: `${marker}:shipping-goods-${number}`, items: [{ orderItemId: shippingItem.id, quantity: 1 }] };
    const quote = await store.afterSaleQuote(a.id, shippingOrder.id, body);
    const sale = await store.createAfterSale(a.id, shippingOrder.id, { ...body, orderVersion: quote.orderVersion });
    check(sale.shippingRefundCents, 0, "partial goods return leaves freight for separate review");
    await prisma.commerceAfterSale.update({ where: { id: sale.id }, data: { status: "APPROVED" } });
    const goodsRefund = await billing.refundAfterSale(sale.id, {});
    await callback("/api/saidian-mall/v1/payments/wechat/refund-notify", {
      out_refund_no: goodsRefund.refundNo, refund_id: goodsRefund.providerRefundId, out_trade_no: shippingPayment.paymentNo,
      transaction_id: shippingPaidPayload.transaction_id, mchid: shippingPaidPayload.mchid, appid: shippingPaidPayload.appid,
      refund_status: "SUCCESS", amount: { refund: goodsRefund.amountCents, total: shippingPayment.amountCents, currency: "CNY" },
    }, `shipping-goods-refunded-${number}`);
  }
  const { AdminService } = load("admin/admin.service.ts");
  const admin = new AdminService(prisma, disabledSecrets);
  for (const [label, role] of [["maker", "FINANCE"], ["reviewer", "SUPER_ADMIN"]]) {
    const row = await prisma.adminUser.create({ data: { username: `${marker}:${label}`, displayName: marker, passwordHash, role, roles: [role] } });
    owned.admins.push({ id: row.id, username: row.username, role, roles: [role] });
  }
  const maker = owned.admins[0], reviewer = owned.admins[1];
  const freight = await admin.shippingRefundPreview(shippingOrder.id);
  check(freight.maximumCents, 599, "all merchandise refunded leaves precisely the original freight");
  const freightSale = await admin.createShippingRefund(shippingOrder.id, { amountCents: 599, reason: "独立本地运费补退验收",
    requestKey: `${marker}:shipping-request`, orderVersion: freight.orderVersion }, maker);
  check(freightSale.type, "SHIPPING_ONLY", "freight compensation has its own after-sale type");
  check(freightSale.status, "APPLIED", "new freight compensation awaits approval");
  check(freightSale.pointReturnCents, 0, "freight compensation never returns points");
  await assert.rejects(admin.shippingRefundPreview(shippingOrder.id), /已有处理中运费申请/);
  assertions += 1;
  await rejects(() => admin.createShippingRefund(shippingOrder.id, { amountCents: 1, reason: "重复占用运费验收",
    requestKey: `${marker}:shipping-over-reserve`, orderVersion: freight.orderVersion }, maker), "second request cannot over-reserve shipping");
  const beforeFreightCalls = calls.refund;
  await rejects(() => billing.refundAfterSale(freightSale.id, {}), "unapproved freight cannot dispatch a refund");
  check(calls.refund, beforeFreightCalls, "review gate prevents supplier dispatch");
  await admin.updateCommerceAfterSale(freightSale.id, { status: "APPROVED", version: freightSale.version }, reviewer);
  const pointsBeforeFreight = (await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents;
  const freightRefund = await billing.refundAfterSale(freightSale.id, {});
  check(freightRefund.amountCents, 599, "approved shipping refund matches its exact reserved cash");
  check(freightRefund.merchandiseRefundCents, 0, "shipping refund does not reverse merchandise commission base");
  await assert.rejects(admin.shippingRefundPreview(shippingOrder.id), /已有处理中运费申请/);
  assertions += 1;
  const freightPayload = { out_refund_no: freightRefund.refundNo, refund_id: freightRefund.providerRefundId,
    out_trade_no: shippingPayment.paymentNo, transaction_id: shippingPaidPayload.transaction_id,
    mchid: shippingPaidPayload.mchid, appid: shippingPaidPayload.appid, refund_status: "SUCCESS",
    amount: { refund: 599, total: shippingPayment.amountCents, currency: "CNY" } };
  await callback("/api/saidian-mall/v1/payments/wechat/refund-notify", freightPayload, "shipping-only-refunded");
  await callback("/api/saidian-mall/v1/payments/wechat/refund-notify", freightPayload, "shipping-only-replay");
  check((await prisma.commerceAfterSale.findUniqueOrThrow({ where: { id: freightSale.id } })).status, "COMPLETED", "shipping completes only after confirmed callback");
  check((await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } })).balanceCents, pointsBeforeFreight, "shipping settlement leaves points unchanged");
  check(await prisma.commercePointLedger.count({ where: { afterSaleId: freightSale.id } }), 0, "shipping has no invented point ledger");
  check((await admin.shippingRefundPreview(shippingOrder.id)).maximumCents, 0, "successful freight cannot be requested again");
  const lastSku = await newProduct(1000, 1, "last-unit");
  const races = await Promise.allSettled(["a","b"].map(label => store.createOrder(a.id, { addressId: address.id, items: [{ skuId: lastSku.id, quantity: 1 }], idempotencyKey: `${marker}:last-unit:${label}` })));
  check(races.filter(row => row.status === "fulfilled").length, 1, "last inventory unit has only one winner");
  check((await prisma.commerceSku.findUniqueOrThrow({ where: { id: lastSku.id } })).stock, 0, "inventory never becomes negative");
  // Review eligibility fixture touches only the just-created last-unit winner.
  const reviewOrder = races.find(row => row.status === "fulfilled").value;
  const reviewReady = await prisma.commerceOrder.updateMany({
    where: { id: reviewOrder.id, userId: a.id, status: "PENDING_PAYMENT" },
    data: { status: "COMPLETED", receivedAt: new Date() },
  });
  check(reviewReady.count, 1, "only the owned last-unit winner becomes reviewable in the fixture");
  const reviewItem = await prisma.commerceOrderItem.findFirstOrThrow({ where: { orderId: reviewOrder.id, skuId: lastSku.id } });
  const originalReview = { orderItemId: reviewItem.id, rating: 5, content: `${marker}:first-review`, images: [] };
  await denied(injected, "/api/saidian-mall/v1/storefront/reviews", { method: "POST", token: bToken, body: originalReview });
  const review = await ok(injected, "/api/saidian-mall/v1/storefront/reviews", { method: "POST", token: aToken, body: originalReview });
  check(review.orderItemId, reviewItem.id, "COMPLETED owned item accepts a review over HTTP");
  check(review.content, originalReview.content, "first review content is stored");
  const repeatedReview = await ok(injected, "/api/saidian-mall/v1/storefront/reviews",
    { method: "POST", token: aToken, body: { ...originalReview, content: `${marker}:must-not-overwrite`, rating: 1 } });
  check(repeatedReview.id, review.id, "duplicate review returns the original record");
  check(repeatedReview.content, originalReview.content, "duplicate review cannot replace the original content");
  check(repeatedReview.rating, 5, "duplicate review cannot replace the original rating");
  await denied(injected, "/api/saidian-mall/v1/storefront/reviews", { method: "POST", token: bToken, body: { ...originalReview, content: "其他人不可修改" } });
  check(await prisma.commerceReview.count({ where: { orderItemId: reviewItem.id } }), 1, "one order item has exactly one real review after retries");
  check((await prisma.commerceReview.findUniqueOrThrow({ where: { orderItemId: reviewItem.id } })).content, originalReview.content, "database retains the original review");

  // Quote-change contract over the actual demo API, using only this run's
  // independent product/coupon. Never mutate the retained browser QA fixtures.
  const fingerprintSku = await newProduct(1000, 3, "quote-fingerprint");
  const fingerprintCoupon = await prisma.commerceCoupon.create({ data: {
    name: `${marker}:quote-fingerprint-coupon`, type: "CASH", status: "ACTIVE", value: 101,
    validFrom: new Date(Date.now() - 1000), validUntil: new Date(Date.now() + 3600_000),
  } });
  owned.coupons.push(fingerprintCoupon.id);
  const fingerprintClaim = await prisma.commerceCouponClaim.create({ data: { userId: a.id, couponId: fingerprintCoupon.id } });
  const fingerprintBody = { addressId: address.id, items: [{ skuId: fingerprintSku.id, quantity: 1 }],
    pointCents: 100, couponClaimId: fingerprintClaim.id };
  const fingerprintKey = `${marker}:quote-fingerprint-order`;
  const quoteBeforePriceChange = await ok(base, "/api/saidian-mall/v1/storefront/orders/preview", { method: "POST", token: aToken, body: fingerprintBody });
  const oldFingerprint = quoteBeforePriceChange.quote.fingerprint;
  truth(/^q1:[0-9a-f]{64}$/.test(oldFingerprint ?? ""), "preview exposes a versioned quote fingerprint");
  async function fingerprintAssets() {
    return {
      stock: (await prisma.commerceSku.findUniqueOrThrow({ where: { id: fingerprintSku.id } })).stock,
      points: await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: a.id } }),
      claim: await prisma.commerceCouponClaim.findUniqueOrThrow({ where: { id: fingerprintClaim.id } }),
      coupon: await prisma.commerceCoupon.findUniqueOrThrow({ where: { id: fingerprintCoupon.id } }),
      orders: await prisma.commerceOrder.count({ where: { userId: a.id } }),
      pointLedger: await prisma.commercePointLedger.count({ where: { userId: a.id } }),
      payments: await prisma.paymentIntent.count({ where: { userId: a.id } }),
    };
  }
  const fingerprintPriceChanged = await prisma.commerceSku.updateMany({
    where: { id: fingerprintSku.id, erpSkuId: `${marker}:quote-fingerprint`, product: { source: "LOCAL" } },
    data: { salePriceCents: 1100 },
  });
  check(fingerprintPriceChanged.count, 1, "only the current run's quote fixture price changes");
  const beforeStaleCreate = await fingerprintAssets();
  const fingerprintOptions = expectedQuote => ({ method: "POST", token: aToken,
    headers: { "idempotency-key": fingerprintKey }, body: { ...fingerprintBody, expectedQuote } });
  const staleCreate = await http(base, "/api/saidian-mall/v1/storefront/orders", fingerprintOptions(oldFingerprint));
  check(staleCreate.status, 409, "changed price rejects the original quote before creating an order");
  check(staleCreate.json.errorKey, "quote_changed", "stale quote has an explicit actionable error key");
  check(await fingerprintAssets(), beforeStaleCreate, "stale quote cannot change inventory, points, coupon, order or payment state");

  const quoteAfterPriceChange = await ok(base, "/api/saidian-mall/v1/storefront/orders/preview", { method: "POST", token: aToken, body: fingerprintBody });
  const acceptedFingerprint = quoteAfterPriceChange.quote.fingerprint;
  truth(/^q1:[0-9a-f]{64}$/.test(acceptedFingerprint ?? "") && acceptedFingerprint !== oldFingerprint, "repricing yields a different valid fingerprint");
  const fingerprintOrder = await ok(base, "/api/saidian-mall/v1/storefront/orders", fingerprintOptions(acceptedFingerprint));
  check(fingerprintOrder.payableCents, quoteAfterPriceChange.quote.payableCents, "fresh fingerprint creates at the confirmed server quote");
  const afterFreshCreate = await fingerprintAssets();
  check(afterFreshCreate.orders, beforeStaleCreate.orders + 1, "fresh quote creates exactly one order");
  check(afterFreshCreate.stock, beforeStaleCreate.stock - 1, "fresh quote reserves inventory once");
  check(afterFreshCreate.points.balanceCents, beforeStaleCreate.points.balanceCents - 100, "fresh quote reserves points once");
  check(afterFreshCreate.claim.orderId, fingerprintOrder.id, "fresh quote reserves the selected coupon");
  // The accepted fingerprint is now stale against live pricing. Exact retries
  // must resolve the original request before re-quoting its already-used coupon.
  check((await prisma.commerceSku.updateMany({
    where: { id: fingerprintSku.id, erpSkuId: `${marker}:quote-fingerprint`, product: { source: "LOCAL" } },
    data: { salePriceCents: 1200 },
  })).count, 1, "second repricing still touches only the owned fixture");
  const fingerprintReplay = await ok(base, "/api/saidian-mall/v1/storefront/orders", fingerprintOptions(acceptedFingerprint));
  check(fingerprintReplay.id, fingerprintOrder.id, "same key and originally accepted fingerprint return the existing order after repricing");
  check(fingerprintReplay.payableCents, fingerprintOrder.payableCents, "retry preserves the original order amount");
  check(await fingerprintAssets(), afterFreshCreate, "accepted quote replay never reserves assets or creates an order twice");
  const differentFingerprintRetry = await http(base, "/api/saidian-mall/v1/storefront/orders", fingerprintOptions(oldFingerprint));
  check(differentFingerprintRetry.status, 409, "same key with a different quote fingerprint is a different request and is rejected");
  check(await fingerprintAssets(), afterFreshCreate, "changed-fingerprint retry has no side effects");
  await ok(base, `/api/saidian-mall/v1/storefront/orders/${fingerprintOrder.id}/cancel`, { method: "POST", token: aToken });
  const afterFingerprintCancel = await fingerprintAssets();
  check(afterFingerprintCancel.stock, beforeStaleCreate.stock, "quote fixture cancellation returns reserved inventory");
  check(afterFingerprintCancel.points.balanceCents, beforeStaleCreate.points.balanceCents, "quote fixture cancellation returns reserved points");
  check(afterFingerprintCancel.claim.orderId, null, "quote fixture cancellation releases the coupon");
  check(await prisma.commerceIntegrationJob.count({ where: { aggregateId: financed.id } }), 0, "LOCAL order creates no ERP outbound job");
  check(blockedOutbound, 0, "test flow attempted no non-allowlisted network calls");
  check(listeners(), beforeListeners, "original API/admin/demo PID and process start time unchanged");
  if (beforeListeners.some(row => row.port === 8080)) check((await http("http://127.0.0.1:8080", "/health/ready")).status, 200, "original API still ready");
  console.log(`Injected Nest + real PostgreSQL phase passed; fake create=${calls.create}; fake refunds=${calls.refund}; assertions=${assertions}.`);
} catch (error) { failure = error; }
finally {
  try { if (app) await app.close(); } catch (error) { failure ??= error; }
  try { await cleanup(); } catch (error) { failure ??= error; console.error(`Scoped cleanup failed for run ${runId}; preserve diagnostics and inspect owned IDs.`); }
  try { if (beforeListeners) check(listeners(), beforeListeners, "original listeners preserved after cleanup"); } catch (error) { failure ??= error; }
  await prisma.$disconnect(); globalThis.fetch = realFetch;
  process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
}
if (failure) {
  const message = failure instanceof assert.AssertionError ? failure.message : `${failure?.name ?? "Error"} (details withheld)`;
  const code = typeof failure?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(failure.code) ? failure.code : "none";
  console.error(`H5 isolated acceptance FAILED: ${message}; stage=${lastAction}; errorCode=${code}; assertions=${assertions}; requests=${requests}; cleanup=${cleanupVerified}; run=${runId}`);
  const frames = String(failure?.stack ?? "").split("\n").filter(line => /^\s+at /.test(line)).slice(0,3);
  if (!(failure instanceof assert.AssertionError)) console.error(frames.join("\n"));
  process.exitCode = 1;
} else console.log(`H5 isolated acceptance PASSED: assertions=${assertions}; requests=${requests}; cleanup=${cleanupVerified}; run=${runId}`);
