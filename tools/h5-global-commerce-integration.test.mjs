import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = readFileSync(new URL("./h5-global-commerce-integration.mjs", import.meta.url), "utf8");
test("global acceptance is opt-in, private loopback demo only and never starts the regular runtime", () => {
  assert.match(source, /RUN_H5_GLOBAL_COMMERCE_ACCEPTANCE/);
  assert.match(source, /validateDemoProfile\(profile, repo, profilePath\)/);
  assert.match(source, /current_database\(\)/);
  assert.match(source, /APP_REALM: "global"/);
  assert.match(source, /app\.listen\(previewMode \? 8091 : 0, "127\.0\.0\.1"\)/);
  assert.match(source, /8080,8081,5173,5174,5175,5189,8091/);
  assert.doesNotMatch(source, /Start-Process|Stop-Process|h5-demo-runtime|AppModule|kill\(/);
});
test("global acceptance retains actual payment create policy and blocks real transports/secrets", () => {
  assert(source.indexOf("h5-demo-network-guard.cjs") < source.indexOf('require("@prisma/client")'));
  assert.match(source, /class SyntheticPayments extends PaymentProviderService/);
  assert.match(source, /async createWechat\(intent\)/);
  assert.doesNotMatch(source, /async create\(intent/);
  assert.match(source, /return super\.identity\(channel\)/);
  assert.match(source, /generateKeyPairSync\("rsa"/);
  assert.match(source, /Incomplete credentials reject before reserving a PaymentIntent/);
  assert.match(source, /currency: "USD"/);
  assert.match(source, /businessType: "HEALTH_REPORT"/);
  assert.match(source, /Supplier secret access forbidden/);
  assert.doesNotMatch(source, /integrationConfig\.(?:create|update|upsert|delete)|integrationSecret\.(?:create|update|upsert|delete)/);
});
test("global acceptance checks identity, address, cancel and transaction-scoped foreign-reference cleanup", () => {
  for (const text of ["emailVerifiedAt", "mobileVerifiedAt", "h5-phone-test:", "countryCode: \"CN\"", "countryCode: \"US\"", "Cancellation returns inventory"]) assert(source.includes(text));
  const cleanup = source.slice(source.indexOf("async function cleanup()"), source.indexOf("\ntry {\n"));
  assert.match(cleanup, /isolationLevel: "Serializable"/);
  for (const guard of ["commerceOrderItem.count", "commerceCartItem.count", "commerceFavorite.count", "commerceReview.count"]) {
    assert(cleanup.indexOf(guard) >= 0 && cleanup.indexOf(guard) < cleanup.indexOf("deleteMany"));
  }
  assert.match(cleanup, /order\.idempotencyKey\.startsWith\(marker\)/);
  assert.match(cleanup, /row\.createdAt >= started/);
  assert.match(cleanup, /providerMerchantId === "SYNTHETIC_MERCHANT"/);
});
test("explicit preview leaves real payments off and legal fixtures out of the shared database", () => {
  assert.match(source, /process\.argv\[3\] === "--preview"/);
  assert.match(source, /Preview port 8091 must already be empty/);
  assert.match(source, /if \(previewActive\) throw new Error\("Payments disabled/);
  assert.match(source, /new Proxy\(prisma/);
  assert.doesNotMatch(source, /globalLegalDocument\.(?:create|upsert|update|delete)/);
  assert.match(source, /Browser preview must have no payment intents/);
  assert.match(source, /String\(input\)\.trim\(\) === "finish"/);
});
test("full-cycle acceptance verifies real callback cryptography and mocks final transports only", () => {
  assert.match(source, /createCipheriv\("aes-256-gcm"/);
  assert.match(source, /createSign\("RSA-SHA256"/);
  assert.match(source, /req\.rawBody = buffer/);
  assert.match(source, /async refundWechat\(refund\)/);
  assert.doesNotMatch(source, /async (?:decodeWechatNotification|handleWechatNotification|handleWechatRefundNotification|applyRefundSucceeded|markPaid)\(/);
  for (const expected of ["Invalid signature cannot mark order paid", "Signed wrong amount is rejected", "Points remain occupied until verified cash success", "Refund callback duplicates never credit points again"]) assert(source.includes(expected));
});
test("paid fixture cleanup stays exact and cannot widen browser or foreign financial ownership", () => {
  const cleanup = source.slice(source.indexOf("async function cleanup()"), source.indexOf("\ntry {\n"));
  assert.match(cleanup, /owned\.paidOrderIds\.includes\(order\.id\) && !browserOwner/);
  assert.match(cleanup, /intent\.providerTransactionId === `\$\{marker\}:\$\{order\.id\}`/);
  assert.match(cleanup, /intent\.providerPayload\?\.testRun === runId/);
  assert.match(cleanup, /eventKey: \{ in: owned\.eventKeys \}/);
  assert.match(cleanup, /row\.payload\?\.testRun === runId/);
  for (const guard of ["Only own synthetic parcels", "Only own marked reviews", "No foreign coupon claims", "After-sales are only own", "Refunds belong only", "Admin audit cleanup", "No employee grant would cascade", "No employee gift would be removed"]) assert(cleanup.indexOf(guard) >= 0 && cleanup.indexOf(guard) < cleanup.indexOf("deleteMany"));
});
test("freight configuration is instance-scoped and financial transitions are exercised through real services", () => {
  assert.match(source, /prisma\.\$extends\(\{ query: \{ commerceBusinessConfig/);
  assert.match(source, /new CommerceStoreService\(quotePrisma\)/);
  assert.doesNotMatch(source, /commerceBusinessConfig\.(?:update|upsert|create|delete)/);
  assert.doesNotMatch(source, /commerceOrder\.(?:update|updateMany)/);
  for (const expected of ["admin.createCommerceShipment", "billing.refundAfterSale", "333, 333, 334", "Freight returns no points", "Zero cash point settlement never dispatches", "Concurrent claims cannot consume", "Lost after-sale response replays"]) assert(source.includes(expected));
});
test("journey preview is opt-in, prebuilds real states, and preserves the older unpaid preview", () => {
  assert.match(source, /process\.argv\[3\] === "--journey-preview"/);
  assert.match(source, /app\.listen\(previewMode \? 8091 : 0/);
  assert.match(source, /if \(browserOwner\) check\(order\.paymentIntents\.length, 0/);
  assert.match(source, /if \(journeyOwner && !paidFixture\) check\(order\.paymentIntents\.length, 0/);
  assert.match(source, /const journeyOrderIds = orders\.filter\(order => owned\.paidOrderIds\.includes\(order\.id\)/);
  assert.match(source, /newPaidOrder\("journey-shipped"/);
  assert.match(source, /newPaidOrder\("journey-return"/);
  assert.match(source, /previewActive = true; \/\/ No subsequent browser request/);
  assert.match(source, /Journey handoff exposes no configured payment channels/);
  assert(source.indexOf('console.log(JSON.stringify({ journeyPreview: base') > source.indexOf('previewActive = true; // No subsequent browser request'));
  assert.doesNotMatch(source, /@(Post|Get)\(|app\.(?:post|get|put|delete)\(\s*["'`]/);
});
test("evidence preview uses the real member controller and unconfigured support only", () => {
  assert.match(source, /new SupportService\(prisma, disabledSecrets\)/);
  assert.match(source, /controllers: \[CommerceCompatibilityController, ContentController, CommerceEvidenceController\]/);
  assert.match(source, /after-sale-images\/capabilities", \{ expected: 401 \}/);
  assert.match(source, /check\(evidenceCapability\.enabled, false/);
  assert.doesNotMatch(source, /new S3Client|PutObjectCommand|support\.storage\s*=/);
});
