// Reviewed against the gift controller/service; examples are synthetic.
const text = { type: "string" },
  id = { type: "string", format: "uuid" },
  flag = { type: "boolean" },
  zero = { const: 0 },
  list = (items) => ({ type: "array", items });
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const token = { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" },
  requestKey = { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$" },
  managementNumber = {
    type: "string",
    pattern: "^[1-9][0-9]*$",
    description: "数据库自动生成的兑换卡管理序号，如1、2、3",
  };
const source =
  "apps/api/src/gifts/gift.controller.ts; apps/api/src/gifts/gift.service.ts; apps/api/src/gifts/gift-policy.ts; apps/api/src/gifts/gift-database.test.ts";
const record = (requestSchema, responseSchema) => ({
  status: "request-reviewed",
  requestSchema,
  requestExample: null,
  responseSchema,
  responseExample: null,
  contentType: "application/json",
  source,
  note: "一款一件；商品及运费全免；后台写操作仅总管理员；真实短信和ERP须独立验收。",
});
const binding = {
  productId: id,
  allowedSkuIds: {
    type: "array",
    items: id,
    minItems: 1,
    maxItems: 200,
    uniqueItems: true,
  },
  expiresAt: { type: ["string", "null"], format: "date-time" },
};
const credentials = object(
  {
    cardNo: { type: "string", pattern: "^8[0-9]{7}$" },
    checkCode: { type: "string", pattern: "^[0-9]{6}$" },
  },
  ["cardNo", "checkCode"],
);
const memberOrder = object({ orderId: id, orderNo: text }, [
    "orderId",
    "orderNo",
  ]),
  request = { token, skuId: id, addressId: id };
const dispatchDays = {
  type: "integer",
  enum: [2, 7],
  description:
    "所选规格库存大于零预计2天发货，否则预计7天发货；仅ERP缺货允许预订兑换",
};
const giftProduct = object(
  {
    id,
    name: text,
    skus: list(
      object(
        {
          id,
          specification: { type: ["string", "null"] },
          stock: { type: "integer" },
          redeemable: flag,
          estimatedDispatchDays: dispatchDays,
        },
        ["id", "stock", "redeemable", "estimatedDispatchDays"],
      ),
    ),
  },
  ["id", "name", "skus"],
);
const pagination = object(
  {
    items: list(object({})),
    total: { type: "integer", minimum: 0 },
    page: { type: "integer", minimum: 1 },
  },
  ["items", "total", "page"],
);
export const giftFieldContracts = {
  "GiftController.capabilities": record(
    null,
    object({ enabled: flag }, ["enabled"]),
  ),
  "GiftController.validate": record(
    credentials,
    object(
      {
        token,
        expiresAt: text,
        card: object({
          serialNo: managementNumber,
          expiresAt: { type: ["string", "null"] },
        }),
        product: giftProduct,
        phoneVerified: flag,
        consentVersion: text,
      },
      ["token", "expiresAt", "card", "product", "consentVersion"],
    ),
  ),
  "GiftController.view": record(
    object({ token }, ["token"]),
    object(
      {
        card: object({}),
        product: giftProduct,
        phoneVerified: flag,
        consentVersion: text,
      },
      ["card", "product", "phoneVerified", "consentVersion"],
    ),
  ),
  "GiftController.sms": record(
    object(
      {
        token,
        mobile: { type: "string", pattern: "^(?:\\+86)?1[3-9][0-9]{9}$" },
      },
      ["token", "mobile"],
    ),
    object({ expiresIn: { const: 300 }, retryAfter: { const: 60 } }, [
      "expiresIn",
      "retryAfter",
    ]),
  ),
  "GiftController.verify": record(
    object(
      {
        token,
        mobile: text,
        code: { type: "string", pattern: "^[0-9]{6}$" },
        consentAccepted: { const: true },
        consentVersion: { type: "string", minLength: 1, maxLength: 80 },
      },
      ["token", "mobile", "code", "consentAccepted", "consentVersion"],
    ),
    object(
      {
        token: text,
        refreshToken: text,
        expiresAt: text,
        user: object({ id }),
      },
      ["token", "refreshToken", "expiresAt", "user"],
    ),
  ),
  "GiftController.preview": record(
    object(request, Object.keys(request)),
    object(
      {
        sku: object({ estimatedDispatchDays: dispatchDays }, [
          "estimatedDispatchDays",
        ]),
        address: object({}),
        quantity: { const: 1 },
        giftDiscountCents: { type: "integer", minimum: 0 },
        shippingCents: zero,
        payableCents: zero,
        fingerprint: text,
      },
      [
        "sku",
        "address",
        "quantity",
        "giftDiscountCents",
        "shippingCents",
        "payableCents",
        "fingerprint",
      ],
    ),
  ),
  "GiftController.submit": record(
    object(
      {
        ...request,
        fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
        requestKey,
      },
      [...Object.keys(request), "fingerprint", "requestKey"],
    ),
    memberOrder,
  ),
  "GiftController.result": record(
    object({ token }, ["token"]),
    object({ completed: flag, orderId: id, orderNo: text }, ["completed"]),
  ),
  "GiftAdminController.batches": record(null, pagination),
  "GiftAdminController.cards": record(null, pagination),
  "GiftAdminController.records": record(null, pagination),
  "GiftAdminController.products": record(
    null,
    list(
      object({
        id,
        name: text,
        skus: list(
          object({
            id,
            specification: { type: ["string", "null"] },
            stock: { type: "integer" },
          }),
        ),
      }),
    ),
  ),
  "GiftAdminController.settings": record(
    null,
    object({ enabled: flag }, ["enabled"]),
  ),
  "GiftAdminController.qr": record(
    null,
    object(
      { serialNo: managementNumber, cardNo: text, link: text, qrDataUrl: text },
      ["serialNo", "cardNo", "link", "qrDataUrl"],
    ),
  ),
  "GiftAdminController.generate": record(
    object(
      {
        ...binding,
        name: { type: "string", minLength: 1, maxLength: 80 },
        quantity: { type: "integer", minimum: 1, maximum: 100 },
        requestKey,
      },
      ["name", "quantity", "productId", "allowedSkuIds", "requestKey"],
    ),
    object(
      {
        batchId: id,
        batchNo: text,
        alreadyGenerated: flag,
        filename: { type: ["string", "null"] },
        csv: { type: ["string", "null"] },
      },
      ["batchId", "batchNo", "alreadyGenerated", "filename", "csv"],
    ),
  ),
  "GiftAdminController.change": record(
    object(
      {
        ...binding,
        action: { enum: ["ACTIVATE", "BIND", "VOID"] },
        ids: list(id),
        batchId: id,
        reason: { type: "string", minLength: 1, maxLength: 200 },
        version: { type: "integer", minimum: 0 },
        downloadConfirmed: flag,
      },
      ["action", "reason"],
    ),
    object({ changed: { type: "integer", minimum: 1 } }, ["changed"]),
  ),
  "GiftAdminController.configure": record(
    object({ enabled: flag }, ["enabled"]),
    object({ enabled: flag }, ["enabled"]),
  ),
};
