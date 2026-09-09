// Deliberately explicit: an inferred controller route is not a verified field contract.
import { h5FieldContracts } from "./h5-field-contracts.mjs";
// Examples are synthetic, never captured user data. Source references must be
// reviewed when service validation or the frozen Flutter consumer changes.
const string = { type: "string" };
const integer = { type: "integer" };
const boolean = { type: "boolean" };
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: true });
const array = items => ({ type: "array", items });
const positive = { type: "integer", minimum: 1 };
const numericForm = { oneOf: [positive, { type: "string", pattern: "^[1-9][0-9]*$" }] };
const id = { type: "string", format: "uuid" };
const sampleId = "00000000-0000-4000-8000-000000000001";
const session = object({ accessToken: string, refreshToken: string, expiresAt: { type: "string", format: "date-time" }, member: object({ id, nickname: string }, ["id", "nickname"]) }, ["accessToken", "refreshToken", "expiresAt", "member"]);
const sessionExample = { accessToken: "<ACCESS_TOKEN>", refreshToken: "<REFRESH_TOKEN>", expiresAt: "2026-09-08T10:00:00.000Z", member: { id: sampleId, nickname: "契约测试会员" } };
const record = (requestSchema, requestExample, responseSchema, responseExample, source, contentType = "application/json") => ({
  status: "request-reviewed", requestSchema, requestExample, responseSchema, responseExample, contentType, source,
  note: "请求字段和最小响应形状已由源码复核；示例为合成测试数据，不代表生产调用成功或字段级真机验收。",
});
const authSource = "apps/api/src/auth/auth.controller.ts; apps/api/src/auth/auth.service.ts; packages/contracts/src/index.ts";
const globalAuthSource = `${authSource}; apps/api/src/auth/global-auth.service.ts; apps/api/src/auth/global-legal.ts`;
const globalLocale = { enum: ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"] };
const verificationChannel = { enum: ["email", "sms"] };
const globalLogin = object({ channel: verificationChannel, identifier: string, password: string }, ["channel", "identifier", "password"]);
const globalSessionExample = { ...sessionExample, member: { id: sampleId, nickname: "Saydian user", emailMasked: "u***@example.com", locale: "en" } };
const legalReference = object({ path: string, locale: globalLocale, version: string }, ["path", "locale", "version"]);
export const fieldContracts = {
  "AuthController.capabilities": record(null, null, object({ realm: { const: "global" }, defaultLocale: { const: "en" }, supportedLocales: array(globalLocale), registration: object({ email: boolean, sms: boolean }, ["email", "sms"]), smsCountries: array(string), verification: object({ codeLength: integer, expiresIn: integer, retryAfter: integer }), consentVersion: { type: ["string", "null"] }, legal: { oneOf: [{ type: "null" }, object({ userAgreement: legalReference, privacyPolicy: legalReference }, ["userAgreement", "privacyPolicy"])] } }), { realm: "global", defaultLocale: "en", supportedLocales: globalLocale.enum, registration: { email: false, sms: false }, smsCountries: [], verification: { codeLength: 6, expiresIn: 300, retryAfter: 60 }, consentVersion: null, legal: null }, globalAuthSource),
  "AuthController.verificationCode": record(object({ channel: verificationChannel, identifier: string, purpose: { enum: ["register", "reset_password"] }, locale: globalLocale }, ["channel", "identifier", "purpose"]), { channel: "email", identifier: "user@example.com", purpose: "register", locale: "en" }, object({ challengeId: id, expiresIn: integer, retryAfter: integer, maskedIdentifier: string }, ["challengeId", "expiresIn", "retryAfter", "maskedIdentifier"]), { challengeId: sampleId, expiresIn: 300, retryAfter: 60, maskedIdentifier: "u***@example.com" }, globalAuthSource),
  "AuthController.registerWithCode": record(object({ challengeId: id, code: { type: "string", pattern: "^[0-9]{6}$" }, password: string, nickname: string, consentVersion: string, locale: globalLocale }, ["challengeId", "code", "password", "consentVersion"]), { challengeId: sampleId, code: "000000", password: "<TEST_PASSWORD>", consentVersion: "<PUBLISHED_CONSENT_VERSION>", locale: "en" }, session, globalSessionExample, globalAuthSource),
  "AuthController.login": record({ anyOf: [object({ mobile: string, username: string, password: string }, ["password"]), globalLogin] }, { mobile: "<TEST_MOBILE>", password: "<TEST_PASSWORD>" }, session, sessionExample, globalAuthSource),
  "AuthController.requestSms": record(object({ mobile: string, usage: { enum: ["register", "reset_password"] } }, ["mobile"]), { mobile: "<TEST_MOBILE>", usage: "reset_password" }, object({}), null, authSource),
  "AuthController.resetPassword": record({ anyOf: [object({ mobile: string, code: string, password: string, newPassword: string }, ["mobile", "code"]), object({ challengeId: id, code: string, password: string }, ["challengeId", "code", "password"])] }, { mobile: "<TEST_MOBILE>", code: "<SMS_CODE>", password: "<NEW_TEST_PASSWORD>" }, session, sessionExample, globalAuthSource),
  "AuthController.registerWithSms": record(object({ mobile: string, code: string, password: string, nickname: string, consentVersion: string }, ["mobile", "code", "password", "consentVersion"]), { mobile: "<TEST_MOBILE>", code: "<SMS_CODE>", password: "<TEST_PASSWORD>", nickname: "契约测试会员", consentVersion: "<PUBLISHED_CONSENT_VERSION>" }, session, sessionExample, authSource),
  "AuthController.refresh": record(object({ refreshToken: string }, ["refreshToken"]), { refreshToken: "<REFRESH_TOKEN>" }, session, sessionExample, authSource),
  "AuthController.wechatLogin": record(object({ code: string, state: string, platform: { enum: ["android", "ios", "harmony"] }, consentAccepted: { const: true }, consentVersion: string }, ["code", "state", "platform", "consentAccepted", "consentVersion"]), { code: "<ONE_TIME_WECHAT_CODE>", state: "<OAUTH_STATE>", platform: "android", consentAccepted: true, consentVersion: "<PUBLISHED_CONSENT_VERSION>" }, session, sessionExample, authSource),
  "AuthController.logout": record(null, null, object({ loggedOut: { const: true } }, ["loggedOut"]), { loggedOut: true }, authSource),
  "MembersController.saveGoals": record(object({ steps: { type: ["number", "null"] }, distanceMeters: { type: ["number", "null"] }, caloriesKcal: { type: ["number", "null"] } }), { steps: 8000, distanceMeters: 5000, caloriesKcal: 350 }, object({}), null, "apps/api/src/members/members.service.ts"),
  "CommerceController.markets": record(null, null, object({ markets: array(object({ countryCode: string, currency: string, currencyExponent: integer, commerceEnabled: { const: false }, paymentChannels: array(string) })) }, ["markets"]), { markets: [] }, "apps/api/src/commerce/global-commerce-policy.ts; apps/api/src/commerce/commerce-store.service.ts"),
  "SupportController.feedback": record(object({ content: { type: "string", minLength: 5, maxLength: 2000 }, category: string, contact: string, attachments: array(id) }, ["content"]), { content: "契约测试反馈内容", category: "other", attachments: [] }, object({ id, status: string }, ["id", "status"]), { id: sampleId, status: "PENDING" }, "apps/api/src/support/support.service.ts"),
  "CommerceController.putCart": record(object({ skuId: id, quantity: positive, selected: boolean }, ["skuId", "quantity"]), { skuId: sampleId, quantity: 2, selected: true }, object({ items: array(object({})) }), null, "apps/api/src/commerce/commerce-store.service.ts"),
  "BillingController.createPayment": record(object({ businessType: { enum: ["commerce_order", "health_report", "health_membership"] }, businessId: id, channel: string, offerId: id, platform: string, idempotencyKey: { type: "string", minLength: 8, maxLength: 160 } }, ["businessType", "channel", "idempotencyKey"]), { businessType: "commerce_order", businessId: sampleId, channel: "wechat_app", platform: "android", idempotencyKey: "contract-payment-0001" }, object({ id, paymentNo: string, status: string, amountCents: integer, currency: string }, ["id", "paymentNo", "status", "amountCents", "currency"]), null, "apps/api/src/billing/billing.service.ts"),
  "BillingAdminController.createRefund": record(object({ amountCents: positive, reason: { type: "string", minLength: 2, maxLength: 256 }, afterSaleId: id, idempotencyKey: { type: "string", minLength: 8, maxLength: 160 } }, ["amountCents", "reason", "idempotencyKey"]), { amountCents: 100, reason: "契约测试退款", idempotencyKey: "contract-refund-0001" }, object({ refundNo: string, status: string }, ["refundNo", "status"]), null, "apps/api/src/billing/billing.service.ts; apps/api/src/billing/billing-safety.test.ts"),
  "BillingAdminController.replayProviderEvents": record(object({ limit: { type: "integer", minimum: 1, maximum: 100 } }), { limit: 20 }, object({ items: array(object({ id, processed: boolean, error: string }, ["id", "processed"])), remaining: integer }, ["items", "remaining"]), { items: [], remaining: 0 }, "apps/api/src/billing/billing.service.ts; apps/api/src/billing/billing-safety.test.ts"),
};

const cartRow = object({ id: positive, cart_item_id: positive, sku_id: positive, product_id: positive, num: positive, quantity: positive, price: { type: ["number", "string"] }, available: boolean }, ["id", "sku_id", "num"]);
const legacySource = "apps/api/src/legacy/legacy-flutter-contract.test.ts; apps/api/src/legacy/fixtures/flutter-fa79aa3-consumers.json";
fieldContracts["LegacyCartController.index"] = record(null, null, array(cartRow), [], legacySource);
for (const key of ["LegacyCartController.create", "LegacyCartController.updateNumber"]) {
  fieldContracts[key] = record(object({ sku_id: numericForm, num: numericForm }, ["sku_id", "num"]), { sku_id: "101", num: "2" }, array(cartRow), [], legacySource, "multipart/form-data");
}
fieldContracts["LegacyCartController.deleteIds"] = record(object({ sku_ids: { type: "string", pattern: "^[1-9][0-9]*(,[1-9][0-9]*)*$" } }, ["sku_ids"]), { sku_ids: "101,102" }, array(cartRow), [], legacySource, "multipart/form-data");
const warningSchema = object({ heart_auto: { enum: [0, 1] }, heart_num: { type: "integer", minimum: 20, maximum: 300 }, blood_pressure_auto: { enum: [0, 1] }, blood_glucose_auto: { enum: [0, 1] }, body_temperature_auto: { enum: [0, 1] } });
const warningExample = { heart_auto: 0, heart_num: 120, blood_pressure_auto: 0, blood_glucose_auto: 0, body_temperature_auto: 0 };
fieldContracts["LegacyMemberController.warningSettings"] = record(null, null, warningSchema, warningExample, legacySource);
fieldContracts["LegacyMemberController.saveWarningSettings"] = record(warningSchema, warningExample, warningSchema, warningExample, legacySource, "multipart/form-data");
fieldContracts["LegacyMemberController.feedback"] = record(object({ type: string, content: { type: "string", minLength: 5, maxLength: 2000 }, contact: string, attachments: string }, ["content"]), { type: "other", content: "契约测试反馈内容", contact: "<TEST_CONTACT>" }, object({ id, status: string }, ["id", "status"]), null, legacySource, "multipart/form-data");
fieldContracts["LegacySiteController.version"] = record(null, null, { oneOf: [{ type: "null" }, object({ version: positive, version_code: string, lowwer: integer, force: { enum: [0, 1] }, status: { enum: [0, 1] }, android_type: { enum: [0, 1] }, android: string, ios: string, sha256: string }, ["version", "version_code", "lowwer", "force", "status"])] }, null, legacySource);
fieldContracts["LegacySiteController.version"].query = { platform: { schema: { enum: ["android", "ios"] }, example: "android", required: true }, v: { schema: { type: "integer", minimum: 0 }, example: 1, required: false } };
const legacySession = object({ access_token: string, refresh_token: string, expiration_time: positive, member: object({ id: positive, nickname: string }, ["id"]) }, ["access_token", "refresh_token", "expiration_time", "member"]);
for (const [key, body, example] of [
  ["login", object({ username: string, mobile: string, password: string }, ["password"]), { username: "<TEST_MOBILE>", password: "<TEST_PASSWORD>" }],
  ["resetPassword", object({ mobile: string, code: string, password: string }, ["mobile", "code", "password"]), { mobile: "<TEST_MOBILE>", code: "<SMS_CODE>", password: "<NEW_TEST_PASSWORD>" }],
  ["refresh", object({ refresh_token: string }, ["refresh_token"]), { refresh_token: "<REFRESH_TOKEN>" }],
]) fieldContracts[`LegacySiteController.${key}`] = record(body, example, legacySession, null, "apps/api/src/legacy/legacy-site.controller.ts; apps/api/src/legacy/legacy-response.ts", "multipart/form-data");

const withdrawalSource = "apps/api/src/commerce/commerce-withdrawal.service.ts; apps/api/src/commerce/commerce-withdrawal.test.ts";
const withdrawal = object({ id, amountCents: positive, status: string, version: integer, executionOwner: string }, ["id", "amountCents", "status", "version"]);
fieldContracts["CommerceEmployeeWithdrawalController.apply"] = record(object({ amountCents: positive, idempotencyKey: string }, ["amountCents", "idempotencyKey"]), { amountCents: 1000, idempotencyKey: "contract-withdrawal-001" }, withdrawal, null, withdrawalSource);
fieldContracts["CommerceAdminWithdrawalController.review"] = record(object({ version: { type: "integer", minimum: 0 }, idempotencyKey: string, decision: { enum: ["APPROVE", "REJECT"] }, note: string }, ["version", "idempotencyKey", "decision", "note"]), { version: 0, idempotencyKey: "contract-review-001", decision: "REJECT", note: "合成测试：未通过核验" }, withdrawal, null, withdrawalSource);
const receiptFields = { version: { type: "integer", minimum: 0 }, idempotencyKey: string, providerTransferId: string, amountCents: positive, recipientOpenId: string, receiptReference: string, evidence: string, completedAt: { type: "string", format: "date-time" }, confirmedExternalResult: { const: true } };
for (const method of ["receipt", "verify"]) {
  const fields = { ...receiptFields, ...(method === "verify" ? { result: { enum: ["SUCCEEDED", "FAILED"] } } : {}) };
  fieldContracts[`CommerceAdminWithdrawalController.${method}`] = record(object(fields, Object.keys(fields)), {
    version: 1, idempotencyKey: `contract-${method}-001`, providerTransferId: "<VERIFIED_ORIGINAL_TRANSFER_ID>", amountCents: 1000,
    recipientOpenId: "<VERIFIED_RECIPIENT_ID>", receiptReference: "<RECEIPT_ARCHIVE_REFERENCE>", evidence: "<VERIFIED_RECEIPT_EVIDENCE>", completedAt: "2026-09-08T01:00:00.000Z", confirmedExternalResult: true,
    ...(method === "verify" ? { result: "SUCCEEDED" } : {}),
  }, withdrawal, null, withdrawalSource);
}

Object.assign(fieldContracts, h5FieldContracts);

export function routeContract(route) {
  return fieldContracts[route.key] ?? { status: "unreviewed", requestSchema: null, requestExample: null, responseSchema: null, responseExample: null, contentType: /multipart/i.test(route.request) ? "multipart/form-data" : "application/json", source: route.source, note: "字段级 Schema 尚待复核；路由存在不代表客户端解析或业务已验收。" };
}
