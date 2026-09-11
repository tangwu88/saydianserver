// Explicit, local-demo-only browser fixtures. No seed/reset of existing data.
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { validateDemoProfile } from "./h5-demo-profile.mjs";

const [action, profileInput] = process.argv.slice(2);
assert(["create", "cleanup"].includes(action) && profileInput && process.argv.length === 4, "Usage: h5-browser-fixture.mjs create|cleanup <private-profile>");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = resolve(profileInput), settings = parseEnv(await readFile(profilePath, "utf8"));
validateDemoProfile(settings, repo, profilePath);
Object.assign(process.env, { DATABASE_URL: settings.DATABASE_URL, H5_DEMO_ENABLED: "true", NODE_ENV: "development" });
const require = createRequire(join(repo, "apps/api/package.json"));
require(join(repo, "tools/h5-demo-network-guard.cjs"));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const manifestPath = join(dirname(profilePath), "browser-fixture-20260911.json");
const prefix = "/api/saidian-mall/v1";
async function request(path, body, token) {
  assert(["/storefront/capabilities", "/auth/sms/request", "/auth/sms/login", "/storefront/addresses"].includes(path));
  const response = await fetch("http://127.0.0.1:8081" + prefix + path, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert(response.ok, "Local demo fixture request failed; response withheld");
  return response.json();
}
try {
  assert.equal((await prisma.$queryRaw`SELECT current_database() AS name`)[0].name, "saydian_h5_demo");
  assert.equal(await prisma.integrationSecret.count(), 0, "Demo contains provider secrets");
  assert.equal(await prisma.integrationConfig.count({ where: { state: "CONFIGURED" } }), 0, "A demo integration was enabled");
  if (action === "create") {
    const capabilities = await request("/storefront/capabilities");
    assert(capabilities.demo && capabilities.login.sms.enabled && capabilities.payments.every(row => !row.enabled), "Demo/SMS/payment isolation mismatch");
    let mobile;
    for (let attempt = 0; attempt < 100; attempt++) {
      // NANP 650-555-0100..0199 is a fictional-number block, never real SMS.
      const candidate = `165055501${String(randomInt(0, 100)).padStart(2, "0")}`;
      if (!await prisma.user.findUnique({ where: { mobile: candidate } }) && !await prisma.smsCode.count({ where: { mobile: candidate } })) { mobile = candidate; break; }
    }
    assert(mobile, "No unused fictional number available");
    const runId = randomUUID(), marker = `h5-browser-qa:${runId}`;
    const manifest = { runId, marker, mobile, startedAt: new Date().toISOString(), userId: null, addressId: null,
      products: [1999, 999].map((price, index) => ({ id: randomUUID(), skuId: randomUUID(), erpItemId: `${marker}:${index}`, price, stock: index ? 2 : 5 })), status: "preparing" };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
    const otp = await request("/auth/sms/request", { mobile });
    assert.equal(otp.devCode, "123456", "Only a local developer OTP is allowed");
    const session = await request("/auth/sms/login", { mobile, code: otp.devCode, consentVersion: "commerce-legal-v1" });
    const member = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id } });
    assert(member.mobile === mobile && member.createdAt >= new Date(manifest.startedAt) && member.email === null && member.passwordHash === null, "New fixture account ownership mismatch");
    manifest.userId = member.id;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: member.id }, data: { nickname: marker } });
      for (const [index, product] of manifest.products.entries()) {
        await tx.commerceProduct.create({ data: {
          id: product.id, erpItemId: product.erpItemId, source: "LOCAL", name: product.erpItemId,
          displayName: `QA浏览器测试${index ? "B" : "A"} · ${runId.slice(0, 8)}`, subtitle: "本轮合成测试商品，不发货、不收款；图片使用界面占位符",
          gallery: [], tags: ["本轮QA", "合成数据"], status: "PUBLISHED", featured: true, sort: 900 + index,
          skus: { create: { id: product.skuId, erpItemId: product.erpItemId, erpSkuId: product.erpItemId, salePriceCents: product.price,
            stock: product.stock, enabled: true, specification: "合成测试规格" } },
        } });
      }
    });
    const address = await request("/storefront/addresses", { name: "QA合成收件人", mobile, province: "测试省", city: "测试市", district: "测试区", detail: `${marker} 禁止真实发货`, isDefault: true }, session.token);
    manifest.addressId = address.id; manifest.status = "ready";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ marker, mobile, developerOtp: "123456", userId: member.id, addressId: address.id, products: manifest.products, manifestPath, realSms: false, realPayments: false }, null, 2));
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert(/^h5-browser-qa:[0-9a-f-]{36}$/.test(manifest.marker) && manifest.marker === `h5-browser-qa:${manifest.runId}`, "Fixture marker is invalid");
    assert(manifest.userId && manifest.products.length === 2 && /^165055501\d{2}$/.test(manifest.mobile), "Incomplete fixture manifest: inspect before cleanup");
    if (manifest.status === "cleaned") { console.log("This browser fixture was already cleaned; no changes."); }
    else {
      await prisma.$transaction(async tx => {
        const member = await tx.user.findUnique({ where: { id: manifest.userId } });
        assert(member && member.nickname === manifest.marker && member.mobile === manifest.mobile && member.createdAt >= new Date(manifest.startedAt), "Member marker changed; refusing cleanup");
        const productIds = manifest.products.map(row => row.id);
        for (const own of manifest.products) {
          const product = await tx.commerceProduct.findUnique({ where: { id: own.id }, include: { skus: true } });
          assert(product && product.erpItemId === own.erpItemId && product.source === "LOCAL" && product.createdAt >= new Date(manifest.startedAt), "Product marker changed; refusing cleanup");
          assert(product.skus.length === 1 && product.skus[0].id === own.skuId && product.skus[0].erpSkuId === own.erpItemId, "SKU ownership changed; refusing cleanup");
        }
        assert.equal(await tx.commerceOrderItem.count({ where: { productId: { in: productIds }, order: { userId: { not: member.id } } } }), 0, "Another account used a fixture product");
        assert.equal(await tx.commerceCartItem.count({ where: { sku: { productId: { in: productIds } }, cart: { userId: { not: member.id } } } }), 0, "Another cart references a fixture product");
        assert.equal(await tx.commerceFavorite.count({ where: { productId: { in: productIds }, userId: { not: member.id } } }), 0, "Another account saved a fixture product; refusing cleanup");
        assert.equal(await tx.commerceReview.count({ where: { productId: { in: productIds }, userId: { not: member.id } } }), 0, "Another account reviewed a fixture product; refusing cleanup");
        const orders = await tx.commerceOrder.findMany({ where: { userId: member.id }, include: { items: true } });
        assert(orders.every(order => ["PENDING_PAYMENT", "CANCELLED"].includes(order.status) && order.items.every(item => productIds.includes(item.productId))), "Paid/foreign merchandise order requires manual fixture review");
        const orderIds = orders.map(row => row.id);
        const intents = await tx.paymentIntent.findMany({ where: { userId: member.id } });
        assert(intents.every(intent => ["PENDING", "CREATED", "FAILED", "CLOSED", "CANCELLED"].includes(intent.status) && orderIds.includes(intent.commerceOrderId)), "Processed/non-commerce payment requires manual review");
        assert.equal(await tx.commerceAfterSale.count({ where: { orderId: { in: orderIds } } }), 0, "After-sale exists; refusing cleanup");
        assert.equal(await tx.commerceIntegrationJob.count({ where: { aggregateId: { in: orderIds } } }), 0, "Queued integration work exists; refusing cleanup");
        await tx.paymentIntent.deleteMany({ where: { id: { in: intents.map(row => row.id) }, userId: member.id } });
        await tx.commercePointLedger.deleteMany({ where: { userId: member.id } });
        await tx.commerceCouponClaim.deleteMany({ where: { userId: member.id } });
        await tx.commerceOrder.deleteMany({ where: { id: { in: orderIds }, userId: member.id } });
        await tx.commerceCartItem.deleteMany({ where: { cart: { userId: member.id } } });
        await tx.commerceCart.deleteMany({ where: { userId: member.id } });
        await tx.commerceAddress.deleteMany({ where: { userId: member.id } });
        await tx.commercePointAccount.deleteMany({ where: { userId: member.id } });
        await tx.smsCode.deleteMany({ where: { mobile: manifest.mobile, createdAt: { gte: new Date(manifest.startedAt) } } });
        await tx.userSession.deleteMany({ where: { userId: member.id } });
        await tx.consentRecord.deleteMany({ where: { userId: member.id } });
        await tx.idempotencyRecord.deleteMany({ where: { userId: member.id } });
        await tx.commerceProduct.deleteMany({ where: { id: { in: productIds } } });
        await tx.user.delete({ where: { id: member.id } });
      }, { isolationLevel: "Serializable", timeout: 30000 });
      manifest.status = "cleaned"; manifest.cleanedAt = new Date().toISOString();
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
      console.log("Removed only the verified browser fixture member, products and dependent unpaid test records; private manifest retained.");
    }
  }
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split("\n")[0] : "Browser fixture operation failed; private manifest retained, details withheld.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
