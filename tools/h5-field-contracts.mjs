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
const consent = { type: "string", minLength: 1, maxLength: 80, description: "客户端展示并获同意的协议版本。国内保留 commerce-legal-v1；国际版必须读取能力接口当前已审核发布版本，不能写死。" };
const globalLocale = { enum: ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"] };
const globalIdentifier = { type: "string", description: "国际账号邮箱或带+国家码的E.164手机号；不会自动合并账号。" };
const globalPassword = { type: "string", minLength: 8, description: "至少8字符、最多72 UTF-8字节；已有账号输入原密码，新账号用于设置密码。" };
const quantity = { type: "integer", minimum: 1, maximum: 999 };
const sid = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const at = "2026-09-08T01:00:00.000Z";
const source = {
  auth: "apps/api/src/commerce/commerce-compat.controller.ts; apps/api/src/auth/auth.service.ts; apps/api/src/auth/wechat-h5-auth.service.ts; apps/api/src/auth/global-wechat-binding.service.ts; apps/api/src/auth/global-wechat-policy.ts; apps/api/src/auth/global-legal.ts",
  store: "apps/api/src/commerce/commerce-compat.controller.ts; apps/api/src/commerce/commerce.service.ts; apps/api/src/commerce/commerce-store.service.ts; apps/api/src/commerce/commerce-quote.ts; packages/commerce-domain/src/pricing.ts",
  payment: "apps/api/src/billing/billing.service.ts; apps/api/src/billing/payment-provider.service.ts; packages/contracts/src/index.ts",
  capability: "apps/api/src/commerce/commerce-capabilities.service.ts",
  employee: "apps/api/src/commerce/employee-promotion.service.ts; apps/api/src/commerce/employee-dashboard-query.ts; apps/api/src/commerce/commerce-withdrawal.service.ts",
  shipping: "apps/api/src/admin/admin.controller.ts; apps/api/src/admin/admin.service.ts; packages/commerce-domain/src/shipping.ts",
  evidence: "apps/api/src/commerce/commerce-evidence.controller.ts; apps/api/src/commerce/commerce-evidence.ts; apps/api/src/support/support.service.ts; apps/api/src/common/user-auth.guard.ts; apps/api/src/admin/admin-auth.ts",
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
    { anyOf: [obj({ mobile: { anyOf: [mobile, globalIdentifier] }, password: { ...text, minLength: 1 }, referralCode: text }, ["mobile", "password"]), obj({ identifier: globalIdentifier, password: globalPassword }, ["identifier", "password"])] },
    { mobile: "19900000001", password: "H5-CONTRACT-Test-Password-Only" }, sessionSchema, sessionExample, source.auth,
    authNote + "国内传mobile；国际版支持mobile或identifier字段中的邮箱/E.164手机号，须有真实联系方式验证记录。错误凭据不会自动注册。"),
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
const boundSession = obj({ ...sessionSchema.properties, requiresMobileBinding: { const: false }, requiresAccountBinding: { const: false }, returnTo }, [...Object.keys(sessionSchema.properties), "requiresMobileBinding", "returnTo"]);
const bindingPending = obj({ requiresMobileBinding: { const: true }, requiresAccountBinding: { const: true }, bindTicket: hex, expiresIn: positive, returnTo }, ["requiresMobileBinding", "bindTicket", "expiresIn", "returnTo"]);
const oauthState = "a".repeat(64), bindTicket = "b".repeat(64);
const verifier = "H5-CONTRACT-verifier-00000000000000000000000000000001";
h5FieldContracts["CommerceCompatibilityController.authorizeWechatH5"] = record(
  obj({ returnTo, codeChallenge: { ...hex, description: "SHA-256(codeVerifier) 小写hex。codeVerifier随机43至128字符，仅保存在当前浏览器sessionStorage；不是由微信校验的PKCE扩展。" }, referralCode: text, consentVersion: consent, locale: globalLocale }, ["returnTo", "codeChallenge"]),
  { returnTo: "/pages/checkout/index", codeChallenge: "72ece7cd194df3719ae06574d0392e54b9d2166287f064d88c94d24b87673bb6", referralCode: "H5DEMO" },
  obj({ authorizeUrl: { ...text, format: "uri" }, state: hex, expiresIn: positive }),
  { authorizeUrl: "https://open.weixin.qq.com/connect/oauth2/authorize?appid=wxH5CONTRACT000001&redirect_uri=https%3A%2F%2Fstorefront.example.invalid%2Fsaidian-mall%2F&response_type=code&scope=snsapi_base&state=" + oauthState + "#wechat_redirect", state: oauthState, expiresIn: 300 },
  source.auth, "公众号未配置返回503；redirect_uri只用服务端配置。国际版另校验开关/维护/当前协议，回调固定 /global/saidian-mall/oauth/callback，须传当前consentVersion。state一次性、5分钟，不接受客户端appId/openId。示例授权地址不可实际授权。");
h5FieldContracts["CommerceCompatibilityController.loginWechatH5"] = record(
  obj({ code: { ...text, minLength: 1, maxLength: 1024 }, state: hex,
    codeVerifier: { ...text, pattern: "^[A-Za-z0-9._~-]{43,128}$" }, consentVersion: consent, locale: globalLocale }, ["code", "state", "codeVerifier", "consentVersion"]),
  { code: "H5-CONTRACT-ONE-TIME-CODE", state: oauthState, codeVerifier: verifier, consentVersion: "commerce-legal-v1" },
  { oneOf: [bindingPending, boundSession] },
  { requiresMobileBinding: true, bindTicket, expiresIn: 300, returnTo: "/pages/checkout/index" },
  source.auth, "从回跳URL的search读取code/state。global 未关联手机号（包括仅核验邮箱）返回requiresAccountBinding=true，不含token/user；先完成手机登记。正式已验证手机号可登录；临时登记仅在专用开关开启且原微信身份有效时续登受限会话。协议过时409先重新阅读授权；state消费或换码失败需重新授权。回调URL和日志不得泄露code/state。");
h5FieldContracts["CommerceCompatibilityController.bindWechatH5Mobile"] = record(
  obj({ bindTicket: hex, mobile, code: otp, consentVersion: consent }),
  { bindTicket, mobile: "19900000001", code: "123456", consentVersion: "commerce-legal-v1" },
  boundSession, { ...sessionExample, requiresMobileBinding: false, returnTo: "/pages/checkout/index" }, source.auth,
  "先以usage=bind_mobile请求独立验证码。bindTicket一次性且5分钟。appId+openId作用域身份与已核验手机号绑定；冲突409，不自动合并两个账号，不借用小程序openId。");

const globalBoundExample = { ...sessionExample, user: { ...sessionExample.user, mobile: null }, requiresMobileBinding: false, requiresAccountBinding: false, returnTo: "/pages/profile/index" };
h5FieldContracts["CommerceCompatibilityController.bindWechatH5Account"] = record(
  obj({ bindTicket: hex, identifier: globalIdentifier, password: globalPassword, consentVersion: consent, locale: globalLocale }, ["bindTicket", "identifier", "password", "consentVersion"]),
  { bindTicket, identifier: "h5-contract@example.invalid", password: "H5-CONTRACT-Test-Password-Only", consentVersion: "global-contract-reviewed-v1", locale: "en" },
  { oneOf: [boundSession, bindingPending] }, globalBoundExample, source.auth,
  "仅global。必须证明既有账号原密码且该账号有真实emailVerifiedAt/mobileVerifiedAt；临时免验证账号403，不自动标为已验证。仅验证邮箱时返回新手机登记票据而非会话；已验证手机才返回正式会话。票据与appId/OpenID匹配、一次性消费。未配置503、身份冲突409、过期401，不改密码或合并资产。");
h5FieldContracts["CommerceCompatibilityController.requestWechatH5BindingCode"] = record(
  obj({ bindTicket: hex, channel: { enum: ["email", "sms"] }, identifier: globalIdentifier, locale: globalLocale }, ["bindTicket", "channel", "identifier"]),
  { bindTicket, channel: "email", identifier: "h5-contract@example.invalid", locale: "en" },
  obj({ challengeId: id, expiresIn: positive, retryAfter: positive, maskedIdentifier: text }),
  { challengeId: sid(80), expiresIn: 300, retryAfter: 60, maskedIdentifier: "h***@example.invalid" }, source.auth,
  "仅global且必须已有有效公众号绑定票据；用途固定wechat_bind，OTP散列绑定ticket。与注册/重置共享联系人限频另加票据限频，60秒/日10次，供应商缺失503，无devCode。仅真实发送成功才可消费。");
h5FieldContracts["CommerceCompatibilityController.bindWechatH5Code"] = record(
  obj({ bindTicket: hex, challengeId: id, code: otp, password: globalPassword, consentVersion: consent, locale: globalLocale, nickname: { ...text, maxLength: 40 } }, ["bindTicket", "challengeId", "code", "password", "consentVersion"]),
  { bindTicket, challengeId: sid(80), code: "000000", password: "H5-CONTRACT-Test-Password-Only", consentVersion: "global-contract-reviewed-v1", locale: "en", nickname: "H5合成会员" },
  { oneOf: [boundSession, bindingPending] }, globalBoundExample, source.auth,
  "仅global。新账号设置密码；已有账号需原密码+OTP双证明，不重设密码。首次核验会撤销旧会话防预占账号提权；只标记本次真实验证的联系方式。仅验证邮箱时返回新手机登记票据而非会话。票据与OTP/用户/身份/同意同事务消费，错误码最多5次；过期/重放400或401、冲突409、服务关闭503。");

const availability = obj({ enabled: bool, reason: text }, ["enabled"]);
const phoneMember = obj({ id, nickname: text, memberNo: { anyOf: [positive, { type: "string", pattern: "^[0-9]+$" }] },
  phoneMasked: nullable(text), phoneVerified: bool, phoneTestMode: bool, phoneVerificationStatus: text }, ["id", "nickname", "phoneVerified", "phoneTestMode", "phoneVerificationStatus"]);
const phoneMemberExample = { id: sid(81), nickname: "H5-CONTRACT合成会员", memberNo: 81,
  phoneMasked: "+16***0101", phoneVerified: false, phoneTestMode: true, phoneVerificationStatus: "pending" };
h5FieldContracts["CommerceCompatibilityController.requestWechatH5PhoneCode"] = record(
  obj({ bindTicket: hex, identifier: { type: "string", pattern: "^\\+[1-9][0-9]{6,14}$" }, locale: globalLocale, expectedMode: { const: "test", description: "客户端自动申请临时登记时必须传入；模式已关闭则拒绝，不能回退发送短信。" } }, ["bindTicket", "identifier"]),
  { bindTicket, identifier: "+16505550101", locale: "en", expectedMode: "test" },
  obj({ challengeId: id, expiresIn: positive, retryAfter: positive, maskedIdentifier: text, mode: { enum: ["test", "sms"] }, sent: bool, verificationRequired: bool }),
  { challengeId: sid(82), expiresIn: 300, retryAfter: 60, maskedIdentifier: "+16***0101", mode: "test", sent: false, verificationRequired: false }, source.auth,
  "仅global。先真实微信授权取得一次性bindTicket；test需GLOBAL_WECHAT_PHONE_TEST_ENABLED=true且不发送短信，不写真实送达/验证标记。界面默认+86并提交规范E.164号码；临时模式可填写6位码后自动申请票据，自动申请须带expectedMode=test，模式不符在发送前拒绝。test用途与真实OTP隔离，不能在App注册/重置/原bind-code接口消费。能力关闭拒绝；限频及票据有效期照常执行。" );
h5FieldContracts["CommerceCompatibilityController.bindWechatH5Phone"] = record(
  obj({ bindTicket: hex, challengeId: id, code: otp, consentVersion: consent, locale: globalLocale, password: globalPassword }, ["bindTicket", "challengeId", "code", "consentVersion"]),
  { bindTicket, challengeId: sid(82), code: "654321", consentVersion: "global-contract-reviewed-v1", locale: "en" },
  obj({ ...boundSession.properties, user: phoneMember }, [...boundSession.required, "requiresAccountBinding"]),
  { ...globalBoundExample, user: phoneMemberExample }, source.auth,
  "临时mode=test接受任意6位数字，但只登记真实微信当前主体的未验证手机号，或以尚未占用手机号新建无密码账号；任何其他账号号码冲突409，不合并、不改密码、不设mobileVerifiedAt。test会话的来源持久保存，不能用于App/交易/健康/后台；只允许本H5账号读取、退出与受控刷新，关闭开关后access和refresh立即被拒绝。正式sms模式须真实OTP；已有未验证账号须额外原密码证明，不擅自继承资产。" );
h5FieldContracts["CommerceCompatibilityController.wechatH5Account"] = record(null, null, phoneMember, phoneMemberExample, source.auth,
  "仅global且需当前会员令牌。返回安全会员字段及真实手机核验状态，前端不能将phoneTestMode或填过手机号当成已验证；数据版本来自服务端，过期/撤销/临时开关关闭返回401。" );
const paymentChannels = ["wechat_jsapi", "wechat_mini", "wechat_h5", "wechat_native", "alipay_wap", "alipay_page"];
const capabilitiesSchema = obj({
  realm: { const: "domestic" },
  login: obj({ password: availability, sms: availability, wechatH5: availability }),
  payments: array(obj({ channel: { enum: paymentChannels }, enabled: bool, reason: text, environments: array({ enum: ["wechat", "mini", "browser"] }) }, ["channel", "enabled", "environments"])),
  checkout: obj({ minimumCashCents: { const: 1 }, points: obj({ supported: { const: true }, requiresVerifiedAccount: { const: true } }) }),
  maintenance: obj({ readOnly: bool, reason: text }, ["readOnly"]), demo: bool,
}, ["login", "payments", "checkout", "maintenance", "demo"]);
// Independent accounts may buy the supported CN/CNY offer. Other markets and
// unconfigured payment rails remain unavailable; phone-test sessions cannot trade.
const internationalCapabilitiesSchema = obj({
  realm: { const: "global" }, consentVersion: nullable(consent), legal: nullable(obj({
    userAgreement: obj({ path: text, locale: globalLocale, version: text }),
    privacyPolicy: obj({ path: text, locale: globalLocale, version: text }),
  })),
  login: obj({ password: availability, sms: availability, wechatH5: availability,
    wechatBinding: obj({ bindExistingAvailable: bool, emailOtpAvailable: bool, smsOtpAvailable: bool,
      password: availability, email: availability, sms: availability, smsCountries: array(text), verifiedAccountRequired: { const: true },
      phoneCodeMode: { enum: ["test", "sms", "unavailable"] }, phoneBindingAvailable: bool, verificationRequired: bool }) }),
  payments: array(obj({ channel: { enum: paymentChannels.filter(channel => channel !== "wechat_mini") }, enabled: bool, reason: text, environments: array({ enum: ["wechat", "browser"] }) }, ["channel", "enabled", "environments"])),
  checkout: obj({ enabled: bool, reason: text, countryCodes: array({ const: "CN" }), currency: { const: "CNY" }, minimumCashCents: { const: 1 }, points: obj({ supported: bool, requiresVerifiedAccount: { const: true } }) }, ["enabled", "countryCodes", "currency", "minimumCashCents", "points"]),
  maintenance: obj({ readOnly: bool }), demo: { const: false },
});
const capabilitiesExample = {
  login: { password: { enabled: true }, sms: { enabled: true }, wechatH5: { enabled: false, reason: "微信公众号登录尚未配置" } },
  payments: paymentChannels.map(channel => ({ channel, enabled: false, reason: "支付渠道尚未配置", environments: [channel === "wechat_jsapi" ? "wechat" : channel === "wechat_mini" ? "mini" : "browser"] })),
  checkout: { minimumCashCents: 1, points: { supported: true, requiresVerifiedAccount: true } },
  maintenance: { readOnly: false }, demo: true,
};
const globalCapabilitiesExample = {
  realm: "global", consentVersion: null, legal: null,
  login: { password: { enabled: true }, sms: { enabled: false }, wechatH5: { enabled: false },
    wechatBinding: { bindExistingAvailable: false, emailOtpAvailable: false, smsOtpAvailable: false,
      password: { enabled: false }, email: { enabled: false }, sms: { enabled: false }, smsCountries: [], verifiedAccountRequired: true,
      phoneCodeMode: "unavailable", phoneBindingAvailable: false, verificationRequired: true } },
  payments: capabilitiesExample.payments.filter(channel => channel.channel !== "wechat_mini"),
  checkout: { enabled: true, countryCodes: ["CN"], currency: "CNY", minimumCashCents: 1, points: { supported: true, requiresVerifiedAccount: true } },
  maintenance: { readOnly: false }, demo: false,
};
h5FieldContracts["CommerceCompatibilityController.storefrontCapabilities"] = record(null, null, { oneOf: [capabilitiesSchema, internationalCapabilitiesSchema] }, capabilitiesExample,
  source.capability, "公开只含能力布尔值/原因，不含密钥、appId或商户身份。enabled只代表本地配置通过校验，不代表真实供应商联调成功。国际版只开放CN中国大陆收货、CNY整数分报价与已验证账号；临时任意验证码会话禁止交易，国际版不返回小程序支付。独立global.markets显式关闭、维护、出站暂停及缺少商户配置仍拒绝对应操作。国内wechat_mini仅mini环境，公众号OAuth未配置不连带禁用已配置的小程序。demo仅非production+H5_DEMO_ENABLED；示例是隔离演示状态，不是生产承诺。");
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
  referral: nullable(obj({ name: text, referralCode: text })), capabilities: { oneOf: [capabilitiesSchema, internationalCapabilitiesSchema] },
});
h5FieldContracts["CommerceCompatibilityController.bootstrap"] = record(null, null, bootstrapSchema, {
  banners: [{ id: sid(6), title: "H5-CONTRACT演示", imageUrl, targetUrl: "/pages/product/index?id=" + sid(2), enabled: true, sort: 100 }],
  categories: [{ id: sid(5), name: "H5-CONTRACT演示分类", parentId: null, sort: 100, enabled: true }],
  featured: [cardExample], configs: { "store.notice": { key: "store.notice", label: "合成演示公告", enabled: true, value: { text: "合成演示，不发短信、不支付、不打款" } } },
  referral: { name: "H5-CONTRACT演示员工", referralCode: "H5DEMO" }, capabilities: capabilitiesExample,
}, source.store + "; " + source.capability, "首页、分类、商品、公告由统一后台驱动。未命中员工推荐号referral=null，不猜员工归属。商品使用公开DTO，不应返回成本价、ERP内部字段。");
h5FieldContracts["CommerceCompatibilityController.bootstrap"].query = { ref: { schema: text, example: "H5DEMO", required: false } };

const addressSchema = obj({ id, userId: id, name: text, mobile: { ...text, description: "国内11位手机号；国际账号地址返回带+国家码的E.164，当前购物仅支持countryCode=CN。" }, countryCode: text, postalCode: nullable(text), province: text, city: text, district: text, detail: text, isDefault: bool }, ["id", "userId", "name", "mobile", "province", "city", "district", "detail", "isDefault"]);
const addressExample = { id: sid(4), userId: sid(1), name: "H5-CONTRACT测试收件人", mobile: "19900000001",
  province: "测试省", city: "测试市", district: "测试区", detail: "仅限本地合成演示地址1号", isDefault: true };
const orderInput = obj({ addressId: id, items: { ...array(obj({ skuId: id, quantity })), minItems: 1 }, couponClaimId: id,
  pointCents: cents, buyerRemark: { ...text, description: "买家备注，不作为支付价格或员工身份来源。" }, idempotencyKey: { ...text, minLength: 8 } }, ["addressId", "items"]);
const orderRequest = { addressId: sid(4), items: [{ skuId: sid(3), quantity: 3 }], pointCents: 901, buyerRemark: "H5-CONTRACT合成订单" };
const pricedLine = obj({ skuId: id, quantity, unitPriceCents: cents, totalCents: cents,
  couponDiscountCentsSnapshot: cents, pointDiscountCentsSnapshot: cents, cashPaidCentsSnapshot: cents,
  name: text, image: nullable(text), specification: nullable(text) });
const quoteFingerprint = { type: "string", pattern: "^q1:[a-f0-9]{64}$", description: "服务端报价指纹；包含规则版本、金额和SKU行分摊，不是库存预占或授权令牌。原样作为创建订单expectedQuote。" };
const quoteSchema = obj({ fingerprint: quoteFingerprint, pricingVersion: { const: 1 }, subtotalCents: cents, couponDiscountCents: cents,
  pointDiscountCents: cents, shippingCents: cents, payableCents: { ...cents, minimum: 1 },
  availablePointCents: nullable(cents), maxPointCents: cents, lines: array(pricedLine) });
const quoteExample = { fingerprint: "q1:788afb20844abb8cb99656ed42a92bcf769090662c8159fde839b2d050339ecf", pricingVersion: 1, subtotalCents: 59700, couponDiscountCents: 0, pointDiscountCents: 901,
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
  source.store, "只报价不扣库存/积分。599分运费是合成配置，不是实际默认运费。availablePointCents=null表示账户未核验，此时maxPointCents=0只表示不可抵扣，不代表余额为0。先券后积分，按最大余数分摊；积分不抵运费，现金至少1分。提交时将quote.fingerprint作为expectedQuote；创建事务重新报价后不一致返回409 quote_changed，不产生订单或资产写入。");
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
h5FieldContracts["CommerceCompatibilityController.createOrder"] = record(obj({ ...orderInput.properties, expectedQuote: quoteFingerprint }, orderInput.required),
  { ...orderRequest, expectedQuote: quoteExample.fingerprint, idempotencyKey: "H5-CONTRACT-order-request-0001" }, orderSchema, orderExample, source.store,
  "仅创建待付款单，不代表支付成功。Idempotency-Key请求头优先于body.idempotencyKey；至少8字符且必须随同一请求保留。同键同参返回原单且优先于当前报价核验，同键改变参数（含expectedQuote）409。expectedQuote可选以兼容旧调用；新H5必传quote.fingerprint，格式错误400，事务内金额/行分摊不符409 quote_changed且所有写入均未开始。发生409应重新报价并让用户确认；网络未知结果或同键仍处理中503 order_in_progress保留原键和原expectedQuote查询，不生成新单。扣库存和积分、占用券与订单快照同事务；所有价格由服务端算。");
h5FieldContracts["CommerceController.previewOrder"] = h5FieldContracts["CommerceCompatibilityController.previewOrder"];
h5FieldContracts["CommerceController.createOrder"] = h5FieldContracts["CommerceCompatibilityController.createOrder"];
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
const evidenceFileIds = { ...array(id), maxItems: 9, uniqueItems: true,
  description: "先经售后专用上传取得的本人ACTIVE文件UUID，最多9个且不得重复；须为commerce_after_sale用途、JPEG/PNG/WebP且≤10MiB。空数组允许纯文字售后。不能与非空evidenceImages混用。" };
const saleInput = obj({ type: saleTypes, items: { ...array(obj({ orderItemId: id, quantity })), minItems: 1 },
  orderVersion: count, reason: text, description: text, evidenceFileIds,
  evidenceImages: { ...array(text), description: "仅保留国内旧客户端历史外链形状；global不接受非空值。新H5只使用evidenceFileIds，不能提交公开URL。" },
  idempotencyKey: {type:"string",pattern:"^[A-Za-z0-9_-]{8,128}$"} }, ["type", "items"]);
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
  settledAt: nullable(date), createdAt: date, items: array(refundLine),
  evidenceImages: { ...array(text), description: "新上传为file:UUID私有引用，不是可直接放进img.src的URL；客户端以会员/后台Bearer读取对应图片接口。旧国内记录可保留旧形状。" },
  returnLogisticsCompany: nullable(text), returnTrackingNo: nullable(text) },
  ["id", "afterSaleNo", "orderId", "type", "status", "version", "pricingVersion", "requestedCents", "pointReturnCents", "shippingRefundCents", "reason", "settledAt", "createdAt"]);
const saleExample = { id: sid(9), afterSaleNo: "H5-CONTRACT-AS-0001", orderId: sid(7), type: "REFUND_ONLY",
  status: "APPLIED", version: 0, pricingVersion: 1, requestedCents: 19599, pointReturnCents: 300,
  shippingRefundCents: 0, reason: "H5-CONTRACT合成测试申请", settledAt: null, createdAt: at, items: saleQuoteExample.items };
h5FieldContracts["CommerceCompatibilityController.previewAfterSale"] = record(saleInput, saleRequest, saleQuote, saleQuoteExample,
  source.store, "只报价不退款。当前一次申请的现金=requestedCents=merchandiseRefundCents+shippingRefundCents；积分单列。按累计数量取差消除分次尾差：本例先退1件19599现金+300积分，后2件39200现金+601积分。同一商品有在途售后409。首次整单退款可含原运费，分次退完商品不会自动补退运费。");
h5FieldContracts["CommerceCompatibilityController.afterSale"] = record({ ...saleInput, required: [...saleInput.required, "reason"] },
  { ...saleRequest, orderVersion: 1, reason: saleExample.reason, evidenceFileIds: [sid(21)], idempotencyKey:"H5-CONTRACT-after-sale-0001" },
  saleSchema, { ...saleExample, evidenceImages: [`file:${sid(21)}`] }, source.store + "; " + source.evidence,
  "首次申请先报价并传orderVersion及idempotencyKey。图片上传成功后传evidenceFileIds；首次创建事务内逐个核验本人归属/用途/ACTIVE/大小/类型，非法、重复、他人文件或与非空evidenceImages混传400；global禁止非空外链。纯文字可省略图片或传空数组，存储未配置不阻断文字售后。未知结果重试必须保留原键及完整原payload（含相同图片ID），不先换新报价或重传图片：同键同参优先返回原售后，变更内容409；旧调用未传键仍兼容，但无恢复保证。APPLIED不代表退款/积分到账。纯积分商品须审核且不创建零元渠道退款；现金结果未知保持占用。SHIPPING_ONLY禁止客户申请。");

const evidenceTypes = ["image/jpeg", "image/png", "image/webp"];
const evidenceAuth = "会员Bearer必须放Authorization请求头，不放查询参数。global须ACTIVE且邮箱或手机号已真实验证；临时h5-phone-test会话、员工令牌或失效会员会话由UserAuthGuard返回401。";
const evidenceResponse = obj({ id, byteSize: { ...positive, maximum: 10485760 }, contentType: { enum: evidenceTypes }, sha256: hex });
h5FieldContracts["CommerceEvidenceController.capabilities"] = record(null, null,
  obj({ enabled: bool, maxFiles: { const: 9 }, maxBytes: { const: 10485760 }, contentTypes: array({ enum: evidenceTypes }), reason: text },
    ["enabled", "maxFiles", "maxBytes", "contentTypes"]),
  { enabled: false, maxFiles: 9, maxBytes: 10485760, contentTypes: evidenceTypes, reason: "图片服务未配置，暂不可上传；您仍可提交文字说明。" }, source.evidence,
  evidenceAuth + "HTTP200 raw JSON。enabled只代表object_storage状态和必要参数可构造存储客户端，不探测网络，不代表已有真实上传/读取回执。未配置返回enabled=false和reason，不返回密钥、bucket、对象地址。每个申请最多9张，每次上传1张，每张上限10MiB=10485760字节。");
h5FieldContracts["CommerceEvidenceController.upload"] = { ...record(
  obj({ file: { type: "string", format: "binary", description: "multipart/form-data字段file；仅1个真实JPEG/PNG/WebP文件，实际Buffer≤10485760字节；服务端复核MIME和签名字节，不接受外部URL、SVG、HTML或JSON/base64代替文件。" } }),
  { file: "<LOCAL_JPEG_PNG_WEBP_FILE>" }, evidenceResponse,
  { id: sid(21), byteSize: 2048, contentType: "image/jpeg", sha256: "c".repeat(64) }, source.evidence,
  evidenceAuth + "HTTP201 raw JSON回执仅id/byteSize/contentType/sha256，不含公开URL。示例只是合成回执形状，不证明对象存储已配置或真的上传。multipart须使用file字段；无文件/无效内容/类型伪装400、文件超过10MiB由上传限制拒绝413、每分钟12次超限429；未配置或存储失败503。上传完成后另以evidenceFileIds提交售后；移除选择不删除已存对象。替换curl本地文件占位符时使用正确.jpg/.png/.webp扩展名和对应MIME。"),
  contentType: "multipart/form-data" };
const evidenceBinary = { type: "string", format: "binary", description: "原始JPEG/PNG/WebP文件字节；Content-Type取已存文件类型；不含JSON/data包裹，不返回公开地址。" };
const evidenceRead = "HTTP200直接返回image/jpeg、image/png或image/webp二进制，禁止按JSON解析。响应Cache-Control: private, no-store；X-Content-Type-Options: nosniff；Referrer-Policy: no-referrer；CSP限制。不存在/不属于本人/用途或状态不符404，存储未配置或读取失败503。浏览器需带Bearer请求后显示Blob，不能将token加入URL。";
h5FieldContracts["CommerceEvidenceController.image"] = record(null, null, evidenceBinary, null, source.evidence,
  evidenceAuth + "id为专用售后FileObject UUID，只读取当前会员所属ACTIVE文件，不通过公开头像reader或桶URL读取。" + evidenceRead);
h5FieldContracts["AppCommerceEvidenceController.capabilities"] = h5FieldContracts["CommerceEvidenceController.capabilities"];
h5FieldContracts["AppCommerceEvidenceController.upload"] = h5FieldContracts["CommerceEvidenceController.upload"];
h5FieldContracts["AppCommerceEvidenceController.image"] = h5FieldContracts["CommerceEvidenceController.image"];
h5FieldContracts["AdminCommerceEvidenceController.image"] = record(null, null, evidenceBinary, null, source.evidence,
  "后台Bearer会话与commerce-after-sales/read权限；roles以实时多角色为准，不使用会员或员工令牌。saleId、fileId均为UUID，必须先在该售后evidenceImages中实际存在file:UUID引用，再核验原订单会员文件归属；无权限403、未关联404。成功读取前写COMMERCE_EVIDENCE_READ审计（saleId/fileId/requestId），审计失败不返回图片；不豁免超级管理员审计。" + evidenceRead);
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
h5FieldContracts["CommerceEmployeeController.memberDashboard"] = {
  ...h5FieldContracts["CommerceEmployeeController.dashboard"],
  query: { ...h5FieldContracts["CommerceEmployeeController.dashboard"].query },
  notes: "只接受当前会员Bearer会话并解析该会员自己的稳定推广账户；不接受客户端employeeId。返回结构与员工工作台一致，但普通会员不需要企业微信登录。提现仍要求后台启用、可用余额和已核验收款身份。",
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

const couponPublic = obj({ id, name:text, type:{const:'CASH'}, value:cents, minimumSpendCents:cents, validFrom:date, validUntil:date, claimed:bool, available:bool });
h5FieldContracts['CommerceCompatibilityController.availableCoupons'] = record(null,null,
  obj({items:array(couponPublic),pagination:obj({page:positive,pageSize:{const:20},total:count,hasMore:bool})}),
  {items:[{id:sid(20),name:'H5-CONTRACT公开测试券',type:'CASH',value:100,minimumSpendCents:1000,validFrom:at,validUntil:'2027-09-08T01:00:00.000Z',claimed:false,available:true}],pagination:{page:1,pageSize:20,total:1,hasMore:false}},source.store,
  '会员鉴权；仅公开ACTIVE且当前有效券，不含员工专属赠券；available已扣除赠券预留额度。领取仍需POST原claim入口再次核验。已领取重试幂等且优先于过期/领完检查。');
h5FieldContracts['CommerceCompatibilityController.availableCoupons'].query={page:{schema:positive,example:1,required:false}};
const orderGroups={status:{schema:{enum:orderStatuses},example:'PENDING_PAYMENT',required:false},group:{schema:{enum:['pending_shipment','after_sales']},example:'after_sales',required:false}};
for(const key of ['CommerceCompatibilityController.orders','CommerceController.orders']){
  h5FieldContracts[key]=record(null,null,array({oneOf:[orderSchema,legacyDetail]}),[orderExample],source.store,
    'status与group互斥。pending_shipment在服务端完整数据包含PAID/WAITING_FULFILLMENT；after_sales按本人订单存在实际售后关联筛选，包含处理结束记录，不是仅当前AFTER_SALE状态。旧status保持精确查询。');
  h5FieldContracts[key].query=orderGroups;
}
const reviewSummary=nullable(obj({id,rating:{type:'integer',minimum:1,maximum:5},content:text,published:bool,createdAt:date}));
detailSchema.properties.items=array(obj({...itemSchema.properties,review:reviewSummary},[...itemSchema.required,'review']));
detailExample.items=[{...itemExample,review:null}];
h5FieldContracts['CommerceCompatibilityController.order'].note+=' items[].review为本订单商品的实际评价或null；published=false仍表示已经提交，不能重新创建。物流字段为shipments[].traceJson，商品分包关系在shipments[].items。';

// Named fixtures support pure tests and let delivery docs reuse the exact values.
export const h5ContractExamples = { session: sessionExample, capabilities: capabilitiesExample, globalCapabilities: globalCapabilitiesExample, quote: quoteExample,
  order: orderExample, afterSale: saleQuoteExample, shipping: shippingExample };
