// Hand-reviewed H5 consumer fields. No production data or provider credentials.
// Monetary fields ending in Cents are integer CNY cents, including point credit.
const text = { type: "string" };
const bool = { type: "boolean" };
const int = { type: "integer" };
const count = { type: "integer", minimum: 0 };
const positive = { type: "integer", minimum: 1 };
const cents = { type: "integer", minimum: 0, maximum: 2147483647, description: "人民币整数分；不得传浮点元或以字符串冒充已核验金额。" };
const id = { type: "string", format: "uuid", description: "当前统一系统 UUID，不是旧商城数字ID。" };
const date = { type: "string", format: "date-time" };
const nullable = schema => ({ oneOf: [schema, { type: "null" }] });
const array = items => ({ type: "array", items });
const obj = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: true });
const mobile = { type: "string", pattern: "^1[3-9][0-9]{9}$" };
const otp = { type: "string", pattern: "^[0-9]{6}$", description: "一次性验证码；login 与 bind_mobile 用途隔离。" };
const hex = { type: "string", pattern: "^[a-f0-9]{64}$" };
const consent = { type: "string", minLength: 1, maxLength: 80, description: "客户端展示并获同意的商城协议版本；当前客户端 commerce-legal-v1。" };
const quantity = { type: "integer", minimum: 1, maximum: 999 };
const sid = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const at = "2026-09-08T01:00:00.000Z";
const source = {
  auth: "apps/api/src/commerce/commerce-compat.controller.ts; apps/api/src/auth/auth.service.ts; apps/api/src/auth/wechat-h5-auth.service.ts",
  store: "apps/api/src/commerce/commerce-compat.controller.ts; apps/api/src/commerce/commerce.service.ts; apps/api/src/commerce/commerce-store.service.ts; packages/commerce-domain/src/pricing.ts",
  payment: "apps/api/src/billing/billing.service.ts; apps/api/src/billing/payment-provider.service.ts; packages/contracts/src/index.ts",
  capability: "apps/api/src/commerce/commerce-capabilities.service.ts",
  employee: "apps/api/src/commerce/employee-promotion.service.ts; apps/api/src/commerce/employee-dashboard-query.ts; apps/api/src/commerce/commerce-withdrawal.service.ts",
  shipping: "apps/api/src/admin/admin.controller.ts; apps/api/src/admin/admin.service.ts; packages/commerce-domain/src/shipping.ts",
};
function record(requestSchema, requestExample, responseSchema, responseExample, sources, note) {
  return { status: "request-reviewed", requestSchema, requestExample, responseSchema, responseExample,
    contentType: "application/json", source: sources,
    note: "源码复核的字段/最小响应契约，允许返回未列出的向后兼容字段。所有编号、会话、签名及金额均为 H5-CONTRACT 合成示例，不是生产凭据或渠道成功回执。 " + note };
}
const sessionSchema = obj({
  token: { ...text, description: "用户访问令牌；Authorization: Bearer，不是员工令牌。禁止记录或发布实际值。" },
  refreshToken: { ...text, description: "单次轮换令牌；客户端单飞刷新，不并发重用。" }, expiresAt: date,
  user: obj({ id, nickname: text, mobile: nullable(text), avatarUrl: nullable(text) }),
});
const sessionExample = {
  token: "H5-CONTRACT-SYNTHETIC-NOT-A-VALID-TOKEN", refreshToken: "H5-CONTRACT-SYNTHETIC-NOT-A-VALID-REFRESH",
  expiresAt: "2026-09-08T03:00:00.000Z",
  user: { id: sid(1), nickname: "H5-CONTRACT合成会员", mobile: "19900000001", avatarUrl: null },
};
const authNote = "商城成功响应为 raw：直接读取 token/user，不套 data。与 App 共享 User.id；Employee 会话的 typ/aud 和权限独立。手机号显示形态可能为掩码，不据此判断账号身份。";
export const h5FieldContracts = {
  "CommerceCompatibilityController.loginPassword": record(
    obj({ mobile, password: { ...text, minLength: 1 }, referralCode: text }, ["mobile", "password"]),
    { mobile: "19900000001", password: "H5-CONTRACT-Test-Password-Only" }, sessionSchema, sessionExample, source.auth,
    authNote + "复用现有手机号密码核验；演示种子会员没有预设密码，错误凭据不会自动注册。"),
  "CommerceCompatibilityController.requestSms": record(
    obj({ mobile, usage: { enum: ["login", "bind_mobile"] } }, ["mobile"]),
    { mobile: "19900000001", usage: "login" },
    obj({ configured: { const: true }, expiresIn: positive, devCode: otp }, ["configured", "expiresIn"]),
    { configured: true, expiresIn: 300, devCode: "123456" }, source.auth,
    "devCode 仅非生产且 ALLOW_TEST_OTP=true 返回；此示例仅隔离演示。真实短信未配置返回503；不会假装发送。先请求再验证，5分钟过期。"),
  "CommerceCompatibilityController.loginSms": record(
    obj({ mobile, code: otp, consentVersion: consent, referralCode: text }, ["mobile", "code", "consentVersion"]),
    { mobile: "19900000001", code: "123456", consentVersion: "commerce-legal-v1", referralCode: "H5DEMO" },
    sessionSchema, sessionExample, source.auth, authNote + "核验 login 用途验证码后复用手机号账号；新手机号可以创建统一会员。"),
  "CommerceCompatibilityController.refresh": record(obj({ refreshToken: text }),
    { refreshToken: sessionExample.refreshToken }, sessionSchema, sessionExample, source.auth,
    authNote + "同一 refreshToken 并发只有一次可成功。过期保留带 checkout-owner 的草稿；同一用户重新登录可恢复，换用户清除旧草稿，禁止旧响应覆盖新会话。"),
};
const returnTo = { ...text, maxLength: 1024, description: "受限站内相对路径，如 /pages/checkout/index；拒绝外站、协议相对URL、hash及敏感令牌查询参数。不是任意OAuth redirect_uri。" };
const boundSession = obj({ ...sessionSchema.properties, requiresMobileBinding: { const: false }, returnTo });
const bindingPending = obj({ requiresMobileBinding: { const: true }, bindTicket: hex, expiresIn: positive, returnTo });
const oauthState = "a".repeat(64), bindTicket = "b".repeat(64);
const verifier = "H5-CONTRACT-verifier-00000000000000000000000000000001";
h5FieldContracts["CommerceCompatibilityController.authorizeWechatH5"] = record(
  obj({ returnTo, codeChallenge: { ...hex, description: "SHA-256(codeVerifier) 小写hex。codeVerifier随机43至128字符，仅保存在当前浏览器sessionStorage；不是由微信校验的PKCE扩展。" }, referralCode: text }, ["returnTo", "codeChallenge"]),
  { returnTo: "/pages/checkout/index", codeChallenge: "72ece7cd194df3719ae06574d0392e54b9d2166287f064d88c94d24b87673bb6", referralCode: "H5DEMO" },
  obj({ authorizeUrl: { ...text, format: "uri" }, state: hex, expiresIn: positive }),
  { authorizeUrl: "https://open.weixin.qq.com/connect/oauth2/authorize?appid=wxH5CONTRACT000001&redirect_uri=https%3A%2F%2Fstorefront.example.invalid%2Fsaidian-mall%2F&response_type=code&scope=snsapi_base&state=" + oauthState + "#wechat_redirect", state: oauthState, expiresIn: 300 },
  source.auth, "公众号未配置返回503；redirect_uri只用服务端已校验配置。state一次性、5分钟，不接受客户端传入appId/openId。示例授权地址不可用于实际授权。");
h5FieldContracts["CommerceCompatibilityController.loginWechatH5"] = record(
  obj({ code: { ...text, minLength: 1, maxLength: 1024 }, state: hex,
    codeVerifier: { ...text, pattern: "^[A-Za-z0-9._~-]{43,128}$" }, consentVersion: consent }),
  { code: "H5-CONTRACT-ONE-TIME-CODE", state: oauthState, codeVerifier: verifier, consentVersion: "commerce-legal-v1" },
  { oneOf: [bindingPending, boundSession] },
  { requiresMobileBinding: true, bindTicket, expiresIn: 300, returnTo: "/pages/checkout/index" },
  source.auth, "从回跳URL的search读取code/state，不从hash误读。未绑定手机号分支不含token/user，必须进入绑定；已有已核验手机号返回raw用户会话。state已消费或换码失败需重新授权。");
h5FieldContracts["CommerceCompatibilityController.bindWechatH5Mobile"] = record(
  obj({ bindTicket: hex, mobile, code: otp, consentVersion: consent }),
  { bindTicket, mobile: "19900000001", code: "123456", consentVersion: "commerce-legal-v1" },
  boundSession, { ...sessionExample, requiresMobileBinding: false, returnTo: "/pages/checkout/index" }, source.auth,
  "先以usage=bind_mobile请求独立验证码。bindTicket一次性且5分钟。appId+openId作用域身份与已核验手机号绑定；冲突409，不自动合并两个账号，不借用小程序openId。");

const availability = obj({ enabled: bool, reason: text }, ["enabled"]);
const paymentChannels = ["wechat_jsapi", "wechat_mini", "wechat_h5", "wechat_native", "alipay_wap", "alipay_page"];
const capabilitiesSchema = obj({
  login: obj({ password: availability, sms: availability, wechatH5: availability }),
  payments: array(obj({ channel: { enum: paymentChannels }, enabled: bool, reason: text, environments: array({ enum: ["wechat", "mini", "browser"] }) }, ["channel", "enabled", "environments"])),
  checkout: obj({ minimumCashCents: { const: 1 }, points: obj({ supported: { const: true }, requiresVerifiedAccount: { const: true } }) }),
  maintenance: obj({ readOnly: bool, reason: text }, ["readOnly"]), demo: bool,
});
const capabilitiesExample = {
  login: { password: { enabled: true }, sms: { enabled: true }, wechatH5: { enabled: false, reason: "微信公众号登录尚未配置" } },
  payments: paymentChannels.map(channel => ({ channel, enabled: false, reason: "支付渠道尚未配置", environments: [channel === "wechat_jsapi" ? "wechat" : channel === "wechat_mini" ? "mini" : "browser"] })),
  checkout: { minimumCashCents: 1, points: { supported: true, requiresVerifiedAccount: true } },
  maintenance: { readOnly: false }, demo: true,
};
h5FieldContracts["CommerceCompatibilityController.storefrontCapabilities"] = record(null, null, capabilitiesSchema, capabilitiesExample,
  source.capability, "公开只含能力布尔值/原因，不含密钥、appId或商户身份。enabled只代表本地配置通过校验，不代表真实供应商联调成功。wechat_mini仅mini环境，使用独立小程序支付appId；公众号OAuth未配置不连带禁用已配置的小程序。微信商户密钥/通知地址未配置或维护暂停仍禁用所有微信支付。demo仅非production+H5_DEMO_ENABLED；示例是隔离演示状态，不是生产承诺。");
const skuSchema = obj({ id, specification: nullable(text), image: nullable(text), salePriceCents: cents, marketPriceCents: nullable(cents), stock: count, enabled: bool }, ["id", "salePriceCents", "stock"]);
const cardSchema = obj({ id, categoryId: nullable(id), name: text, subtitle: nullable(text), coverImage: nullable(text), tags: array(text),
  sales: count, priceCents: cents, marketPriceCents: nullable(cents), stock: count, defaultSku: nullable(skuSchema) });
const imageUrl = "https://www.saidian.cc/d/file/p/2026/06-04/58b4b79f8dc6dc47b94b41280b7ecc4c.png";
const cardExample = { id: sid(2), categoryId: sid(5), name: "H5-CONTRACT合成商品", subtitle: "演示价格和库存", coverImage: imageUrl,
  tags: ["合成演示"], sales: 0, priceCents: 19900, marketPriceCents: null, stock: 20,
  defaultSku: { id: sid(3), specification: "合成规格", image: imageUrl, salePriceCents: 19900, marketPriceCents: null, stock: 20, enabled: true } };
const businessConfig = obj({ key: text, label: text, enabled: bool, value: nullable({ type: "object", additionalProperties: true, description: "按配置key定义的公开内容；例如store.notice的text，不是供应商集成参数。" }) });
const bootstrapSchema = obj({
  banners: array(obj({ id, title: text, imageUrl: text, targetUrl: nullable(text), enabled: bool, sort: int })),
  categories: array(obj({ id, name: text, parentId: nullable(id), sort: int, enabled: bool })),
  featured: array(cardSchema),
  configs: { type: "object", additionalProperties: businessConfig, description: "仅store.name/store.notice/customer.service/policies公开配置键。" },
  referral: nullable(obj({ name: text, referralCode: text })), capabilities: capabilitiesSchema,
});
h5FieldContracts["CommerceCompatibilityController.bootstrap"] = record(null, null, bootstrapSchema, {
  banners: [{ id: sid(6), title: "H5-CONTRACT演示", imageUrl, targetUrl: "/pages/product/index?id=" + sid(2), enabled: true, sort: 100 }],
  categories: [{ id: sid(5), name: "H5-CONTRACT演示分类", parentId: null, sort: 100, enabled: true }],
  featured: [cardExample], configs: { "store.notice": { key: "store.notice", label: "合成演示公告", enabled: true, value: { text: "合成演示，不发短信、不支付、不打款" } } },
  referral: { name: "H5-CONTRACT演示员工", referralCode: "H5DEMO" }, capabilities: capabilitiesExample,
}, source.store + "; " + source.capability, "首页、分类、商品、公告由统一后台驱动。未命中员工推荐号referral=null，不猜员工归属。商品使用公开DTO，不应返回成本价、ERP内部字段。");
h5FieldContracts["CommerceCompatibilityController.bootstrap"].query = { ref: { schema: text, example: "H5DEMO", required: false } };

const addressSchema = obj({ id, userId: id, name: text, mobile, province: text, city: text, district: text, detail: text, isDefault: bool });
const addressExample = { id: sid(4), userId: sid(1), name: "H5-CONTRACT测试收件人", mobile: "19900000001",
  province: "测试省", city: "测试市", district: "测试区", detail: "仅限本地合成演示地址1号", isDefault: true };
const orderInput = obj({ addressId: id, items: { ...array(obj({ skuId: id, quantity })), minItems: 1 }, couponClaimId: id,
  pointCents: cents, buyerRemark: { ...text, description: "买家备注，不作为支付价格或员工身份来源。" }, idempotencyKey: { ...text, minLength: 8 } }, ["addressId", "items"]);
const orderRequest = { addressId: sid(4), items: [{ skuId: sid(3), quantity: 3 }], pointCents: 901, buyerRemark: "H5-CONTRACT合成订单" };
const pricedLine = obj({ skuId: id, quantity, unitPriceCents: cents, totalCents: cents,
  couponDiscountCentsSnapshot: cents, pointDiscountCentsSnapshot: cents, cashPaidCentsSnapshot: cents,
  name: text, image: nullable(text), specification: nullable(text) });
const quoteSchema = obj({ pricingVersion: { const: 1 }, subtotalCents: cents, couponDiscountCents: cents,
  pointDiscountCents: cents, shippingCents: cents, payableCents: { ...cents, minimum: 1 },
  availablePointCents: nullable(cents), maxPointCents: cents, lines: array(pricedLine) });
const quoteExample = { pricingVersion: 1, subtotalCents: 59700, couponDiscountCents: 0, pointDiscountCents: 901,
  shippingCents: 599, payableCents: 59398, availablePointCents: 5000, maxPointCents: 5000,
  lines: [{ skuId: sid(3), quantity: 3, unitPriceCents: 19900, totalCents: 59700, couponDiscountCentsSnapshot: 0,
    pointDiscountCentsSnapshot: 901, cashPaidCentsSnapshot: 58799, name: "H5-CONTRACT合成商品", image: imageUrl, specification: "合成规格" }] };
const previewSchema = obj({ address: nullable(addressSchema),
  products: array(obj({ id, product_id: id, sku_id: id, name: text, image: nullable(text), specification: nullable(text),
    price: { type: "number", description: "旧兼容展示价格，元；新H5结算使用quote整数分。" }, num: quantity })),
  preview: obj({ product_money: { type: "number" }, shipping_money: { type: "number" }, payable_money: { type: "number" } }),
  quote: quoteSchema });
const previewExample = { address: addressExample, products: [{ id: sid(2), product_id: sid(2), sku_id: sid(3),
  name: "H5-CONTRACT合成商品", image: imageUrl, specification: "合成规格", price: 199, num: 3 }],
  preview: { product_money: 597, shipping_money: 5.99, payable_money: 593.98 }, quote: quoteExample };
h5FieldContracts["CommerceCompatibilityController.previewOrder"] = record(orderInput, orderRequest, previewSchema, previewExample,
  source.store, "只报价不扣库存/积分。599分运费是合成配置，不是实际默认运费。availablePointCents=null表示账户未核验，此时maxPointCents=0只表示不可抵扣，不代表余额为0。先券后积分，按最大余数分摊；积分不抵运费，现金至少1分。提交时重新核价。");
const orderStatuses = ["PENDING_PAYMENT", "PAID", "WAITING_FULFILLMENT", "SHIPPED", "RECEIVED", "COMPLETED", "CANCELLED", "CLOSED", "AFTER_SALE", "REFUNDED"];
const itemSchema = obj({ id, orderId: id, productId: id, skuId: id, nameSnapshot: text, specificationSnapshot: nullable(text),
  imageSnapshot: nullable(text), unitPriceCents: cents, quantity, totalCents: cents,
  couponDiscountCentsSnapshot: nullable(cents), pointDiscountCentsSnapshot: nullable(cents), cashPaidCentsSnapshot: nullable(cents) });
const itemExample = { id: sid(8), orderId: sid(7), productId: sid(2), skuId: sid(3), nameSnapshot: "H5-CONTRACT合成商品",
  specificationSnapshot: "合成规格", imageSnapshot: imageUrl, unitPriceCents: 19900, quantity: 3, totalCents: 59700,
  couponDiscountCentsSnapshot: 0, pointDiscountCentsSnapshot: 901, cashPaidCentsSnapshot: 58799 };
const orderSchema = obj({ id, orderNo: text, userId: id, status: { enum: orderStatuses }, sourceSystem: text,
  executionOwner: text, version: count, pricingVersion: nullable(count), pricingVerifiedAt: nullable(date),
  subtotalCents: cents, discountCents: cents, pointDiscountCents: cents, shippingCents: cents, payableCents: cents, currency: { const: "CNY" },
  recipientName: text, recipientMobile: text, province: text, city: text, district: text, addressDetail: text,
  buyerRemark: nullable(text), paidAt: nullable(date), createdAt: date, items: array(itemSchema) });
const orderExample = { id: sid(7), orderNo: "H5-CONTRACT-ORDER-0001", userId: sid(1), status: "PENDING_PAYMENT",
  sourceSystem: "canonical", executionOwner: "NEW_SYSTEM", version: 0, pricingVersion: 1, pricingVerifiedAt: at,
  subtotalCents: 59700, discountCents: 0, pointDiscountCents: 901, shippingCents: 599, payableCents: 59398, currency: "CNY",
  recipientName: addressExample.name, recipientMobile: addressExample.mobile, province: "测试省", city: "测试市",
  district: "测试区", addressDetail: addressExample.detail, buyerRemark: "H5-CONTRACT合成订单", paidAt: null, createdAt: at, items: [itemExample] };
h5FieldContracts["CommerceCompatibilityController.createOrder"] = record(orderInput,
  { ...orderRequest, idempotencyKey: "H5-CONTRACT-order-request-0001" }, orderSchema, orderExample, source.store,
  "仅创建待付款单，不代表支付成功。Idempotency-Key请求头优先于body.idempotencyKey；至少8字符且必须随同一请求保留。同键同参返回原单，同键改地址/商品/券/积分/备注409。扣库存和积分、占用券与订单快照同事务；所有价格由服务端算。");
const eligible = obj({ orderItemId: id, quantityRemaining: count, cashRemainingCents: cents, pointRemainingCents: cents,
  unavailableReason: text }, ["orderItemId", "quantityRemaining", "cashRemainingCents", "pointRemainingCents"]);
const detailSchema = obj({ ...orderSchema.properties, readOnly: bool, source: text, allowedActions: array({ enum: ["PAY", "CANCEL", "CONFIRM_RECEIPT", "APPLY_AFTER_SALE"] }),
  afterSaleEligibleItems: array(eligible), unavailableReason: text }, [...orderSchema.required, "readOnly", "source", "allowedActions", "afterSaleEligibleItems"]);
const detailExample = { ...orderExample, status: "PAID", version: 1, paidAt: at, readOnly: false, source: "canonical",
  allowedActions: ["APPLY_AFTER_SALE"], afterSaleEligibleItems: [{ orderItemId: sid(8), quantityRemaining: 3, cashRemainingCents: 58799, pointRemainingCents: 901 }] };
const legacyDetail = obj({ id, orderNo: text, status: text, payableCents: nullable(cents), currency: text, createdAt: date, readOnly: { const: true }, source: { const: "legacy" } });
h5FieldContracts["CommerceCompatibilityController.order"] = record(null, null, { oneOf: [detailSchema, legacyDetail] }, detailExample, source.store,
  "仅订单本人可读。新单用allowedActions驱动操作，不由客户端自行猜状态；历史只读投影不保证items/分摊/操作字段。快照null为未核验，应阻断金额推算，不能转0。存在处理中支付时不允许取消；付款结果以payment接口和服务端核验为准。");

const saleTypes = { enum: ["REFUND_ONLY", "RETURN_REFUND", "EXCHANGE"] };
const saleInput = obj({ type: saleTypes, items: { ...array(obj({ orderItemId: id, quantity })), minItems: 1 },
  orderVersion: count, reason: text, description: text, evidenceImages: array(text) }, ["type", "items"]);
const saleRequest = { type: "REFUND_ONLY", items: [{ orderItemId: sid(8), quantity: 1 }] };
const refundLine = obj({ orderItemId: id, quantity, amountCents: cents, pointReturnCents: cents });
const saleQuote = obj({ orderId: id, orderVersion: count, type: saleTypes, pricingVersion: count,
  requestedCents: cents, merchandiseRefundCents: cents, shippingRefundCents: cents, pointReturnCents: cents, items: array(refundLine) });
const saleQuoteExample = { orderId: sid(7), orderVersion: 1, type: "REFUND_ONLY", pricingVersion: 1,
  requestedCents: 19599, merchandiseRefundCents: 19599, shippingRefundCents: 0, pointReturnCents: 300,
  items: [{ orderItemId: sid(8), quantity: 1, amountCents: 19599, pointReturnCents: 300 }] };
const saleStatuses = ["APPLIED", "REVIEWING", "APPROVED", "REJECTED", "WAITING_RETURN", "RETURNED", "REFUNDING", "COMPLETED", "CANCELLED"];
const saleSchema = obj({ id, afterSaleNo: text, orderId: id, type: { enum: [...saleTypes.enum, "SHIPPING_ONLY"] },
  status: { enum: saleStatuses }, version: count, pricingVersion: nullable(count), requestedCents: cents,
  pointReturnCents: nullable(cents), shippingRefundCents: nullable(cents), reason: text,
  settledAt: nullable(date), createdAt: date, items: array(refundLine), returnLogisticsCompany: nullable(text), returnTrackingNo: nullable(text) },
  ["id", "afterSaleNo", "orderId", "type", "status", "version", "pricingVersion", "requestedCents", "pointReturnCents", "shippingRefundCents", "reason", "settledAt", "createdAt"]);
const saleExample = { id: sid(9), afterSaleNo: "H5-CONTRACT-AS-0001", orderId: sid(7), type: "REFUND_ONLY",
  status: "APPLIED", version: 0, pricingVersion: 1, requestedCents: 19599, pointReturnCents: 300,
  shippingRefundCents: 0, reason: "H5-CONTRACT合成测试申请", settledAt: null, createdAt: at, items: saleQuoteExample.items };
h5FieldContracts["CommerceCompatibilityController.previewAfterSale"] = record(saleInput, saleRequest, saleQuote, saleQuoteExample,
  source.store, "只报价不退款。当前一次申请的现金=requestedCents=merchandiseRefundCents+shippingRefundCents；积分单列。按累计数量取差消除分次尾差：本例先退1件19599现金+300积分，后2件39200现金+601积分。同一商品有在途售后409。首次整单退款可含原运费，分次退完商品不会自动补退运费。");
h5FieldContracts["CommerceCompatibilityController.afterSale"] = record(saleInput,
  { ...saleRequest, orderVersion: 1, reason: saleExample.reason, evidenceImages: [] }, saleSchema, saleExample, source.store,
  "必须先刷新报价并传orderVersion；服务端再次核价。APPLIED只代表申请，不代表退款/积分已到账。纯积分商品可requestedCents=0但须经审核和必要退货，不能调用金额0的渠道退款。现金退款未知时保持占用，不返积分不重发。SHIPPING_ONLY禁止客户申请。");
h5FieldContracts["CommerceCompatibilityController.returnLogistics"] = record(
  obj({ logisticsCompany: { ...text, minLength: 1, maxLength: 80 }, trackingNo: { ...text, minLength: 1, maxLength: 100 }, version: count }),
  { logisticsCompany: "H5-CONTRACT合成物流", trackingNo: "H5-CONTRACT-NOT-A-REAL-TRACKING-0001", version: 2 },
  saleSchema, { ...saleExample, type: "RETURN_REFUND", status: "WAITING_RETURN", version: 3,
    returnLogisticsCompany: "H5-CONTRACT合成物流", returnTrackingNo: "H5-CONTRACT-NOT-A-REAL-TRACKING-0001" }, source.store,
  "POST storefront/orders/:id/after-sales/:saleId/return-logistics，成功HTTP200。仅本人且订单/售后均NEW_SYSTEM接管、售后WAITING_RETURN且RETURN_REFUND/EXCHANGE可登记；version变化但同旧内容重试幂等。请求logisticsCompany/trackingNo映射返回returnLogisticsCompany/returnTrackingNo；拒绝控制字符。登记仍WAITING_RETURN，不自动变RETURNED，不确认商家收货、不自动退款。运单为合成格式，不能用于真实物流查询。");
h5FieldContracts["CommerceCompatibilityController.points"] = record(null, null,
  obj({ balanceCents: nullable(cents), verified: bool, reason: nullable(text),
    items: array(obj({ id, deltaCents: int, type: text, orderId: nullable(id), createdAt: date })),
    pagination: obj({ page: positive, pageSize: positive, total: count, hasMore: bool }) }),
  { balanceCents: null, verified: false, reason: "积分账户尚未核验", items: [], pagination: { page: 1, pageSize: 20, total: 0, hasMore: false } },
  source.store, "本人积分账户及账本。balanceCents=null为未核验，不是0；deltaCents可为负数扣减或正数返还。账本固定每页20条，type为事实流水类型不是前端余额算式。");
h5FieldContracts["CommerceCompatibilityController.points"].query = { page: { schema: { type: "integer", minimum: 1, maximum: 100000 }, example: 1, required: false } };

const invokeSchema = nullable({ oneOf: [
  obj({ type: { const: "REDIRECT" }, url: text }),
  obj({ type: { const: "QR" }, codeUrl: text, qrDataUrl: text }),
  obj({ type: { const: "JSAPI" }, appId: text, timeStamp: text, nonceStr: text, package: text, signType: { const: "RSA" }, paySign: text }),
  obj({ type: { const: "FORM" }, url: text, method: { const: "POST" }, fields: { type: "object", additionalProperties: text } }),
  obj({ type: { const: "APP" }, appid: text, partnerid: text, prepayid: text, package: text, noncestr: text, timestamp: text, sign: text }, ["type"]),
] });
const paymentSchema = obj({ id, paymentNo: text, businessType: { enum: ["commerce_order", "health_report", "health_membership"] },
  businessId: id, channel: text, status: { enum: ["created", "pending", "succeeded", "failed", "closed", "refunding", "partial_refunded", "refunded"] },
  amountCents: { ...cents, minimum: 1 }, currency: { const: "CNY" }, invoke: invokeSchema, createdAt: date });
const paymentExample = { id: sid(10), paymentNo: "H5-CONTRACT-PAYMENT-0001", businessType: "commerce_order", businessId: sid(7),
  channel: "wechat_h5", status: "pending", amountCents: 59398, currency: "CNY",
  invoke: { type: "REDIRECT", url: "https://wx.tenpay.com/cgi-bin/mmpayweb-bin/checkmweb?prepay_id=H5-CONTRACT-NOT-A-REAL-PREPAY" }, createdAt: at };
h5FieldContracts["CommerceCompatibilityController.createPayment"] = record(
  obj({ orderId: id, channel: { enum: paymentChannels }, idempotencyKey: { ...text, minLength: 8, maxLength: 160 } }, ["orderId", "channel"]),
  { orderId: sid(7), channel: "wechat_h5", idempotencyKey: "H5-CONTRACT-payment-request-0001" },
  paymentSchema, paymentExample, source.payment,
  "示例仅结构，合成prepay地址不可支付。真实渠道未配置返回503且不得创建可误用付款参数；金额只取订单，禁止客户端传金额。JSAPI须微信容器和当前公众号appId的已核验绑定身份。QR用qrDataUrl显示，weixin://不是图片。FORM/REDIRECT只允许受信HTTPS微信/支付宝网关；回跳仅打开订单详情不代表成功。");
h5FieldContracts["CommerceCompatibilityController.payment"] = record(null, null, paymentSchema,
  { ...paymentExample, status: "succeeded", invoke: null }, source.payment,
  "这是合成已成功状态形状，不代表演示环境真实付款成功。只能读取自己的支付；status小写，与订单status大写不同。pending可有调用参数，其他状态invoke=null。轮询本接口不会替代供应商查单，不由返回URL、JSAPI回调或前端按钮宣告支付成功。");

const walletSchema = obj({ employeeId: id, frozenCents: cents, availableCents: cents, withdrawingCents: cents, totalPaidCents: cents, debtCents: cents, updatedAt: date });
const promotionSchema = obj({ referralCode: text, linkUrl: text, qrDataUrl: text, posterDataUrl: text, qrType: { const: "H5" } });
const withdrawalSummary = obj({ canApply: bool, identity: obj({ verified: bool, accountHint: nullable(text) }), pendingCount: count,
  availableAmountCents: nullable(cents), dailyUsedCents: cents, dailyRemainingCents: nullable(cents), payoutMode: { const: "MANUAL_RECEIPT_ONLY" } });
const dashboardSchema = obj({
  employee: obj({ id, name: text, avatarUrl: nullable(text), referralCode: text, departmentNames: array(text) }),
  range: obj({ key: { enum: ["today", "7d", "30d", "month", "custom"] }, start: date, end: date, endExclusive: { const: true }, timezone: { const: "Asia/Shanghai" } }),
  paidOrders: count, salesCents: cents, refundCents: cents, netSalesCents: int,
  metricBasis: obj({ sales: { const: "paidAt" }, refunds: { const: "completedAt" }, orders: { const: "createdAt" } }),
  trend: { type: "null" }, trendStatus: { const: "UNAVAILABLE" }, trendReason: text,
  orders: array(obj({ id, orderNo: text, status: { enum: orderStatuses }, payableCents: cents, paidAt: nullable(date), createdAt: date, user: obj({ nickname: text }) })),
  pagination: obj({ page: positive, pageSize: positive, total: count, hasMore: bool }),
  promotion: nullable(promotionSchema), promotionStatus: { enum: ["AVAILABLE", "UNCONFIGURED"] },
  bonus: obj({
    plan: nullable(obj({ enabled: bool, rateBps: count, settlementDays: count, withdrawalEnabled: bool,
      minimumWithdrawCents: nullable(cents), dailyWithdrawLimitCents: nullable(cents), reviewRequired: { const: true } })),
    wallet: nullable(walletSchema), walletStatus: { enum: ["AVAILABLE", "UNAVAILABLE"] },
    recentAccruals: array(obj({ id, employeeId: id, orderId: id, status: text, grossBonusCents: cents, reversedBonusCents: cents, createdAt: date })),
    recentWithdrawals: array(obj({ id, amountCents: cents, status: text, version: count })),
    withdrawal: withdrawalSummary,
  }),
});
h5FieldContracts["CommerceEmployeeController.dashboard"] = record(null, null, dashboardSchema, {
  employee: { id: sid(11), name: "H5-CONTRACT演示员工", avatarUrl: null, referralCode: "H5DEMO", departmentNames: ["合成演示"] },
  range: { key: "custom", start: "2026-09-07T16:00:00.000Z", end: "2026-09-08T16:00:00.000Z", endExclusive: true, timezone: "Asia/Shanghai" },
  paidOrders: 1, salesCents: 59398, refundCents: 19599, netSalesCents: 39799,
  metricBasis: { sales: "paidAt", refunds: "completedAt", orders: "createdAt" },
  trend: null, trendStatus: "UNAVAILABLE", trendReason: "当前接口尚未提供逐日汇总，不以空数组或随机趋势代替",
  orders: [{ id: sid(7), orderNo: orderExample.orderNo, status: "AFTER_SALE", payableCents: 59398, paidAt: at, createdAt: at, user: { nickname: "H5-CONTRACT合成会员" } }],
  pagination: { page: 1, pageSize: 20, total: 1, hasMore: false }, promotion: null, promotionStatus: "UNCONFIGURED",
  bonus: { plan: null, wallet: null, walletStatus: "UNAVAILABLE", recentAccruals: [], recentWithdrawals: [],
    withdrawal: { canApply: false, identity: { verified: false, accountHint: null }, pendingCount: 0,
      availableAmountCents: null, dailyUsedCents: 0, dailyRemainingCents: null, payoutMode: "MANUAL_RECEIPT_ONLY" } },
}, source.employee, "只接受Employee令牌，不能以会员token越权。销售按paidAt、退款按completedAt、订单列表按createdAt分别过滤，所以列表不是销售额汇总依据；净销售可负。date-only按北京时间且to含当天，ISO时间必须含时区，上限366天，end为排他。trend与未获取钱包保留null；dailyRemainingCents=null表示未设日限，不等于0。只登记真实人工回执，不自动打款。");
h5FieldContracts["CommerceEmployeeController.dashboard"].query = {
  range: { schema: { enum: ["today", "7d", "30d", "month", "custom"] }, example: "custom", required: false },
  from: { schema: text, example: "2026-09-08", required: false }, to: { schema: text, example: "2026-09-08", required: false },
  page: { schema: { type: "integer", minimum: 1, maximum: 1000000 }, example: 1, required: false },
  pageSize: { schema: { type: "integer", minimum: 1, maximum: 100 }, example: 20, required: false },
};
const shippingSchema = obj({ orderId: id, orderVersion: count, pricingVersion: count, shippingReservedCents: cents, cashReservedCents: cents,
  shippingRemainingCents: cents, cashRemainingCents: cents, maximumCents: cents });
const shippingExample = { orderId: sid(7), orderVersion: 6, pricingVersion: 1, shippingReservedCents: 0, cashReservedCents: 58799,
  shippingRemainingCents: 599, cashRemainingCents: 599, maximumCents: 599 };
h5FieldContracts["AdminController.shippingRefundPreview"] = record(null, null, shippingSchema, shippingExample, source.shipping,
  "管理端v2包裹data，仅FINANCE/SUPER_ADMIN。此例商品分两次已退，运费单独剩599分。只有已核验已支付且NEW_SYSTEM接管的单一原支付可算；未知历史退款/分摊阻断409。存在未完成SHIPPING_ONLY申请时409占用，不伪返回可申请0。");
h5FieldContracts["AdminController.createShippingRefund"] = record(
  obj({ amountCents: { ...cents, minimum: 1 }, reason: { ...text, minLength: 2, maxLength: 256 },
    requestKey: { ...text, minLength: 8, maxLength: 120 }, orderVersion: count }),
  { amountCents: 599, reason: "H5-CONTRACT分次商品退款后申请退运费", requestKey: "H5-CONTRACT-shipping-request-0001", orderVersion: 6 },
  saleSchema, { ...saleExample, id: sid(12), afterSaleNo: "H5-CONTRACT-AS-SHIPPING-0001", type: "SHIPPING_ONLY",
    requestedCents: 599, shippingRefundCents: 599, pointReturnCents: 0, reason: "H5-CONTRACT分次商品退款后申请退运费", items: undefined },
  source.shipping, "管理端v2包裹data，仅财务/超级管理员；新建APPLIED且无商品行（响应可不带items）。同键同参同申请人返回原申请，不同参数409。后续须有权限管理员审核再执行原渠道退款，记录申请人与审核人。待审/处理中/成功均占额度；成功不退积分、不冲商品佣金。");
// JSON transport omits undefined. Keep the authored sample already JSON-safe.
delete h5FieldContracts["AdminController.createShippingRefund"].responseExample.items;

const fulfillmentLine = obj({ orderItemId: id, name: text, specification: text, quantity: positive, shippedQuantity: count, refundedQuantity: count, afterSaleReservedQuantity: count, remainingQuantity: count });
const fulfillmentSchema = obj({ orderId: id, version: count, status: text, items: array(fulfillmentLine), shipments: array({ type: "object" }), unavailableReason: text }, ["orderId", "version", "status", "items", "shipments"]);
const fulfillmentExample = { orderId: sid(7), version: 3, status: "WAITING_FULFILLMENT", items: [{ orderItemId: sid(8), name: "SYSTEM-QA合成商品", specification: "测试规格1", quantity: 3, shippedQuantity: 1, refundedQuantity: 0, afterSaleReservedQuantity: 0, remainingQuantity: 2 }], shipments: [{ id: sid(15), logisticsCompany: "SYSTEM-QA模拟承运", trackingNo: "SYSTEM-QA-PARCEL-1", shippedAt: at, deliveredAt: null, items: [{ orderItemId: sid(8), quantity: 1 }] }] };
const fulfillmentSource = "apps/api/src/admin/local-fulfillment.ts; packages/commerce-domain/src/fulfillment.ts; apps/api/src/admin/local-fulfillment.test.ts; tools/system-qa-http.mjs";
h5FieldContracts["AdminController.commerceFulfillmentPreview"] = record(null, null, fulfillmentSchema, fulfillmentExample, fulfillmentSource,
  "仅SUPER_ADMIN/COMMERCE_OPERATIONS。响应data包裹；sourceSystem=canonical、executionOwner=NEW_SYSTEM、全部LOCAL且无ERP归属。未核验历史包裹或部分发货后完成售后归属不明返回unavailableReason与空items，禁止自动猜测可发量。");
h5FieldContracts["AdminController.createCommerceShipment"] = record(
  obj({ version: count, logisticsCompany: { type: "string", minLength: 1, maxLength: 60 }, trackingNo: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]{2,99}$" }, items: { type: "array", minItems: 1, maxItems: 100, items: obj({ orderItemId: id, quantity: positive }) } }),
  { version: 2, logisticsCompany: "SYSTEM-QA模拟承运", trackingNo: "SYSTEM-QA-PARCEL-1", items: [{ orderItemId: sid(8), quantity: 1 }] },
  obj({ ...fulfillmentSchema.properties, shipmentId: id, replayed: bool }, [...fulfillmentSchema.required, "shipmentId", "replayed"]),
  { ...fulfillmentExample, shipmentId: sid(15), replayed: false }, fulfillmentSource,
  "示例是合成登记，不代表实际交运。订单锁+版本校验；相同订单运单号同公司同商品数量幂等replayed=true，异参/超量/过期版本409。处理中售后占数量。部分发货WAITING_FULFILLMENT、全量SHIPPED、有未结售后AFTER_SALE；不生成轨迹或签收时间。");

// Named fixtures support pure tests and let delivery docs reuse the exact values.
export const h5ContractExamples = { session: sessionExample, capabilities: capabilitiesExample, quote: quoteExample,
  order: orderExample, afterSale: saleQuoteExample, shipping: shippingExample };
