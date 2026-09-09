import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { h5FieldContracts as contracts, h5ContractExamples as examples } from "./h5-field-contracts.mjs";

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
  if (Array.isArray(value)) return (!schema.minItems || value.length >= schema.minItems) && value.every(item => matches(item, schema.items));
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
