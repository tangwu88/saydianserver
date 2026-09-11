// Opt-in, synthetic global-commerce acceptance. Never imported by the API.
// Uses the existing private demo profile only for its verified loopback DB URL;
// global settings and fresh signing keys exist in this process only.
import assert from "node:assert/strict";
import { createCipheriv, createSign, generateKeyPairSync, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { validateDemoProfile } from "./h5-demo-profile.mjs";

assert.equal(process.env.RUN_H5_GLOBAL_COMMERCE_ACCEPTANCE, "1", "Explicit isolated acceptance opt-in required");
const previewMode = process.argv[3] === "--preview";
const journeyMode = process.argv[3] === "--journey-preview";
assert(process.argv.length === 3 || (process.argv.length === 4 && (previewMode || journeyMode)), "Usage: h5-global-commerce-integration.mjs <private-demo-profile> [--preview | --journey-preview]");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = resolve(process.argv[2]), profile = parseEnv(await readFile(profilePath, "utf8"));
validateDemoProfile(profile, repo, profilePath);
// No provider credentials, legacy bridges, or inherited global feature settings.
for (const key of Object.keys(process.env)) if (/^(WECHAT|WECOM|ALIPAY|SMS_|JUSHUITAN|OBJECT_STORAGE|APPLE_|PUSH_|AI_|GLOBAL_|AUTH_)/.test(key)) delete process.env[key];
Object.assign(process.env, {
  DATABASE_URL: profile.DATABASE_URL, APP_REALM: "global", NODE_ENV: "development", H5_DEMO_ENABLED: "true",
  ACCESS_TOKEN_SECRET: randomBytes(48).toString("base64url"), REFRESH_TOKEN_PEPPER: randomBytes(48).toString("base64url"),
  ALLOW_TEST_OTP: "false", SMS_PROVIDER: "disabled", GLOBAL_UNVERIFIED_REGISTRATION_ENABLED: "true",
  GLOBAL_WECHAT_H5_ENABLED: "false", GLOBAL_WECHAT_PHONE_TEST_ENABLED: "false",
  MAINTENANCE_READ_ONLY: "false", BUSINESS_WRITES_PAUSED: "false", WORKER_OUTBOUND_PAUSED: "false", CALLBACK_PROCESSING_PAUSED: "false",
  LEGACY_SESSION_BRIDGE_ENABLED: "false", LEGACY_TOKEN_EXCHANGE_ENABLED: "false",
  PUBLIC_BASE_URL: "http://127.0.0.1", COMMERCE_MODE: "integrated", COMMERCE_STOREFRONT_URL: "http://127.0.0.1/global/saidian-mall",
  TS_NODE_PROJECT: join(repo, "apps/api/tsconfig.json"), DOTENV_CONFIG_PATH: join(repo, "does-not-exist.global-commerce-test-env"),
});
const require = createRequire(join(repo, "apps/api/package.json"));
require(join(repo, "tools/h5-demo-network-guard.cjs"));
const { PrismaClient } = require("@prisma/client"), { hash } = require("bcryptjs"), { sign } = require("jsonwebtoken");
const prisma = new PrismaClient();
const runId = randomUUID(), marker = `h5-global-commerce:${runId}`, started = new Date();
const owned = { users: [], products: [], coupons: [], admins: [], paidOrderIds: [], eventKeys: [] }, calls = [], refundCalls = [];
const realFetch = globalThis.fetch, allowedPorts = new Set();
let app, beforeListeners, beforeIntegrations, failure, cleanupVerified = false, assertions = 0, requests = 0, blockedOutbound = 0, stage = "preflight", previewActive = false;
const interrupt = new AbortController(), onSignal = () => interrupt.abort();
process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !allowedPorts.has(url.port) || url.username || url.password) {
    blockedOutbound++; return Promise.reject(new Error("Non-test network request blocked"));
  }
  return realFetch(input, { ...options, redirect: "error", signal: AbortSignal.any([interrupt.signal, AbortSignal.timeout(15000)]) });
};
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const truth = (value, message) => { assert.ok(value, message); assertions++; };
function listeners() {
  assert.equal(process.platform, "win32", "Listener preservation check requires Windows");
  const script = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -in 8080,8081,5173,5174,5175,5189,8091 } | Select-Object LocalPort,OwningProcess -Unique | ForEach-Object { $p=Get-Process -Id $_.OwningProcess; [pscustomobject]@{port=$_.LocalPort;pid=$_.OwningProcess;start=$p.StartTime.ToUniversalTime().ToString('o')} } | Sort-Object port,pid)";
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }).trim());
}
async function request(base, path, { method = "GET", token, body, expected = 200, headers = {} } = {}) {
  stage = `${method} ${path}`;
  const result = await fetch(base + "/api/saidian-mall/v1" + path, { method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  requests++;
  const text = await result.text();
  truth(!/PrismaClient|node_modules|postgres(?:ql)?:\/\/|-----BEGIN .* KEY-----/.test(text), "HTTP hides internal diagnostics and secrets");
  const json = JSON.parse(text);
  truth((Array.isArray(expected) ? expected : [expected]).includes(result.status), `${stage}: expected ${expected}, got ${result.status}; errorKey=${json.errorKey ?? "none"}`);
  return json;
}
async function createUser(label, passwordHash, extra) {
  const own = { id: randomUUID(), nickname: `${marker}:${label}` };
  owned.users.push(own);
  return prisma.user.create({ data: { ...own, passwordHash, locale: "en", ...extra } });
}
async function createProduct(label = "product", price = 1999) {
  const own = { id: randomUUID(), skuId: randomUUID(), erpItemId: `${marker}:${label}` };
  owned.products.push(own);
  await prisma.commerceProduct.create({ data: { id: own.id, erpItemId: own.erpItemId, name: own.erpItemId, displayName: `GLOBAL QA ${runId.slice(0, 8)} · 测试商品，不发货`, source: "LOCAL", status: "PUBLISHED", gallery: [], tags: [],
    skus: { create: { id: own.skuId, erpItemId: own.erpItemId, erpSkuId: own.erpItemId, salePriceCents: price, stock: 20, enabled: true } },
  } });
  return own;
}
async function createCoupon(label, value, extra = {}) {
  const own = { id: randomUUID(), name: `${marker}:${label}` }; owned.coupons.push(own);
  return prisma.commerceCoupon.create({ data: { ...own, type: "CASH", status: "ACTIVE", value, totalQuantity: 1,
    validFrom: new Date(started.valueOf() - 1000), validUntil: new Date(started.valueOf() + 3600000), ...extra } });
}
async function cleanup() {
  const users = owned.users.map(row => row.id), products = owned.products.map(row => row.id), coupons = owned.coupons.map(row => row.id), admins = owned.admins.map(row => row.id);
  await prisma.$transaction(async tx => {
    for (const own of owned.users) {
      const row = await tx.user.findUnique({ where: { id: own.id } });
      truth(!row || (row.nickname === own.nickname && row.createdAt >= started), "Owned user marker/time unchanged before cleanup");
    }
    for (const own of owned.products) {
      const row = await tx.commerceProduct.findUnique({ where: { id: own.id }, include: { skus: true } });
      truth(!row || (row.erpItemId === own.erpItemId && row.source === "LOCAL" && row.createdAt >= started && row.skus.length === 1 && row.skus[0].id === own.skuId), "Owned product/SKU marker unchanged before cleanup");
    }
    check(await tx.commerceOrderItem.count({ where: { productId: { in: products }, order: { userId: { notIn: users } } } }), 0, "No foreign orders reference fixture products");
    check(await tx.commerceCartItem.count({ where: { sku: { productId: { in: products } }, cart: { userId: { notIn: users } } } }), 0, "No foreign carts reference fixture products");
    check(await tx.commerceFavorite.count({ where: { productId: { in: products }, userId: { notIn: users } } }), 0, "No foreign favorites reference fixture products");
    check(await tx.commerceReview.count({ where: { productId: { in: products }, userId: { notIn: users } } }), 0, "No foreign reviews reference fixture products");
    const orders = await tx.commerceOrder.findMany({ where: { userId: { in: users } }, include: { items: true, paymentIntents: true } });
    const orderIds = orders.map(row => row.id);
    for (const order of orders) {
      const browserOwner = owned.users.some(user => user.id === order.userId && user.nickname === `${marker}:browser`);
      const journeyOwner = owned.users.some(user => user.id === order.userId && user.nickname === `${marker}:journey-browser`);
      const paidFixture = owned.paidOrderIds.includes(order.id) && !browserOwner;
      truth((order.idempotencyKey.startsWith(marker) || browserOwner || journeyOwner) && order.createdAt >= started && (paidFixture || ["PENDING_PAYMENT", "CANCELLED"].includes(order.status)) && order.items.every(item => products.includes(item.productId)), "Only own marked synthetic orders may be deleted; browser stays unpaid");
      if (browserOwner) check(order.paymentIntents.length, 0, "Browser preview must have no payment intents");
      if (journeyOwner && !paidFixture) check(order.paymentIntents.length, 0, "Journey browser cannot create an untracked paid relationship");
      truth(order.paymentIntents.every(intent => intent.createdAt >= started && intent.idempotencyKey.startsWith(marker) && intent.providerMerchantId === "SYNTHETIC_MERCHANT" &&
        (["CREATED", "PENDING"].includes(intent.status) || (paidFixture && intent.providerTransactionId === `${marker}:${order.id}` && intent.providerPayload?.testRun === runId))), "Only own synthetic payment intents may be deleted");
    }
    const journeyOrderIds = orders.filter(order => owned.paidOrderIds.includes(order.id) && owned.users.some(user => user.id === order.userId && user.nickname === `${marker}:journey-browser`)).map(order => order.id);
    const sales = await tx.commerceAfterSale.findMany({ where: { orderId: { in: orderIds } }, include: { items: true } });
    truth(sales.every(row => owned.paidOrderIds.includes(row.orderId) && (row.reason.startsWith(marker) || journeyOrderIds.includes(row.orderId)) && row.createdAt >= started && row.items.every(item => orders.find(order => order.id === row.orderId).items.some(line => line.id === item.orderItemId))), "After-sales are only own marked synthetic financial cases");
    const saleIds = sales.map(row => row.id);
    const refunds = await tx.paymentRefund.findMany({ where: { paymentIntent: { commerceOrderId: { in: orderIds } } } });
    truth(refunds.every(row => saleIds.includes(row.afterSaleId) && row.reason.startsWith(marker) && row.createdAt >= started && (!row.providerRefundId || row.providerRefundId === `SYNTHETIC_REFUND_${row.refundNo}`)), "Refunds belong only to own after-sales and synthetic transport");
    const shipments = await tx.commerceShipment.findMany({ where: { orderId: { in: orderIds } } });
    truth(shipments.every(row => owned.paidOrderIds.includes(row.orderId) && row.createdAt >= started && row.trackingNo.startsWith(`QA-${runId}-`)), "Only own synthetic parcels may be removed");
    const reviews = await tx.commerceReview.findMany({ where: { userId: { in: users } } });
    truth(reviews.every(row => products.includes(row.productId) && row.createdAt >= started && (row.content.startsWith(marker) || orders.some(order => journeyOrderIds.includes(order.id) && order.userId === row.userId && order.items.some(item => item.id === row.orderItemId)))), "Only own marked reviews may be removed");
    for (const own of owned.coupons) {
      const row = await tx.commerceCoupon.findUnique({ where: { id: own.id } });
      truth(!row || (row.name === own.name && row.createdAt >= started), "Owned coupon marker/time unchanged");
    }
    check(await tx.commerceCouponClaim.count({ where: { couponId: { in: coupons }, userId: { notIn: users } } }), 0, "No foreign coupon claims");
    check(await tx.commerceCouponClaim.count({ where: { userId: { in: users }, couponId: { notIn: coupons } } }), 0, "Own users did not claim foreign campaigns");
    check(await tx.commerceCouponClaim.count({ where: { couponId: { in: coupons }, orderId: { notIn: orderIds } } }), 0, "Own coupons do not reference foreign orders");
    check(await tx.commerceEmployeeCouponGrant.count({ where: { couponId: { in: coupons } } }), 0, "No employee grant would cascade from coupon cleanup");
    check(await tx.commerceCouponGift.count({ where: { OR: [{ couponId: { in: coupons } }, { redeemedByUserId: { in: users } }] } }), 0, "No employee gift would be removed or unlinked");
    check(await tx.fileObject.count({ where: { ownerUserId: { in: users } } }), 0, "No external file object may be orphaned by user cleanup");
    const pointEntries = await tx.commercePointLedger.findMany({ where: { userId: { in: users } } });
    truth(pointEntries.every(row => row.createdAt >= started && (row.orderId ? orderIds.includes(row.orderId) : row.type === "SYNTHETIC_QA_GRANT" && row.idempotencyKey.startsWith(`${marker}:points-seed`))), "Point entries cannot refer to an unrelated order or grant");
    for (const own of owned.admins) {
      const row = await tx.adminUser.findUnique({ where: { id: own.id } });
      truth(!row || (row.username === own.username && row.createdAt >= started), "Owned admin marker/time unchanged");
    }
    const audits = await tx.auditLog.findMany({ where: { actorId: { in: admins } } });
    truth(audits.every(row => row.createdAt >= started && row.action === "COMMERCE_LOCAL_SHIPMENT_CREATE" && shipments.some(parcel => parcel.id === row.entityId)), "Admin audit cleanup restricted to own parcel actions");
    const events = await tx.providerEvent.findMany({ where: { provider: "wechat_pay", eventKey: { in: owned.eventKeys } } });
    truth(events.every(row => row.createdAt >= started && row.eventKey.startsWith(marker) && row.payload?.testRun === runId), "Callback cleanup requires exact event keys and synthetic payload marker");
    check(await tx.commerceIntegrationJob.count({ where: { aggregateId: { in: [...orderIds, ...saleIds] } } }), 0, "LOCAL fixture emitted no ERP job");
    check(await tx.outboxEvent.count({ where: { aggregateId: { in: [...users, ...orderIds, ...saleIds] } } }), 0, "Test lifecycle leaves no outbound event requiring delivery");
    await tx.providerEvent.deleteMany({ where: { id: { in: events.map(row => row.id) } } });
    await tx.auditLog.deleteMany({ where: { id: { in: audits.map(row => row.id) } } });
    await tx.commercePointLedger.deleteMany({ where: { userId: { in: users } } });
    await tx.paymentRefund.deleteMany({ where: { id: { in: refunds.map(row => row.id) } } });
    await tx.commerceAfterSale.deleteMany({ where: { id: { in: saleIds } } });
    await tx.commerceReview.deleteMany({ where: { id: { in: reviews.map(row => row.id) } } });
    await tx.commerceCouponClaim.deleteMany({ where: { couponId: { in: coupons }, userId: { in: users } } });
    await tx.paymentIntent.deleteMany({ where: { userId: { in: users }, commerceOrderId: { in: orderIds }, idempotencyKey: { startsWith: marker } } });
    await tx.commerceOrder.deleteMany({ where: { id: { in: orderIds } } });
    await tx.commerceCartItem.deleteMany({ where: { cart: { userId: { in: users } } } });
    await tx.commerceCart.deleteMany({ where: { userId: { in: users } } });
    await tx.commerceAddress.deleteMany({ where: { userId: { in: users } } });
    await tx.commerceFavorite.deleteMany({ where: { userId: { in: users }, productId: { in: products } } });
    await tx.commercePointAccount.deleteMany({ where: { userId: { in: users } } });
    await tx.userSession.deleteMany({ where: { userId: { in: users } } });
    await tx.user.deleteMany({ where: { id: { in: users }, nickname: { in: owned.users.map(row => row.nickname) } } });
    await tx.commerceProduct.deleteMany({ where: { id: { in: products }, erpItemId: { in: owned.products.map(row => row.erpItemId) } } });
    await tx.commerceCoupon.deleteMany({ where: { id: { in: coupons } } });
    await tx.adminUser.deleteMany({ where: { id: { in: admins } } });
  }, { isolationLevel: "Serializable", timeout: 30000 });
  check(await prisma.user.count({ where: { id: { in: users } } }), 0, "No own users remain");
  check(await prisma.commerceProduct.count({ where: { id: { in: products } } }), 0, "No own products remain");
  check(await prisma.commerceOrder.count({ where: { userId: { in: users } } }), 0, "No own orders remain");
  check(await prisma.paymentIntent.count({ where: { userId: { in: users } } }), 0, "No own payment intents remain");
  check(await prisma.commerceCoupon.count({ where: { id: { in: coupons } } }), 0, "No own coupons remain");
  check(await prisma.adminUser.count({ where: { id: { in: admins } } }), 0, "No own admin fixture remains");
  check(await prisma.providerEvent.count({ where: { provider: "wechat_pay", eventKey: { in: owned.eventKeys } } }), 0, "No own callback fixtures remain");
  cleanupVerified = true;
}

try {
  beforeListeners = listeners();
  if (previewMode) truth(!beforeListeners.some(row => row.port === 8091), "Preview port 8091 must already be empty");
  check((await prisma.$queryRaw`SELECT current_database() AS name`)[0].name, "saydian_h5_demo", "Only isolated test database");
  check(await prisma.integrationSecret.count(), 0, "No stored provider secrets in test database");
  check(await prisma.integrationConfig.count({ where: { state: "CONFIGURED" } }), 0, "No real provider is configured");
  beforeIntegrations = await prisma.integrationConfig.findMany({ orderBy: { key: "asc" } });
  require("reflect-metadata"); require("ts-node/register/transpile-only");
  const load = file => require(join(repo, "apps/api/src", file));
  const { Module } = require("@nestjs/common"), { NestFactory, Reflector } = require("@nestjs/core"), { json, urlencoded } = require("express");
  const { PrismaService } = load("common/prisma.service.ts"), { AuthService } = load("auth/auth.service.ts");
  const { UserAuthGuard } = load("common/user-auth.guard.ts"), { WechatH5AuthService } = load("auth/wechat-h5-auth.service.ts");
  const { CommerceStoreService } = load("commerce/commerce-store.service.ts"), { CommerceService } = load("commerce/commerce.service.ts");
  const { CommerceCompatibilityController } = load("commerce/commerce-compat.controller.ts"), { CommerceCapabilitiesService } = load("commerce/commerce-capabilities.service.ts");
  const { PaymentProviderService } = load("billing/payment-provider.service.ts"), { BillingService } = load("billing/billing.service.ts");
  const { SafeHttpExceptionFilter } = load("common/http-exception.filter.ts"), { ApiEnvelopeInterceptor } = load("common/api-envelope.interceptor.ts");
  const { MaintenanceMiddleware } = load("common/maintenance.middleware.ts");
  const { ContentService } = load("content/content.service.ts"), { ContentController } = load("content/content.controller.ts");
  const { AdminService } = load("admin/admin.service.ts");
  const { SupportService } = load("support/support.service.ts"), { CommerceEvidenceController } = load("commerce/commerce-evidence.controller.ts");
  const disabledSecrets = { resolve: async () => { throw new Error("Supplier secret access forbidden in synthetic test"); } };
  // Test-only legal documents are visible only in this Nest composition. Do not
  // change the current legal version seen by any other process on the shared DB.
  const legalVersion = `local-global-qa-${runId}`;
  const legalDocuments = ["user_agreement", "privacy_policy"].map(documentType => ({ id: randomUUID(), documentType, version: legalVersion,
    locale: "en", title: `SYNTHETIC LOCAL QA ${documentType}`, active: true, reviewed: true, publishedAt: started,
    contentHtml: "<p>LOCAL SYNTHETIC TEST TERMS ONLY. No real sales, deliveries, messages or payments. Test data is removed after this session.</p>",
  }));
  const legalPrisma = new Proxy(prisma, { get(target, key) {
    if (key !== "globalLegalDocument") return Reflect.get(target, key);
    const matching = query => legalDocuments.filter(row => {
      const where = query?.where ?? {};
      return (!where.documentType || (typeof where.documentType === "string" ? row.documentType === where.documentType : where.documentType.in.includes(row.documentType))) &&
        (!where.locale || (typeof where.locale === "string" ? row.locale === where.locale : where.locale.in.includes(row.locale))) && (!where.version || row.version === where.version);
    });
    return { findMany: async query => matching(query), findFirst: async query => matching(query)[0] ?? null };
  } });
  const syntheticKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const syntheticCredentials = { merchantId: "SYNTHETIC_MERCHANT", serialNo: "SYNTHETIC_SERIAL", platformSerialNo: "SYNTHETIC_PLATFORM_SERIAL",
    apiV3Key: randomBytes(16).toString("hex"), appIdOfficial: "wxSYNTHETIC12345",
    privateKeyPem: syntheticKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    platformPublicKeyPem: syntheticKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  let missingCredential = false;
  const providerSecrets = { resolve: async key => {
    assert.equal(key, "wechat_pay", "Only synthetic WeChat H5 credentials are available");
    return { ...syntheticCredentials, ...(missingCredential ? { apiV3Key: "" } : {}) };
  } };
  const providerPrisma = new Proxy(prisma, { get(target, key) {
    if (key !== "integrationConfig") return Reflect.get(target, key);
    return { findUnique: async query => query.where.key === "wechat_pay"
      ? { key: "wechat_pay", state: "CONFIGURED", publicConfig: { notifyUrl: "https://synthetic.invalid/wechat/notify" } }
      : null, updateMany: async () => ({ count: 1 }) }; // Verification metadata stays in this provider's private configuration.
  } });
  // Keep real identity(), create() and their credential/business/currency checks.
  // Only provider-local configuration data and final transports are synthetic.
  class SyntheticPayments extends PaymentProviderService {
    async identity(channel) { if (previewActive) throw new Error("Payments disabled throughout browser preview"); return super.identity(channel); }
    async createWechat(intent) { calls.push({ id: intent.id, currency: intent.currency, amountCents: intent.amountCents, channel: intent.channel }); return { type: "TEST_ONLY", testRun: runId, paymentNo: intent.paymentNo }; }
    async createAlipay(intent) { return this.createWechat(intent); }
    async refundWechat(refund) {
      refundCalls.push({ refundNo: refund.refundNo, amountCents: refund.amountCents, currency: refund.currency });
      return { completed: false, providerRefundId: `SYNTHETIC_REFUND_${refund.refundNo}`, amountCents: refund.amountCents,
        refundNo: refund.refundNo, paymentNo: refund.paymentNo, providerTransactionId: refund.providerTransactionId, currency: refund.currency,
        payload: { status: "PROCESSING", testRun: runId } };
    }
  }
  const providers = new SyntheticPayments(providerPrisma, providerSecrets);
  const auth = new AuthService(prisma, { send: async () => { throw new Error("SMS forbidden"); } }, disabledSecrets, {});
  const official = new WechatH5AuthService(legalPrisma, auth, disabledSecrets), content = new ContentService(legalPrisma, disabledSecrets);
  // Only this test's quote configuration changes; preview and transaction-time
  // readQuote use the same extended client. Every business read/write stays real.
  let freightMode = false;
  const quotePrisma = prisma.$extends({ query: { commerceBusinessConfig: { async findUnique({ args, query }) {
    return freightMode && args.where.key === "shipping.default" ? { key: "shipping.default", enabled: true, value: { amountCents: 599 } } : query(args);
  } } } });
  const store = new CommerceStoreService(quotePrisma), billing = new BillingService(prisma, providers, {}), admin = new AdminService(prisma, disabledSecrets);
  const support = new SupportService(prisma, disabledSecrets); // No S3 config or adapter is injected.
  const commerce = new CommerceService(prisma, store, billing), capabilities = new CommerceCapabilitiesService(prisma, disabledSecrets, official);
  class GlobalCommerceAcceptanceModule {}
  Module({ controllers: [CommerceCompatibilityController, ContentController, CommerceEvidenceController], providers: [
    [PrismaService, prisma], [AuthService, auth], [WechatH5AuthService, official], [BillingService, billing],
    [PaymentProviderService, providers], [CommerceService, commerce], [CommerceCapabilitiesService, capabilities], [ContentService, content], [SupportService, support], [UserAuthGuard, new UserAuthGuard(prisma, auth)],
  ].map(([provide, useValue]) => ({ provide, useValue })) })(GlobalCommerceAcceptanceModule);
  app = await NestFactory.create(GlobalCommerceAcceptanceModule, { logger: false, bodyParser: false });
  app.use(json({ verify: (req, _res, buffer) => { req.rawBody = buffer; } }), urlencoded({ extended: true }));
  const maintenance = new MaintenanceMiddleware(); app.use(maintenance.use.bind(maintenance));
  app.useGlobalFilters(new SafeHttpExceptionFilter()); app.useGlobalInterceptors(new ApiEnvelopeInterceptor(app.get(Reflector)));
  await app.listen(previewMode ? 8091 : 0, "127.0.0.1");
  const port = String(app.getHttpServer().address().port);
  truth(previewMode ? port === "8091" : !["8080", "8081", "5173", "5174", "5175", "5189", "8091"].includes(port), "Distinct isolated loopback server");
  allowedPorts.add(port); const base = `http://127.0.0.1:${port}`;
  async function notifyWechat(label, payload, refund = false, expected = 200, corruptSignature = false) {
    const eventKey = `${marker}:${label}`;
    if (!owned.eventKeys.includes(eventKey)) owned.eventKeys.push(eventKey);
    const nonce = randomBytes(6).toString("hex"), associatedData = "SYNTHETIC_LOCAL_TEST";
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(syntheticCredentials.apiV3Key), Buffer.from(nonce));
    cipher.setAAD(Buffer.from(associatedData));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ ...payload, testRun: runId })), cipher.final(), cipher.getAuthTag()]).toString("base64");
    const body = { id: eventKey, resource: { algorithm: "AEAD_AES_256_GCM", nonce, associated_data: associatedData, ciphertext } };
    const timestamp = String(Math.floor(Date.now() / 1000)), headerNonce = randomUUID();
    const signer = createSign("RSA-SHA256"); signer.update(`${timestamp}\n${headerNonce}\n${JSON.stringify(body)}\n`); signer.end();
    const signature = signer.sign(syntheticKeys.privateKey, "base64");
    return request(base, refund ? "/payments/wechat/refund-notify" : "/payments/wechat/notify", { method: "POST", body, expected, headers: {
      "wechatpay-timestamp": timestamp, "wechatpay-nonce": headerNonce, "wechatpay-serial": syntheticCredentials.platformSerialNo,
      "wechatpay-signature": corruptSignature ? Buffer.from("deliberately invalid signature").toString("base64") : signature,
    } });
  }
  const publicCaps = await request(base, "/storefront/capabilities");
  check(publicCaps.realm, "global", "Actual global capability branch");
  check(publicCaps.checkout.enabled, true, "Global CN checkout is enabled by actual code");
  truth(publicCaps.payments.every(row => !row.enabled), "Unconfigured real payments remain publicly unavailable");
  check(publicCaps.consentVersion, legalVersion, "Only this instance exposes synthetic test terms");
  for (const reference of Object.values(publicCaps.legal)) {
    const response = await fetch(base + reference.path); requests++;
    check(response.status, 200, "Test legal document readable over its actual controller");
    const result = await response.json();
    check(result.data.version, legalVersion, "Legal response uses real envelope and requested synthetic version");
  }
  const password = randomBytes(24).toString("hex"), passwordHash = await hash(password, 12);
  let phone;
  for (let n = 0; n < 100; n++) {
    const candidate = `+165055501${String(randomInt(0, 100)).padStart(2, "0")}`;
    if (!await prisma.user.findUnique({ where: { mobile: candidate } })) { phone = candidate; break; }
  }
  truth(phone, "Unused reserved fictional NANP identity allocated without sending SMS");
  const email = await createUser("email", passwordHash, { email: `${runId}@example.invalid`, emailVerifiedAt: new Date() });
  const mobile = await createUser("phone", passwordHash, { mobile: phone, mobileVerifiedAt: new Date() });
  const unverified = await createUser("unverified", passwordHash, { email: `unverified-${runId}@example.invalid` });
  const sku = await createProduct();
  const emailLogin = await request(base, "/auth/password/login", { method: "POST", body: { identifier: email.email, password }, expected: [200, 201] });
  const mobileLogin = await request(base, "/auth/password/login", { method: "POST", body: { identifier: mobile.mobile, password }, expected: [200, 201] });
  check(emailLogin.user.id, email.id, "Verified email signs into same member");
  check(mobileLogin.user.id, mobile.id, "Verified phone signs into same member");
  await request(base, "/storefront/after-sale-images/capabilities", { expected: 401 });
  const evidenceCapability = await request(base, "/storefront/after-sale-images/capabilities", { token: emailLogin.token });
  check(evidenceCapability.enabled, false, "Real evidence service remains unconfigured without S3");
  truth(evidenceCapability.reason, "Unconfigured upload explains that text-only after-sales remain available");
  check(await prisma.fileObject.count({ where: { ownerUserId: { in: owned.users.map(row => row.id) } } }), 0, "Reading upload capability writes no attachment or object");
  await request(base, "/auth/password/login", { method: "POST", body: { identifier: unverified.email, password }, expected: 403 });
  const unverifiedSession = await auth.issueSession(unverified.id);
  // A structurally valid temporary access token must be blocked even for an
  // otherwise verified member, before any WeChat config or transport access.
  const temporaryId = randomUUID(), temporaryJti = `h5-phone-test:${randomUUID()}`;
  await prisma.userSession.create({ data: { id: temporaryId, userId: mobile.id, accessJti: temporaryJti, refreshTokenHash: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 60000) } });
  const temporaryToken = sign({ sub: mobile.id, sid: temporaryId, typ: "access" }, process.env.ACCESS_TOKEN_SECRET,
    { algorithm: "HS256", expiresIn: 60, jwtid: temporaryJti, issuer: "saydian-global-server", audience: "saydian-global-app" });
  for (const token of [unverifiedSession.accessToken, temporaryToken]) {
    await request(base, "/storefront/cart", { token, expected: 401 });
    await request(base, "/storefront/cart/items", { token, method: "POST", body: { skuId: sku.skuId, quantity: 1 }, expected: 401 });
    await request(base, "/storefront/orders/preview", { token, method: "POST", body: { items: [{ skuId: sku.skuId, quantity: 1 }] }, expected: 401 });
    await request(base, "/storefront/orders", { token, method: "POST", body: { items: [{ skuId: sku.skuId, quantity: 1 }] }, expected: 401 });
    await request(base, "/payments/create", { token, method: "POST", body: { orderId: randomUUID(), channel: "wechat_h5" }, expected: 401 });
  }
  check(await prisma.commerceCart.count({ where: { userId: unverified.id } }), 0, "Unverified calls create no cart");
  check(await prisma.commerceOrder.count({ where: { userId: { in: [unverified.id, mobile.id] } } }), 0, "Rejected sessions create no orders");
  for (const [label, member, session] of [["email", email, emailLogin], ["phone", mobile, mobileLogin]]) {
    const token = session.token;
    const address = await request(base, "/storefront/addresses", { method: "POST", token, expected: [200, 201], body: {
      name: "SYNTHETIC DO NOT SHIP", countryCode: "CN", mobile: "+86 138 0000 0000", province: "测试省", city: "测试市", district: "测试区", detail: marker, postalCode: "000000", isDefault: true,
    } });
    check(address.countryCode, "CN", "CN country persists"); check(address.mobile, "+8613800000000", "Recipient E164 persists");
    await request(base, "/storefront/cart/items", { method: "POST", token, expected: [200, 201], body: { skuId: sku.skuId, quantity: 2 } });
    const cart = await request(base, "/storefront/cart", { token });
    check(cart.items[0].quantity, 2, "Cart contains selected quantity");
    const input = { addressId: address.id, items: [{ skuId: sku.skuId, quantity: 2 }] };
    const preview = await request(base, "/storefront/orders/preview", { method: "POST", token, expected: [200, 201], body: input });
    check(preview.quote.subtotalCents, 3998, "Global quote uses existing integer CNY price");
    truth(/^q1:[0-9a-f]{64}$/.test(preview.quote.fingerprint), "Conditional quote contract preserved");
    const beforeStock = (await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.skuId } })).stock;
    const orderInput = { ...input, expectedQuote: preview.quote.fingerprint };
    const headers = { "idempotency-key": `${marker}:${label}:order` };
    const order = await request(base, "/storefront/orders", { method: "POST", token, expected: [200, 201], body: orderInput, headers });
    const persisted = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } });
    check(persisted.currency, "CNY", "Order currency persisted as CNY"); check(persisted.countryCode, "CN", "Order country copied from owned address");
    check((await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.skuId } })).stock, beforeStock - 2, "Order reserves inventory once");
    check((await request(base, "/storefront/orders", { method: "POST", token, expected: [200, 201], body: orderInput, headers })).id, order.id, "Exact order retry is idempotent");
    await request(base, `/storefront/orders/${order.id}`, { token: label === "email" ? mobileLogin.token : emailLogin.token, expected: 404 });
    await request(base, `/storefront/orders/${order.id}/cancel`, { method: "POST", token, expected: [200, 201] });
    check((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "CANCELLED", "Order cancelled");
    check((await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.skuId } })).stock, beforeStock, "Cancellation returns inventory");
    const foreignAddress = await request(base, "/storefront/addresses", { method: "POST", token, expected: [200, 201], body: {
      name: "SYNTHETIC US", countryCode: "US", mobile: "+1 202 555 0123", detail: marker, postalCode: "20001",
    } });
    const rejectedInput = { ...input, addressId: foreignAddress.id };
    const beforeOrders = await prisma.commerceOrder.count({ where: { userId: member.id } });
    const foreignPreview = await request(base, "/storefront/orders/preview", { method: "POST", token, body: rejectedInput, expected: 400 });
    check(foreignPreview.errorKey, "delivery_country_unsupported", "Non-CN preview has an explicit country error");
    const foreignCreate = await request(base, "/storefront/orders", { method: "POST", token, body: rejectedInput, headers: { "idempotency-key": `${marker}:${label}:foreign` }, expected: 400 });
    check(foreignCreate.errorKey, "delivery_country_unsupported", "Non-CN creation has an explicit country error");
    check(await prisma.commerceOrder.count({ where: { userId: member.id } }), beforeOrders, "Non-CN checkout writes no order");
    check((await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.skuId } })).stock, beforeStock, "Non-CN checkout reserves no inventory");
    if (label === "email") {
      const payableOrder = await request(base, "/storefront/orders", { method: "POST", token, expected: [200, 201], body: orderInput, headers: { "idempotency-key": `${marker}:payment-order` } });
      const paymentBody = { orderId: payableOrder.id, channel: "wechat_h5", idempotencyKey: `${marker}:payment` };
      missingCredential = true;
      await request(base, "/payments/create", { method: "POST", token, expected: 503, body: paymentBody });
      check(await prisma.paymentIntent.count({ where: { commerceOrderId: payableOrder.id } }), 0, "Incomplete credentials reject before reserving a PaymentIntent");
      check(calls.length, 0, "Incomplete credentials never reach the synthetic transport");
      missingCredential = false;
      const payment = await request(base, "/payments/create", { method: "POST", token, expected: [200, 201], body: paymentBody });
      check(calls.length, 1, "Real provider create policy reaches only one in-memory CNY transport");
      check(calls[0].currency, "CNY", "CNY reaches adapter unchanged"); check(calls[0].amountCents, payableOrder.payableCents, "Payment amount matches server order");
      check((await request(base, "/payments/create", { method: "POST", token, expected: [200, 201], body: paymentBody })).id, payment.id, "Payment retry reuses intent");
      check(calls.length, 1, "Payment retry never dispatches twice");
      await request(base, `/payments/${payment.id}`, { token: mobileLogin.token, expected: 404 });
      const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
      check(intent.currency, "CNY", "PaymentIntent currency persisted");
      for (const replacement of [{ currency: "USD" }, { businessType: "HEALTH_REPORT" }, { channel: "WECHAT_APP" }, { channel: "WECHAT_MINI" }]) {
        await assert.rejects(() => providers.create({ ...intent, ...replacement }, {})); assertions++;
      }
      check(calls.length, 1, "Global currency/business/channel rejections never reach transport");
    }
  }
  // Public coupon inventory: two identities race for exactly one unreserved
  // unit. A lost winning response must still replay after the pool is empty.
  stage = "coupon concurrency";
  const limitedCoupon = await createCoupon("one-public-coupon", 101, { totalQuantity: 2, reservedGiftQuantity: 1 });
  const employeeCoupon = await createCoupon("employee-only", 99, { employeeDistributable: true });
  const available = await request(base, "/storefront/coupons/available?page=1", { token: emailLogin.token });
  truth(available.items.some(row => row.id === limitedCoupon.id && row.available && !row.claimed), "Public coupon is discoverable");
  truth(!available.items.some(row => row.id === employeeCoupon.id), "Employee gift inventory is excluded from public claims");
  const claimResults = await Promise.all([emailLogin, mobileLogin].map(session => request(base, `/storefront/coupons/${limitedCoupon.id}/claim`, { method: "POST", token: session.token, expected: [201, 400] })));
  const winners = claimResults.filter(row => row.id);
  check(winners.length, 1, "Concurrent claims cannot consume the reserved gift or exceed the final public unit");
  check(await prisma.commerceCouponClaim.count({ where: { couponId: limitedCoupon.id } }), 1, "Only one claim persisted");
  check((await prisma.commerceCoupon.findUniqueOrThrow({ where: { id: limitedCoupon.id } })).claimedQuantity, 1, "Counter matches claims after contention");
  const winnerToken = winners[0].userId === email.id ? emailLogin.token : mobileLogin.token;
  check((await request(base, `/storefront/coupons/${limitedCoupon.id}/claim`, { method: "POST", token: winnerToken, expected: 201 })).id, winners[0].id, "Exhausted coupon winning response is recoverable");
  await request(base, `/storefront/coupons/${employeeCoupon.id}/claim`, { method: "POST", token: emailLogin.token, expected: 400 });

  stage = "full paid lifecycle";
  freightMode = true;
  const cycleMember = await createUser("full-cycle", passwordHash, { email: `cycle-${runId}@example.invalid`, emailVerifiedAt: new Date() });
  const cycleToken = (await request(base, "/auth/password/login", { method: "POST", body: { identifier: cycleMember.email, password }, expected: 201 })).token;
  const cycleSku = await createProduct("cycle-product", 1000);
  const cycleAddress = await request(base, "/storefront/addresses", { method: "POST", token: cycleToken, expected: 201, body: {
    name: "SYNTHETIC DO NOT SHIP", countryCode: "CN", mobile: "+8613800000000", province: "测试省", city: "测试市", district: "测试区", detail: marker, isDefault: true,
  } });
  await prisma.commercePointAccount.create({ data: { userId: cycleMember.id, balanceCents: 5000 } });
  await prisma.commercePointLedger.create({ data: { userId: cycleMember.id, deltaCents: 5000, type: "SYNTHETIC_QA_GRANT", idempotencyKey: `${marker}:points-seed` } });
  const cycleCoupon = await createCoupon("cycle-coupon", 101);
  const cycleClaim = await request(base, `/storefront/coupons/${cycleCoupon.id}/claim`, { method: "POST", token: cycleToken, expected: 201 });
  const operatorOwn = { id: randomUUID(), username: `${marker}:operator` }; owned.admins.push(operatorOwn);
  const operator = await prisma.adminUser.create({ data: { ...operatorOwn, displayName: "SYNTHETIC QA OPERATOR", passwordHash, role: "SUPER_ADMIN" } });
  const currentOrder = id => prisma.commerceOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });
  const pointBalance = async () => (await prisma.commercePointAccount.findUniqueOrThrow({ where: { userId: cycleMember.id } })).balanceCents;
  const transition = async (id, status) => admin.updateCommerceAfterSale(id, { status, version: (await prisma.commerceAfterSale.findUniqueOrThrow({ where: { id } })).version }, operator);
  const expectConflict = async fn => { await assert.rejects(fn, error => error.getStatus?.() === 409); assertions++; };
  const cancelInput = { addressId: cycleAddress.id, items: [{ skuId: cycleSku.skuId, quantity: 1 }], pointCents: 333, couponClaimId: cycleClaim.id };
  const cancelOrder = await request(base, "/storefront/orders", { method: "POST", token: cycleToken, expected: 201,
    headers: { "idempotency-key": `${marker}:point-cancel` }, body: cancelInput });
  check(await pointBalance(), 4667, "Pending order reserves its point amount");
  truth((await prisma.commerceCouponClaim.findUniqueOrThrow({ where: { id: cycleClaim.id } })).usedAt, "Pending order occupies its coupon");
  await request(base, `/storefront/orders/${cancelOrder.id}/cancel`, { method: "POST", token: cycleToken, expected: 201 });
  await request(base, `/storefront/orders/${cancelOrder.id}/cancel`, { method: "POST", token: cycleToken, expected: 409 });
  check(await pointBalance(), 5000, "Repeated cancellation cannot return points twice");
  const releasedClaim = await prisma.commerceCouponClaim.findUniqueOrThrow({ where: { id: cycleClaim.id } });
  check([releasedClaim.usedAt, releasedClaim.orderId], [null, null], "Cancelled coupon is reusable without another public claim");
  check((await prisma.commerceSku.findUniqueOrThrow({ where: { id: cycleSku.skuId } })).stock, 20, "Cancelled point order releases inventory once");
  async function newPaidOrder(label, items, pointCents, couponClaimId, buyer = { token: cycleToken, address: cycleAddress }) {
    const input = { addressId: buyer.address.id, items, pointCents, ...(couponClaimId ? { couponClaimId } : {}) };
    const preview = await request(base, "/storefront/orders/preview", { method: "POST", token: buyer.token, expected: 201, body: input });
    check(preview.quote.shippingCents, 599, "Private freight configuration reaches real preview");
    const order = await request(base, "/storefront/orders", { method: "POST", token: buyer.token, expected: 201, headers: { "idempotency-key": `${marker}:${label}` }, body: { ...input, expectedQuote: preview.quote.fingerprint } });
    owned.paidOrderIds.push(order.id);
    check((await currentOrder(order.id)).shippingCents, 599, "Transaction quote sees the same private freight configuration");
    const payment = await request(base, "/payments/create", { method: "POST", token: buyer.token, expected: 201, body: { orderId: order.id, channel: "wechat_h5", idempotencyKey: `${marker}:${label}:pay` } });
    const payload = { mchid: syntheticCredentials.merchantId, appid: syntheticCredentials.appIdOfficial, out_trade_no: payment.paymentNo,
      transaction_id: `${marker}:${order.id}`, trade_state: "SUCCESS", amount: { total: order.payableCents, currency: "CNY" } };
    await notifyWechat(`${label}:invalid-signature`, payload, false, 400, true);
    check((await currentOrder(order.id)).status, "PENDING_PAYMENT", "Invalid signature cannot mark order paid");
    await notifyWechat(`${label}:wrong-amount`, { ...payload, amount: { total: order.payableCents + 1, currency: "CNY" } }, false, 400);
    check((await currentOrder(order.id)).status, "PENDING_PAYMENT", "Signed wrong amount is rejected without payment transition");
    await notifyWechat(`${label}:paid`, payload);
    const version = (await currentOrder(order.id)).version;
    await notifyWechat(`${label}:paid`, payload);
    await notifyWechat(`${label}:paid-redelivery`, payload);
    check((await currentOrder(order.id)).version, version, "Same and redelivered signed payment callbacks do not repeat state changes");
    check((await currentOrder(order.id)).status, "PAID", "Real verified callback drives the paid state");
    return { order: await currentOrder(order.id), payment: await prisma.paymentIntent.findUniqueOrThrow({ where: { id: payment.id } }) };
  }
  async function completeRefund(sale, payment, label) {
    const beforePoints = await pointBalance(), beforeCalls = refundCalls.length;
    const refund = await billing.refundAfterSale(sale.id, {});
    check(refund.status, "PROCESSING", "Channel acceptance is not a settled refund");
    check(await pointBalance(), beforePoints, "Points remain occupied until verified cash success");
    const replay = await billing.createRefund(payment.id, { afterSaleId: sale.id, amountCents: sale.requestedCents, reason: sale.reason, idempotencyKey: `after-sale-refund:${sale.id}` });
    check(replay.id, refund.id, "Refund dispatch replay reuses reserved refund");
    check(refundCalls.length, beforeCalls + 1, "Refund transport dispatches once");
    const payload = { mchid: syntheticCredentials.merchantId, appid: syntheticCredentials.appIdOfficial, out_trade_no: payment.paymentNo,
      transaction_id: payment.providerTransactionId, out_refund_no: refund.refundNo, refund_id: `SYNTHETIC_REFUND_${refund.refundNo}`, refund_status: "SUCCESS",
      amount: { refund: refund.amountCents, total: payment.amountCents, currency: "CNY" } };
    await notifyWechat(`${label}:refund`, payload, true);
    const afterPoints = await pointBalance();
    await notifyWechat(`${label}:refund`, payload, true);
    await notifyWechat(`${label}:refund-redelivery`, payload, true);
    check(await pointBalance(), afterPoints, "Refund callback duplicates never credit points again");
    check(afterPoints - beforePoints, sale.pointReturnCents, "Cash confirmation returns exactly the item point snapshot");
    check((await prisma.commerceAfterSale.findUniqueOrThrow({ where: { id: sale.id } })).status, "COMPLETED", "After-sale settles with actual callback transaction");
    return refund;
  }
  const cycle = await newPaidOrder("cycle-order", [{ skuId: cycleSku.skuId, quantity: 3 }], 1000, cycleClaim.id);
  check(cycle.order.payableCents, 2498, "Coupon 101 and points 1000 discount goods only; freight 599 remains cash");
  check(cycle.order.items[0].cashPaidCentsSnapshot, 1899, "Cash merchandise allocation persists");
  check(await pointBalance(), 4000, "Order reserves points exactly once");
  const itemId = cycle.order.items[0].id;
  await assert.rejects(() => admin.commerceFulfillmentPreview(cycle.order.id, { ...operator, role: "CONTENT_EDITOR", roles: [] }), error => error.getStatus?.() === 403); assertions++;
  await assert.rejects(() => admin.createShippingRefund(cycle.order.id, {}, { ...operator, role: "CONTENT_EDITOR", roles: [] }), error => error.getStatus?.() === 403); assertions++;
  const reviewInput = { orderItemId: itemId, rating: 5, content: `${marker}:synthetic review; not a real purchase` };
  await request(base, "/storefront/reviews", { method: "POST", token: cycleToken, body: reviewInput, expected: 400 });
  await request(base, `/storefront/orders/${cycle.order.id}/receipt`, { method: "POST", token: cycleToken, expected: 409 });
  for (const [index, quantity] of [[1, 1], [2, 2]]) {
    const version = (await currentOrder(cycle.order.id)).version;
    const shipmentInput = { version, logisticsCompany: "SYNTHETIC DO NOT SHIP", trackingNo: `QA-${runId}-${index}`, items: [{ orderItemId: itemId, quantity }] };
    const parcel = await admin.createCommerceShipment(cycle.order.id, shipmentInput, operator);
    check((await admin.createCommerceShipment(cycle.order.id, shipmentInput, operator)).shipmentId, parcel.shipmentId, "Parcel retry is idempotent even with previous version");
    await expectConflict(() => admin.createCommerceShipment(cycle.order.id, { ...shipmentInput, items: [{ orderItemId: itemId, quantity: quantity + 1 }] }, operator));
    check((await currentOrder(cycle.order.id)).status, index === 1 ? "WAITING_FULFILLMENT" : "SHIPPED", "Partial parcels cannot prematurely mark the whole order shipped");
    if (index === 1) await request(base, `/storefront/orders/${cycle.order.id}/receipt`, { method: "POST", token: cycleToken, expected: 409 });
  }
  const detail = await request(base, `/storefront/orders/${cycle.order.id}`, { token: cycleToken });
  check(detail.shipments.length, 2, "Customer receives both parcels");
  check(detail.shipments.flatMap(row => row.items).reduce((sum, row) => sum + row.quantity, 0), 3, "Parcel item totals match ordered quantity");
  const logistics = await request(base, `/storefront/orders/${cycle.order.id}/logistics`, { token: cycleToken });
  check(logistics.length, 2, "Dedicated logistics endpoint returns both parcels");
  check(logistics.flatMap(row => row.items).reduce((sum, row) => sum + row.quantity, 0), 3, "Dedicated logistics endpoint preserves parcel item allocation");
  await request(base, `/storefront/orders/${cycle.order.id}/logistics`, { token: emailLogin.token, expected: 404 });
  await request(base, `/storefront/orders/${cycle.order.id}/receipt`, { method: "POST", token: cycleToken, expected: 201 });
  await request(base, `/storefront/orders/${cycle.order.id}/receipt`, { method: "POST", token: cycleToken, expected: 409 });
  const review = await request(base, "/storefront/reviews", { method: "POST", token: cycleToken, expected: 201, body: reviewInput });
  check((await request(base, "/storefront/reviews", { method: "POST", token: cycleToken, expected: 201, body: reviewInput })).id, review.id, "Review lost response does not create a second review");
  await request(base, "/storefront/reviews", { method: "POST", token: emailLogin.token, expected: 400, body: reviewInput });
  check((await request(base, `/storefront/orders/${cycle.order.id}`, { token: cycleToken })).items[0].review.id, review.id, "Order detail returns own existing review");
  for (let index = 0; index < 3; index++) {
    const input = { type: index === 1 ? "RETURN_REFUND" : "REFUND_ONLY", items: [{ orderItemId: itemId, quantity: 1 }], reason: `${marker}:partial-${index}` };
    const quote = await request(base, `/storefront/orders/${cycle.order.id}/after-sales/preview`, { method: "POST", token: cycleToken, expected: 201, body: input });
    check(quote.requestedCents, 633, "Partial refund uses original cash allocation");
    check(quote.pointReturnCents, [333, 333, 334][index], "Cumulative point slices remove rounding remainder");
    check(quote.shippingRefundCents, 0, "Repeated item refunds do not silently refund freight");
    const body = { ...input, orderVersion: (await currentOrder(cycle.order.id)).version, idempotencyKey: `qa-${runId}-${index}` };
    const sale = await request(base, `/storefront/orders/${cycle.order.id}/after-sales`, { method: "POST", token: cycleToken, expected: 201, body });
    const reservedVersion = (await currentOrder(cycle.order.id)).version;
    check((await request(base, `/storefront/orders/${cycle.order.id}/after-sales`, { method: "POST", token: cycleToken, expected: 201, body })).id, sale.id, "Lost after-sale response replays despite occupied item and old order version");
    check((await currentOrder(cycle.order.id)).version, reservedVersion, "After-sale replay does not reserve quantity twice");
    await request(base, `/storefront/orders/${cycle.order.id}/after-sales`, { method: "POST", token: cycleToken, expected: 409, body: { ...body, reason: `${marker}:changed` } });
    await request(base, `/storefront/orders/${cycle.order.id}/after-sales/preview`, { method: "POST", token: cycleToken, expected: 409, body: input });
    await transition(sale.id, "APPROVED");
    if (index === 1) {
      await expectConflict(() => billing.refundAfterSale(sale.id, {}));
      await transition(sale.id, "WAITING_RETURN");
      const returnInput = { logisticsCompany: "SYNTHETIC RETURN", trackingNo: `QA-${runId}-return`, version: (await prisma.commerceAfterSale.findUniqueOrThrow({ where: { id: sale.id } })).version };
      await request(base, `/storefront/orders/${cycle.order.id}/after-sales/${sale.id}/return-logistics`, { method: "POST", token: emailLogin.token, body: returnInput, expected: 404 });
      const returned = await request(base, `/storefront/orders/${cycle.order.id}/after-sales/${sale.id}/return-logistics`, { method: "POST", token: cycleToken, body: returnInput });
      check(returned.status, "WAITING_RETURN", "Customer logistics is not proof that the merchant received goods");
      check((await request(base, `/storefront/orders/${cycle.order.id}/after-sales/${sale.id}/return-logistics`, { method: "POST", token: cycleToken, body: returnInput })).version, returned.version, "Repeated return logistics does not increment version");
      await expectConflict(() => billing.refundAfterSale(sale.id, {}));
      await transition(sale.id, "RETURNED");
    }
    await completeRefund(sale, cycle.payment, `partial-${index}`);
    check((await currentOrder(cycle.order.id)).status, "COMPLETED", "Partial settlement retains completed fulfillment so remaining items can be claimed");
  }
  check(await pointBalance(), 5000, "All item points return without deficit or excess");
  check(await prisma.commerceAfterSale.count({ where: { orderId: cycle.order.id } }), 3, "Three quantity-one claims, no duplicate records");
  const freight = await admin.shippingRefundPreview(cycle.order.id);
  check(freight.maximumCents, 599, "Only original freight remains after all merchandise refunds");
  const freightInput = { amountCents: 599, reason: `${marker}:freight concession`, requestKey: `${runId}-freight`, orderVersion: (await currentOrder(cycle.order.id)).version };
  const freightSale = await admin.createShippingRefund(cycle.order.id, freightInput, operator);
  check((await admin.createShippingRefund(cycle.order.id, freightInput, operator)).id, freightSale.id, "Freight application retry is idempotent");
  await expectConflict(() => billing.refundAfterSale(freightSale.id, {}));
  await transition(freightSale.id, "APPROVED");
  const ledgerBeforeFreight = await prisma.commercePointLedger.count({ where: { userId: cycleMember.id } });
  await completeRefund(freightSale, cycle.payment, "freight");
  check(await prisma.commercePointLedger.count({ where: { userId: cycleMember.id } }), ledgerBeforeFreight, "Freight returns no points and adds no point entry");
  check((await currentOrder(cycle.order.id)).status, "REFUNDED", "Only all goods and cash fully returned produces refunded order");
  check((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: cycle.payment.id } })).status, "REFUNDED", "Payment total converges to full refund");
  check((await admin.shippingRefundPreview(cycle.order.id)).maximumCents, 0, "No further freight can be returned");

  // A zero-cash item in a paid multi-item order returns only its own points.
  const zeroSku = await createProduct("point-only-item", 1), cashSku = await createProduct("cash-item", 999);
  const mixed = await newPaidOrder("mixed-order", [{ skuId: zeroSku.skuId, quantity: 1 }, { skuId: cashSku.skuId, quantity: 1 }], 999);
  const zeroItem = mixed.order.items.find(item => item.skuId === zeroSku.skuId);
  check(zeroItem.cashPaidCentsSnapshot, 0, "Largest remainder can produce a zero-cash item");
  const zeroInput = { type: "REFUND_ONLY", items: [{ orderItemId: zeroItem.id, quantity: 1 }], reason: `${marker}:zero cash`, idempotencyKey: `qa-${runId}-zero` };
  const zeroSale = await request(base, `/storefront/orders/${mixed.order.id}/after-sales`, { method: "POST", token: cycleToken, expected: 201, body: zeroInput });
  check(zeroSale.requestedCents, 0, "Item-only zero cash claim does not include freight");
  await transition(zeroSale.id, "APPROVED");
  const zeroCalls = refundCalls.length, zeroBefore = await pointBalance();
  await billing.refundAfterSale(zeroSale.id, {}); await billing.refundAfterSale(zeroSale.id, {});
  check(refundCalls.length, zeroCalls, "Zero cash point settlement never dispatches a zero-value refund");
  check(await prisma.paymentRefund.count({ where: { afterSaleId: zeroSale.id } }), 0, "No channel refund row for point-only item");
  check(await pointBalance(), zeroBefore + 1, "Point-only item returns exactly one point once");
  check((await currentOrder(mixed.order.id)).status, "PAID", "Remaining cash item is still fulfillable after point-only refund");
  freightMode = false;
  check(blockedOutbound, 0, "No non-allowlisted fetch attempted");
  check(await prisma.integrationConfig.findMany({ orderBy: { key: "asc" } }), beforeIntegrations, "Provider configuration not modified");
  check(listeners().filter(row => !(previewMode && row.port === 8091)), beforeListeners, "Existing demo/UI listeners preserved");
  if (previewMode || journeyMode) {
    if (journeyMode) {
      // Separate explicit mode: prebuild states through the real domain and
      // signed callbacks, then turn transport identities off before handoff.
      // This is not a mock route and does not change the old --preview policy.
      freightMode = true;
      const journeyPassword = randomBytes(18).toString("base64url");
      const journeyMember = await createUser("journey-browser", await hash(journeyPassword, 12), { email: `journey-${runId}@example.invalid`, emailVerifiedAt: new Date() });
      const journeyLogin = await request(base, "/auth/password/login", { method: "POST", expected: 201, body: { identifier: journeyMember.email, password: journeyPassword } });
      const journeyAddress = await request(base, "/storefront/addresses", { method: "POST", token: journeyLogin.token, expected: 201, body: {
        name: "购物体验收件人（测试不发货）", countryCode: "CN", mobile: "+8613800000000", province: "测试省", city: "测试市", district: "测试区", detail: marker, isDefault: true,
      } });
      await prisma.commercePointAccount.create({ data: { userId: journeyMember.id, balanceCents: 1000 } });
      await prisma.commercePointLedger.create({ data: { userId: journeyMember.id, deltaCents: 1000, type: "SYNTHETIC_QA_GRANT", idempotencyKey: `${marker}:points-seed:journey` } });
      const journeySku = await createProduct("journey-product", 1999);
      const journeyCoupon = await createCoupon("journey-available", 199, { totalQuantity: 5 });
      const buyer = { token: journeyLogin.token, address: journeyAddress };
      const shipped = await newPaidOrder("journey-shipped", [{ skuId: journeySku.skuId, quantity: 2 }], 333, undefined, buyer);
      for (const index of [1, 2]) await admin.createCommerceShipment(shipped.order.id, { version: (await currentOrder(shipped.order.id)).version,
        logisticsCompany: "测试物流（不真实发货）", trackingNo: `QA-${runId}-journey-${index}`, items: [{ orderItemId: shipped.order.items[0].id, quantity: 1 }] }, operator);
      const returnOrder = await newPaidOrder("journey-return", [{ skuId: journeySku.skuId, quantity: 1 }], 0, undefined, buyer);
      await admin.createCommerceShipment(returnOrder.order.id, { version: (await currentOrder(returnOrder.order.id)).version,
        logisticsCompany: "测试物流（不真实发货）", trackingNo: `QA-${runId}-journey-return`, items: [{ orderItemId: returnOrder.order.items[0].id, quantity: 1 }] }, operator);
      await request(base, `/storefront/orders/${returnOrder.order.id}/receipt`, { method: "POST", token: journeyLogin.token, expected: 201 });
      const returnSale = await request(base, `/storefront/orders/${returnOrder.order.id}/after-sales`, { method: "POST", token: journeyLogin.token, expected: 201,
        body: { type: "RETURN_REFUND", items: [{ orderItemId: returnOrder.order.items[0].id, quantity: 1 }], reason: `${marker}:journey return`, idempotencyKey: `qa-${runId}-journey` } });
      await transition(returnSale.id, "APPROVED"); await transition(returnSale.id, "WAITING_RETURN");
      previewActive = true; // No subsequent browser request can dispatch a payment or refund.
      await assert.rejects(() => providers.identity()); assertions++;
      const journeyCaps = await request(base, "/storefront/capabilities", { token: journeyLogin.token });
      truth(journeyCaps.payments.every(row => !row.enabled), "Journey handoff exposes no configured payment channels");
      check(blockedOutbound, 0, "Journey prebuild attempted no non-allowlisted fetch");
      console.log(`Global journey automated assertions PASSED: assertions=${assertions}; requests=${requests}; fakePayments=${calls.length}; fakeRefunds=${refundCalls.length}; run=${runId}; cleanup pending.`);
      console.log(JSON.stringify({ journeyPreview: base, marker, email: journeyMember.email, password: journeyPassword, productId: journeySku.id, skuId: journeySku.skuId,
        shippedOrderId: shipped.order.id, shippedOrderNo: shipped.order.orderNo, returnOrderId: returnOrder.order.id, returnAfterSaleId: returnSale.id, couponId: journeyCoupon.id,
        points: 667, shippingCents: 599, payments: "disabled after synthetic prebuild", finish: "Send finish followed by Enter; closes only this listener and cleans only this marker." }));
    } else {
    previewActive = true;
    const browserPassword = randomBytes(18).toString("base64url");
    const browserMember = await createUser("browser", await hash(browserPassword, 12), { email: `browser-${runId}@example.invalid`, emailVerifiedAt: new Date() });
    const browserLogin = await request(base, "/auth/password/login", { method: "POST", body: { identifier: browserMember.email, password: browserPassword }, expected: [200, 201] });
    check(browserLogin.user.id, browserMember.id, "Browser fixture login verified before handoff");
    await assert.rejects(() => providers.identity()); assertions++;
    console.log(`Global automated assertions PASSED: assertions=${assertions}; requests=${requests}; fakePayments=${calls.length}; run=${runId}; preview pending, cleanup not yet run.`);
    console.log(JSON.stringify({ preview: "http://127.0.0.1:8091", marker, email: browserMember.email, password: browserPassword, productId: sku.id, skuId: sku.skuId,
      priceCents: 1999, payments: "disabled", finish: "Send finish followed by Enter on this process stdin; then scoped cleanup runs." }));
    }
    await new Promise(resolve => {
      const onData = input => { if (String(input).trim() === "finish") { process.stdin.removeListener("data", onData); interrupt.signal.removeEventListener("abort", finish); process.stdin.pause(); resolve(); } };
      const finish = () => { process.stdin.removeListener("data", onData); process.stdin.pause(); resolve(); };
      process.stdin.setEncoding("utf8"); process.stdin.on("data", onData); process.stdin.resume();
      interrupt.signal.addEventListener("abort", finish, { once: true });
    });
  }
} catch (error) { failure = error; }
finally {
  try { if (app) await app.close(); } catch (error) { failure ??= error; }
  try { await cleanup(); } catch (error) { failure ??= error; console.error(`Scoped cleanup failed; preserve run ${runId} for inspection.`); }
  try { if (beforeListeners) check(listeners(), beforeListeners, "Existing listeners unchanged after cleanup"); } catch (error) { failure ??= error; }
  await prisma.$disconnect(); globalThis.fetch = realFetch;
  process.removeListener("SIGINT", onSignal); process.removeListener("SIGTERM", onSignal);
}
if (failure) {
  const message = failure instanceof assert.AssertionError ? failure.message : `${failure?.name ?? "Error"} (details withheld)`;
  console.error(`Global commerce acceptance FAILED: ${message}; stage=${stage}; assertions=${assertions}; requests=${requests}; cleanup=${cleanupVerified}; run=${runId}`);
  if (!(failure instanceof assert.AssertionError)) console.error(String(failure?.stack ?? "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 3).join("\n"));
  process.exitCode = 1;
} else console.log(`Global commerce acceptance PASSED: assertions=${assertions}; requests=${requests}; fakePayments=${calls.length}; fakeRefunds=${refundCalls.length}; cleanup=${cleanupVerified}; run=${runId}`);
