import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { h5FieldContracts as contracts, h5ContractExamples as examples } from "./h5-field-contracts.mjs";
import { notes } from "./api-notes.mjs";

function matches(value, schema) {
  if (!schema) return true;
  if (schema.oneOf) return schema.oneOf.filter(candidate => matches(value, candidate)).length === 1;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if ("const" in schema && schema.const !== value) return false;
  const types = schema.type ? [schema.type].flat() : [];
  if (types.length && !types.some(type => type === "null" ? value === null : type === "integer" ? Number.isSafeInteger(value) :
    type === "array" ? Array.isArray(value) : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value) : typeof value === type)) return false;
  if (typeof value === "number" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === "string" && ((schema.pattern && !new RegExp(schema.pattern).test(value)) ||
    (schema.minLength && value.length < schema.minLength) || (schema.maxLength && value.length > schema.maxLength))) return false;
  if (typeof value === "string" && schema.format === "uuid" && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) return false;
  if (Array.isArray(value)) return (!schema.minItems || value.length >= schema.minItems) &&
    (schema.maxItems === undefined || value.length <= schema.maxItems) &&
    (!schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length) && value.every(item => matches(item, schema.items));
  if (value && typeof value === "object") {
    if ((schema.required ?? []).some(key => !(key in value))) return false;
    return Object.entries(value).every(([key, item]) => matches(item, schema.properties?.[key] ??
      (typeof schema.additionalProperties === "object" ? schema.additionalProperties : null)));
  }
  return true;
}
test("all H5 request/response fixtures are JSON-safe and match their field schemas", () => {
  for (const [key, contract] of Object.entries(contracts)) {
    assert.equal(contract.status, "request-reviewed", key);
    assert.ok(contract.source.includes("apps/api/src/"), key);
    for (const side of ["request", "response"]) {
      const value = contract[side + "Example"], schema = contract[side + "Schema"];
      assert.deepEqual(JSON.parse(JSON.stringify(value)), value, key + " must be JSON-safe");
      if (value !== null) assert.ok(matches(value, schema), key + " " + side);
      if (value && !Array.isArray(value)) assert.ok(Object.keys(value).length, key + " must not document an empty-object request");
    }
  }
});
test("H5 field keys cover authentication, quote, points, payment, employee and separate shipping claims", () => {
  for (const name of ["loginPassword", "requestSms", "loginSms", "refresh", "authorizeWechatH5", "loginWechatH5", "bindWechatH5Mobile",
    "storefrontCapabilities", "bootstrap", "previewOrder", "createOrder", "order", "previewAfterSale", "afterSale", "returnLogistics", "points", "createPayment", "payment"]) {
    assert.ok(contracts["CommerceCompatibilityController." + name], name);
  }
  for (const key of ["CommerceEmployeeController.dashboard", "AdminController.shippingRefundPreview", "AdminController.createShippingRefund"]) assert.ok(contracts[key], key);
});

test("international capability distinguishes supported CN/CNY checkout from real payment readiness", () => {
  const schema = contracts["CommerceCompatibilityController.storefrontCapabilities"].responseSchema;
  const current = examples.globalCapabilities;
  assert.ok(matches(current, schema));
  assert.equal(current.checkout.enabled, true); assert.ok(current.payments.every(channel => !channel.enabled));
  for (const currency of ["USD", "EUR"]) assert.equal(matches({ ...current, checkout: { ...current.checkout, currency } }, schema), false);
  assert.equal(matches({ ...current, checkout: { ...current.checkout, countryCodes: ["US"] } }, schema), false);
  assert.equal(matches({ ...current, payments: [{ channel: "wechat_mini", enabled: true, environments: ["mini"] }] }, schema), false);
});
test("quote and order JSON use integer cents and obey all line and order conservation equations", () => {
  const q = examples.quote, o = examples.order;
  const sum = field => q.lines.reduce((total, line) => total + line[field], 0);
  for (const line of q.lines) {
    assert.equal(line.totalCents, line.unitPriceCents * line.quantity);
    assert.equal(line.totalCents, line.couponDiscountCentsSnapshot + line.pointDiscountCentsSnapshot + line.cashPaidCentsSnapshot);
  }
  assert.equal(q.subtotalCents, sum("totalCents"));
  assert.equal(q.couponDiscountCents, sum("couponDiscountCentsSnapshot"));
  assert.equal(q.pointDiscountCents, sum("pointDiscountCentsSnapshot"));
  assert.equal(q.payableCents, sum("cashPaidCentsSnapshot") + q.shippingCents);
  assert.equal(o.payableCents, o.subtotalCents - o.discountCents - o.pointDiscountCents + o.shippingCents);
  assert.equal(q.payableCents, o.payableCents);
  assert.ok(q.payableCents >= examples.capabilities.checkout.minimumCashCents);
  assert.ok(q.pointDiscountCents <= q.maxPointCents);
});

test("quote examples expose matching conditional fingerprints without requiring them from older callers", () => {
  const q = examples.quote, create = contracts["CommerceCompatibilityController.createOrder"];
  const lines = [...q.lines].sort((a, b) => a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0);
  const fingerprint = "q1:" + createHash("sha256").update(JSON.stringify([q.pricingVersion, q.subtotalCents, q.couponDiscountCents,
    q.pointDiscountCents, q.shippingCents, q.payableCents, lines.map(line => [line.skuId, line.quantity, line.unitPriceCents,
      line.totalCents, line.couponDiscountCentsSnapshot, line.pointDiscountCentsSnapshot, line.cashPaidCentsSnapshot])])).digest("hex");
  assert.equal(q.fingerprint, fingerprint); assert.equal(create.requestExample.expectedQuote, fingerprint);
  assert.equal(create.requestSchema.required.includes("expectedQuote"), false);
  assert.match(create.note, /409 quote_changed/);
});
test("partial refund fixture conserves cash/points and leaves freight separate", () => {
  const quote = examples.afterSale, line = examples.order.items[0];
  assert.equal(quote.requestedCents, quote.merchandiseRefundCents + quote.shippingRefundCents);
  assert.equal(quote.merchandiseRefundCents, quote.items.reduce((sum, item) => sum + item.amountCents, 0));
  assert.equal(quote.pointReturnCents, Math.floor(line.pointDiscountCentsSnapshot / line.quantity));
  assert.equal(quote.pointReturnCents + 601, line.pointDiscountCentsSnapshot);
  assert.equal(quote.merchandiseRefundCents + 39200, line.cashPaidCentsSnapshot);
  const s = examples.shipping;
  assert.equal(s.shippingRemainingCents + s.shippingReservedCents, examples.order.shippingCents);
  assert.equal(s.cashRemainingCents + s.cashReservedCents, examples.order.payableCents);
  assert.equal(s.maximumCents, Math.min(s.shippingRemainingCents, s.cashRemainingCents));
  const claim = contracts["AdminController.createShippingRefund"].responseExample;
  assert.equal(claim.type, "SHIPPING_ONLY"); assert.equal(claim.requestedCents, claim.shippingRefundCents);
  assert.equal(claim.pointReturnCents, 0); assert.equal(claim.status, "APPLIED");
});
test("OAuth fixture uses a matching local SHA256 challenge and does not invent a session before binding", () => {
  const start = contracts["CommerceCompatibilityController.authorizeWechatH5"].requestExample;
  const login = contracts["CommerceCompatibilityController.loginWechatH5"];
  assert.equal(start.codeChallenge, createHash("sha256").update(login.requestExample.codeVerifier).digest("hex"));
  assert.equal(login.responseExample.requiresMobileBinding, true);
  assert.equal("token" in login.responseExample, false);
  const session = contracts["CommerceCompatibilityController.loginSms"].responseExample;
  assert.ok(session.token && session.user.id); assert.equal("data" in session, false);
});
test("unconfigured demo and unverified balances remain explicit and never leak provider secret fields", () => {
  assert.ok(examples.capabilities.payments.every(item => !item.enabled && item.reason));
  const mini = examples.capabilities.payments.find(item => item.channel === "wechat_mini");
  assert.deepEqual(mini?.environments, ["mini"]);
  assert.equal(mini.enabled, false);
  assert.equal(examples.capabilities.payments.find(item => item.channel === "wechat_jsapi").environments.includes("mini"), false);
  assert.equal(examples.capabilities.login.wechatH5.enabled, false);
  assert.equal(contracts["CommerceCompatibilityController.points"].responseExample.balanceCents, null);
  assert.equal(contracts["CommerceEmployeeController.dashboard"].responseExample.trend, null);
  assert.equal(contracts["CommerceEmployeeController.dashboard"].responseExample.bonus.wallet, null);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      assert.doesNotMatch(key, /secret|privateKey|merchantId|appId|apiKey/i);
      if (key === "password") assert.deepEqual(item, { enabled: true });
      walk(item);
    }
  };
  walk(examples.capabilities);
});

test("all four evidence routes have reviewed private contracts without an invented storage success", () => {
  for (const key of ["CommerceEvidenceController.capabilities", "CommerceEvidenceController.upload", "CommerceEvidenceController.image", "AdminCommerceEvidenceController.image"]) {
    assert.ok(contracts[key], key); assert.ok(notes[key], key);
    assert.match(contracts[key].source, /commerce-evidence\.controller\.ts/);
    assert.match(contracts[key].source, /support\.service\.ts/);
  }
  const capability = contracts["CommerceEvidenceController.capabilities"];
  assert.deepEqual(capability.responseExample, { enabled: false, maxFiles: 9, maxBytes: 10485760,
    contentTypes: ["image/jpeg", "image/png", "image/webp"], reason: "图片服务未配置，暂不可上传；您仍可提交文字说明。" });
  assert.match(capability.note, /不代表已有真实上传/);
  const upload = contracts["CommerceEvidenceController.upload"];
  assert.equal(upload.contentType, "multipart/form-data");
  assert.deepEqual(upload.requestSchema.required, ["file"]); assert.equal(upload.requestSchema.properties.file.format, "binary");
  assert.deepEqual(Object.keys(upload.responseExample), ["id", "byteSize", "contentType", "sha256"]);
  assert.equal(upload.responseSchema.properties.byteSize.maximum, 10485760);
  assert.match(upload.note, /每分钟12次/); assert.match(upload.note, /413/); assert.match(upload.note, /503/);
  assert.match(upload.note, /不证明对象存储已配置/); assert.match(upload.note, /h5-phone-test/);
  for (const key of ["CommerceEvidenceController.image", "AdminCommerceEvidenceController.image"]) {
    assert.deepEqual({ type: contracts[key].responseSchema.type, format: contracts[key].responseSchema.format }, { type: "string", format: "binary" });
    assert.equal(contracts[key].responseExample, null);
    assert.match(contracts[key].note, /private, no-store/); assert.match(contracts[key].note, /禁止按JSON解析/);
  }
  assert.match(contracts["AdminCommerceEvidenceController.image"].note, /COMMERCE_EVIDENCE_READ/);
  assert.match(contracts["AdminCommerceEvidenceController.image"].note, /审计失败不返回图片/);
});

test("after-sale image references are optional owned UUIDs and remain part of the frozen idempotent payload", () => {
  const sale = contracts["CommerceCompatibilityController.afterSale"], schema = sale.requestSchema.properties.evidenceFileIds;
  assert.equal(sale.requestSchema.required.includes("evidenceFileIds"), false);
  assert.ok(sale.requestSchema.required.includes("reason"));
  assert.ok(matches([], schema)); assert.ok(matches(sale.requestExample.evidenceFileIds, schema));
  assert.equal(matches(["https://example.invalid/evidence.jpg"], schema), false);
  assert.equal(matches(Array(2).fill(sale.requestExample.evidenceFileIds[0]), schema), false);
  assert.equal(matches(Array.from({ length: 10 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`), schema), false);
  assert.deepEqual(sale.responseExample.evidenceImages, sale.requestExample.evidenceFileIds.map(id => `file:${id}`));
  assert.match(sale.note, /global禁止非空外链/); assert.match(sale.note, /含相同图片ID/); assert.match(sale.note, /同键同参优先返回原售后/);
  assert.ok(sale.requestExample.idempotencyKey);
  assert.ok(contracts["CommerceCompatibilityController.availableCoupons"]);
  assert.ok(contracts["CommerceCompatibilityController.orders"].query.group);
  assert.ok(contracts["CommerceCompatibilityController.order"].responseSchema.oneOf[0].properties.items.items.properties.review);
});

test("the generated H5 section includes its evidence controller without moving the administrator route", () => {
  const generator = readFileSync(new URL("./generate-api-reference.mjs", import.meta.url), "utf8");
  const h5Section = generator.split('["商城 H5/小程序兼容接口",')[1].split('["V2 App 接口",')[0];
  assert.match(h5Section, /r\.key\.startsWith\("CommerceEvidenceController\."\)/);
  assert.doesNotMatch(h5Section, /AdminCommerceEvidenceController/);
  assert.match(generator, /管理后台接口.*r\.path\.startsWith\("\/api\/saydian-app\/admin\/"\)/);
});
