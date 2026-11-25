// Dedicated read-only identities; synthetic shapes reviewed against controller/service/tests.
const string = { type: "string" }, integer = { type: "integer", minimum: 0 }, boolean = { type: "boolean" };
const id = { type: "string", format: "uuid" }, date = { type: "string", format: "date-time" };
const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: true });
const array = items => ({ type: "array", items });
const account = object({ id, username: string, displayName: string, active: boolean, version: integer, createdAt: date, updatedAt: date });
const card = object({ cardNo: { type: "string", pattern: "^8[0-9]{7}$" }, status: { enum: ["REDEEMED", "NOT_REDEEMED", "NOT_FOUND"] }, orderNo: { type: ["string", "null"] } });
const record = (requestSchema, responseSchema) => ({ status: "request-reviewed", requestSchema, requestExample: null, responseSchema, responseExample: null, contentType: "application/json", source: "apps/api/src/gifts/gift-query.controller.ts; apps/api/src/gifts/gift-query.service.ts; apps/api/src/gifts/gift-query.test.ts; apps/api/src/gifts/gift-query-database.test.ts", note: "独立查询账号，查询会话不授予后台/会员权限；结果落库后返回；no-store；后台仅总管理员；实际部署另行验收。" });
const accountInput = { username: { type: "string", pattern: "^[A-Za-z0-9_-]{3,64}$" }, displayName: { type: "string", minLength: 1, maxLength: 80 }, active: boolean, password: { type: "string", description: "新账号必填；至少10字符、最多72个UTF8字节。编辑留空不变；不回传。" } };
export const giftQueryFieldContracts = {
  "GiftQueryController.login": record(object({ username: string, password: string }), object({ token: { type: "string", pattern: "^[A-Za-z0-9_-]{64}$" }, expiresAt: date, username: string, displayName: string })),
  "GiftQueryController.me": record(null, object({ username: string, displayName: string, expiresAt: date })),
  "GiftQueryController.logout": record(object({}), object({ loggedOut: { const: true } })),
  "GiftQueryController.query": record(object({ cardNos: { oneOf: [{ type: "string", maxLength: 10000 }, { type: "array", minItems: 1, maxItems: 1000, items: { type: "string", pattern: "^8[0-9]{7}$" } }], description: "按卡号匹配；去重后1至100张，不接受管理编号或数值数组。" } }), object({ items: array(card), cardCount: integer, redeemedCount: integer, missingCount: integer, queriedAt: date })),
  "GiftQueryAdminController.accounts": record(null, array(object({ ...account.properties, queryCount: integer, failedCount: integer, cardCount: integer, redeemedCount: integer, lastQueryAt: { type: ["string", "null"], format: "date-time" } }))),
  "GiftQueryAdminController.create": record(object(accountInput), account),
  "GiftQueryAdminController.update": record(object({ displayName: accountInput.displayName, active: boolean, version: integer, password: accountInput.password }, ["displayName", "active", "version"]), account),
  "GiftQueryAdminController.logs": record(null, object({ items: array(object({ id, accountId: id, username: string, outcome: { enum: ["SUCCESS", "INVALID_INPUT"] }, cardCount: integer, redeemedCount: integer, missingCount: integer, results: array(card), createdAt: date })), total: integer, page: { type: "integer", minimum: 1 } })),
};
giftQueryFieldContracts["GiftQueryAdminController.logs"].query = {
  accountId: { schema: id, example: "00000000-0000-4000-8000-000000000001", required: false },
  page: { schema: { type: "integer", minimum: 1, maximum: 100000 }, example: 1, required: false },
};
