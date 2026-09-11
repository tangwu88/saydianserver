import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { realmTestModules } from "../../../tools/h5-realm-fixture.mjs";

const require = createRequire(import.meta.url);
const ts = require("typescript"), vue = require("vue");
const { parse, compileScript, compileTemplate } = require("vue/compiler-sfc");
function compilePage(name) {
  const url = new URL(`../src/pages/${name}/index.vue`, import.meta.url), filename = url.pathname;
  const descriptor = parse(readFileSync(url, "utf8"), { filename }).descriptor;
  const script = compileScript(descriptor, { id: `${name}-test` });
  const template = compileTemplate({ source: descriptor.template.content, filename, id: `${name}-test`, compilerOptions: {
    bindingMetadata: script.bindings, isCustomElement: tag => tag === tag.toLowerCase(),
  } });
  assert.deepEqual(template.errors, []);
  // These tests invoke rendered buttons and inspect props, not input directives.
  const render = evaluate(template.code, { vue: { ...vue, withDirectives: node => node } }).render;
  return { script, render };
}

function evaluate(source, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected import " + name); return imports[name]; },
  });
  return module.exports;
}
const chinaArea = evaluate(
  readFileSync(new URL("../src/china-area.ts", import.meta.url), "utf8"),
  { "@vant/area-data": require("@vant/area-data") },
);
const { script, render } = compilePage("product");
const product = changes => ({ id: "synthetic-product", name: "测试商品", tags: [], gallery: [], coverImage: null,
  skus: [{ id: "synthetic-sku", stock: 2, salePriceCents: 1000, image: null }], ...changes });
async function page(realmName, value = product(), options = {}) {
  const storage = new Map(), navigations = [], requests = [], hooks = {}, notices = [], copied = [], titles = [], previews = []; let session = "session-1", cleared = 0;
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }), switchTab: value => navigations.push(value.url), navigateTo: value => navigations.push(value.url), showToast() {},
    setClipboardData: value => { copied.push(value.data); value.success?.(); }, setNavigationBarTitle: value => titles.push(value.title), previewImage: value => previews.push(value),
  };
  const { realm } = realmTestModules(uni, { env: realmName === "global" ? { VITE_APP_REALM: "global" } : {} });
  if (options.user) { realm.mallStorage.set("saidian-user", options.user); realm.mallStorage.set("saidian-token", "synthetic-token"); }
  if (options.draft) { realm.mallStorage.set("checkout-draft", structuredClone(options.draft)); realm.mallStorage.set("checkout-owner", options.owner ?? options.user?.id); }
  const component = evaluate(script.content, {
    vue, "../../realm": realm, "../../components/DesktopHeader.vue": { default: { render: () => null } },
    "@dcloudio/uni-ui/lib/uni-icons/uni-icons.vue": { default: { render: () => null } },
    qrcode: { default: { toDataURL: async value => `data:image/png;base64,${Buffer.from(value).toString('base64')}` } },
    "../../components/ImageEvidencePicker.vue": { default: { render: () => null } },
    "@dcloudio/uni-app": { onLoad: callback => hooks.load = callback, onShow: callback => hooks.show = callback },
    "../../session": { isLoggedIn: () => !!realm.mallStorage.get("saidian-token") },
    "../../api": { api: async (path, input) => { requests.push({ path, input }); if (path === "/storefront/favorites") return []; if (options.productError) throw new Error("Synthetic unavailable product"); return structuredClone(value); }, money: cents => `¥${cents / 100}`, toast: value => notices.push(String(value)), requireLogin() {}, clearCheckoutState() { cleared++; }, mallSessionStamp: () => session },
  }, { uni, navigator: options.navigator || { userAgent: "Synthetic Browser" }, location: options.location || { origin: "https://app.saydian.cn", pathname: "/global/saidian-mall/" } }).default;
  const state = component.setup({}, { expose() {} });
  hooks.load({ id: value.id }); await hooks.show();
  const ui = vue.proxyRefs(state);
  return { state, navigations, requests, notices, copied, titles, previews, storage: realm.mallStorage, setSession: value => { session = value; }, cleared: () => cleared, tree: () => render({}, [], {}, ui, {}, {}) };
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...(Array.isArray(node.children) ? node.children.flatMap(nodes) : [])];
}
function text(node) { return typeof node?.children === "string" ? node.children : Array.isArray(node?.children) ? node.children.map(text).join("") : ""; }
const button = (tree, label) => nodes(tree).find(node => node.type === "button" && text(node) === label);

test("global product opens cart and purchase controls while anonymous actions still require login", async () => {
  const h = await page("global"), tree = h.tree();
  assert.ok(button(tree, "商城首页")); assert.ok(button(tree, "购物车"));
  assert.equal(button(tree, "加入购物车").props.disabled, false); assert.equal(button(tree, "立即购买").props.disabled, false);
  button(tree, "商城首页").props.onClick(); h.state.goCart();
  assert.deepEqual(h.navigations, ["/pages/home/index", "/pages/cart/index"]);
  await button(tree, "加入购物车").props.onClick();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].path, "/storefront/products/synthetic-product");
});

test("product share creates a QR poster, keeps referral attribution and provides save/copy actions", async () => {
  const h = await page("global"); h.storage.set("saidian-ref", "TEAM01");
  await h.state.shareProduct();
  assert.equal(h.state.posterVisible.value, true); assert.match(h.state.posterUrl.value, /^data:image\/png;base64,/);
  const tree = h.tree(), save = button(tree, "查看并保存"), copy = button(tree, "复制商品链接");
  assert.ok(save); assert.ok(copy); save.props.onClick(); copy.props.onClick();
  const expected = "https://app.saydian.cn/global/saidian-mall/?ref=TEAM01#/pages/product/index?id=synthetic-product";
  assert.equal(h.previews[0].current, h.state.posterUrl.value); assert.deepEqual(h.copied, [expected]);
  assert.equal(h.titles.at(-1), "测试商品");
});

test("global zero, missing or invalid stock never enables a purchase", async () => {
  for (const stock of [0, undefined, null, -1, 1.5, "2"]) {
    const h = await page("global", product({ skus: [{ id: "sku", salePriceCents: 1000, stock }] }));
    assert.equal(button(h.tree(), "加入购物车").props.disabled, true);
    assert.equal(button(h.tree(), "暂时缺货").props.disabled, true);
  }
});

const frozenPurchase = { userId: "member-a", key: "synthetic-frozen-order", uncertain: true, payload: { addressId: "address", items: [{ skuId: "sku", quantity: 1 }], expectedQuote: "q1:" + "a".repeat(64) } };
test("owned pending checkout remains recoverable with zero stock or an unavailable product without touching the frozen request", async () => {
  for (const productError of [false, true]) {
    const h = await page("global", product({ skus: [{ id: "sku", stock: 0, salePriceCents: 1000 }] }), { user: { id: "member-a" }, draft: frozenPurchase, productError });
    const recover = button(h.tree(), "恢复上次下单"); assert.ok(recover); assert.equal(recover.props.disabled, false);
    if (!productError) assert.equal(button(h.tree(), "暂时缺货").props.disabled, true);
    const calls = h.requests.length; recover.props.onClick();
    assert.deepEqual(h.navigations, ["/pages/checkout/index"]); assert.equal(h.requests.length, calls); assert.equal(h.cleared(), 0);
    assert.deepEqual(h.storage.get("checkout-draft"), frozenPurchase);
  }
});

test("recovery visibility and click both reject foreign ownership, changed sessions and replaced drafts", async () => {
  for (const owner of ["member-b", ""]) {
    const h = await page("global", product(), { user: { id: "member-a" }, draft: frozenPurchase, owner });
    assert.equal(button(h.tree(), "恢复上次下单"), undefined);
  }
  const foreign = await page("global", product(), { user: { id: "member-b" }, draft: frozenPurchase });
  assert.equal(button(foreign.tree(), "恢复上次下单"), undefined);
  for (const change of [h => h.setSession("session-2"), h => h.storage.set("saidian-user", { id: "member-b" }),
    h => h.storage.set("checkout-draft", { ...frozenPurchase, key: "replacement-key" }), h => h.storage.remove("checkout-draft")]) {
    const h = await page("global", product(), { user: { id: "member-a" }, draft: frozenPurchase });
    const recover = button(h.tree(), "恢复上次下单"); change(h); recover.props.onClick();
    assert.deepEqual(h.navigations, []); assert.equal(h.cleared(), 0); assert.match(h.notices.at(-1), /状态已变化/);
  }
});

test("ordinary product shortcuts use actual home/cart tab navigation without changing the login identity", async () => {
  const h = await page("domestic"), tree = h.tree();
  button(tree, "商城首页").props.onClick(); button(tree, "购物车").props.onClick();
  assert.deepEqual(h.navigations, ["/pages/home/index", "/pages/cart/index"]);
  assert.equal(h.requests.length, 1);
});

test("missing product pictures render a textual placeholder instead of an empty image request", async () => {
  for (const realm of ["global", "domestic"]) {
    const h = await page(realm), tree = h.tree();
    assert.ok(nodes(tree).some(node => node.type === "view" && text(node) === "暂无商品图片"));
    assert.equal(nodes(tree).some(node => node.type === "image"), false);
    assert.equal(nodes(tree).some(node => node.type === "scroll-view"), false);
  }
});

test("real images replace the placeholder and multiple unique thumbnails update the displayed image", async () => {
  const first = "https://example.invalid/first.png", second = "https://example.invalid/second.png";
  const h = await page("global", product({ coverImage: first, gallery: [first, second] }));
  let tree = h.tree();
  assert.equal(nodes(tree).filter(node => node.type === "image").length, 3);
  assert.equal(nodes(tree).some(node => text(node) === "暂无商品图片"), false);
  const thumbnail = nodes(tree).find(node => node.type === "image" && node.props.src === second);
  thumbnail.props.onClick(); tree = h.tree();
  assert.equal(nodes(tree).find(node => node.type === "image" && node.props.class === "main-image").props.src, second);
});

function orderPage(name, apiHandler, paymentOverrides = {}) {
  const { script, render } = compilePage(name), navigations = [], requests = [], storage = new Map(); let cleared = 0;
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key), getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    redirectTo: value => navigations.push(value.url), navigateTo: value => navigations.push(value.url), showToast() {}, getSystemInfoSync: () => ({ windowWidth: 390 }) };
  const { realm } = realmTestModules(uni);
  const model = evaluate(readFileSync(new URL("../src/commerce-model.ts", import.meta.url), "utf8"), {});
  const component = evaluate(script.content, {
    vue, "../../realm": realm, "../../components/DesktopHeader.vue": { default: { render: () => null } },
    "@dcloudio/uni-app": { onLoad() {}, onShow() {}, onHide() {}, onUnload() {} },
    "../../commerce-model": model,
    "../../components/ImageEvidencePicker.vue": { default: { render: () => null } },
    "../../api": { api: async (...args) => { requests.push(args); if (apiHandler) return apiHandler(...args); throw new Error("Unexpected API call"); }, money: cents => `¥${(cents ?? 0) / 100}`,
      toast() {}, requireLogin: () => true, withMallCheckoutLock: callback => callback(), mallSessionStamp: () => "test-session", clearCheckoutState() { cleared++; } },
    "../../payments": { confirmPayment() { throw new Error("Unexpected payment query"); }, createOrderPayment() { throw new Error("Unexpected payment creation"); },
      invokePayment() { throw new Error("Unexpected payment invocation"); }, paymentEnvironment: () => "wechat", paymentLabels: { wechat_jsapi: "微信支付" }, ...paymentOverrides },
  }, { uni, setTimeout, setInterval, clearInterval }).default;
  const state = component.setup({}, { expose() {} }), ui = vue.proxyRefs(state);
  return { state, navigations, requests, storage: realm.mallStorage, cleared: () => cleared, tree: () => render({}, [], {}, ui, {}, {}) };
}

test("a refreshed order has an orders-list exit and unavailable payments never expose provider details", () => {
  const h = orderPage("order-detail");
  h.state.order.value = { id: "synthetic-order", orderNo: "TEST-001", status: "PENDING_PAYMENT", allowedActions: ["PAY"], items: [] };
  h.state.capabilities.value = { payments: [{ channel: "wechat_jsapi", enabled: false, reason: "provider_internal_configuration_detail" }] };
  let tree = h.tree();
  assert.ok(text(tree).includes("暂不可用")); assert.equal(text(tree).includes("provider_internal_configuration_detail"), false);
  assert.equal(button(tree, "继续支付").props.disabled, true);
  assert.equal(button(tree, "查看全部订单").props.disabled, false);
  button(tree, "查看全部订单").props.onClick();
  assert.deepEqual(h.navigations, ["/pages/orders/index"]); assert.deepEqual(h.requests, []);
  h.state.busy.value = true; tree = h.tree();
  assert.equal(button(tree, "查看全部订单").props.disabled, true);
});

test("checkout CTA starts payment directly and retains loading, recovery and maintenance guards", () => {
  const h = orderPage("checkout"), s = h.state;
  s.capabilities.value = { payments: [{ channel: "wechat_jsapi", enabled: false }], maintenance: { readOnly: false } };
  s.address.value = { id: "synthetic-address", name: "测试收货人" }; s.quote.value = { subtotalCents: 1000, couponDiscountCents: 0, pointDiscountCents: 0, shippingCents: 0, payableCents: 1000, lines: [] };
  const cta = () => nodes(h.tree()).find(node => node.type === "button" && node.props.class === "primary-btn");
  assert.equal(text(cta()), "立即付款"); assert.equal(cta().props.disabled, true);
  assert.ok(text(h.tree()).includes("支付暂不可用，请稍后再试"));
  const visibleMoneyLines = nodes(h.tree()).filter(node => node.props?.class === "money-line" || node.props?.class === "money-line total").map(text);
  assert.equal(visibleMoneyLines.some(line => line.includes("优惠券") || line.includes("积分抵扣") || line.includes("运费")), false);
  assert.equal(text(h.tree()).includes("重新获取报价"), false);
  for (const field of ["submitting", "quoting"]) {
    s[field].value = true; assert.equal(cta().props.disabled, true); assert.equal(cta().props.loading, true); s[field].value = false;
  }
  const quote = s.quote.value, address = s.address.value;
  s.quote.value = null; assert.equal(cta().props.disabled, true); s.quote.value = quote;
  s.address.value = null; assert.equal(cta().props.disabled, true); s.address.value = address;
  s.capabilities.value.maintenance.readOnly = true; assert.equal(cta().props.disabled, true); s.capabilities.value.maintenance.readOnly = false;
  s.quoteNeedsConfirmation.value = true; assert.equal(text(cta()), "确认金额并付款");
  s.uncertain.value = true; s.quote.value = null; s.address.value = null;
  assert.equal(text(cta()), "查询并继续付款"); assert.equal(cta().props.disabled, false);
  s.uncertain.value = false; s.quoteNeedsConfirmation.value = false; s.quote.value = quote; s.address.value = address;
  s.capabilities.value.payments[0].enabled = true;
  assert.equal(text(cta()), "立即付款"); assert.equal(cta().props.disabled, false);
  assert.equal(nodes(h.tree()).some(node => node.type === "input" && node.props.placeholder?.includes("配送要求")), false);
  assert.equal(s.showBenefits.value, false);
  nodes(h.tree()).find(node => node.type === "button" && node.props.class === "benefits-toggle").props.onClick();
  button(h.tree(), "添加订单备注（选填） ›").props.onClick();
  assert.equal(nodes(h.tree()).some(node => node.type === "input" && node.props.placeholder?.includes("配送要求")), true);
  s.remark.value = "测试配送要求";
  assert.equal(text(h.tree()).includes("发票抬头"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(s.input())), {
    addressId: "synthetic-address", items: [], pointCents: 0, buyerRemark: "测试配送要求",
  });
  assert.deepEqual(h.requests, []); assert.deepEqual(h.navigations, []);
});

test("checkout keeps optional benefits collapsed and redeems only a server-configured coupon code", async () => {
  const claim = { id: "claim-1", couponId: "coupon-1" }, owned = [{ ...claim, usedAt: null, coupon: { name: "满 100 减 10" } }];
  const h = orderPage("checkout", async (path, input) => {
    if (path === "/storefront/coupons/code/claim") return claim;
    if (path === "/storefront/coupons") return owned;
    if (path === "/storefront/orders/preview") return { quote: { fingerprint: "q1:" + "a".repeat(64), lines: [], subtotalCents: 10000, couponDiscountCents: 1000, pointDiscountCents: 0, shippingCents: 0, payableCents: 9000, availablePointCents: 0, maxPointCents: 0 } };
    throw new Error(`Unexpected API call ${path}`);
  }), s = h.state;
  s.address.value = { id: "address" }; s.items.value = [{ skuId: "sku", quantity: 1 }];
  assert.equal(s.showBenefits.value, false); assert.equal(nodes(h.tree()).some(node => node.type === "input" && node.props.placeholder === "输入优惠码"), false);
  nodes(h.tree()).find(node => node.type === "button" && node.props.class === "benefits-toggle").props.onClick();
  s.couponCode.value = " save10 "; await s.redeemCouponCode();
  assert.equal(s.selectedCoupon.value.id, "claim-1"); assert.equal(s.couponCode.value, "");
  assert.deepEqual(h.requests.map(row => row[0]), ["/storefront/coupons/code/claim", "/storefront/coupons", "/storefront/orders/preview"]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0][1].data)), { code: "SAVE10" });
  assert.equal(h.requests[2][1].data.couponClaimId, "claim-1"); assert.equal("couponCode" in h.requests[2][1].data, false);
});

test("checkout creates an order, launches payment immediately and returns to the order list after confirmation", async () => {
  const fingerprint = "q1:" + "b".repeat(64);
  const quote = { fingerprint, pricingVersion: 1, lines: [], subtotalCents: 1000, couponDiscountCents: 0, pointDiscountCents: 0, shippingCents: 0, payableCents: 1000 };
  const payments = { createOrderPayment: async (...args) => { payments.created.push(args); return { id: "payment-1", status: "pending", invoke: { channel: "wechat_jsapi" } }; },
    invokePayment: async (...args) => { payments.invoked.push(args); return {}; }, confirmPayment: async (...args) => { payments.confirmed.push(args); return { paid: true }; },
    created: [], invoked: [], confirmed: [] };
  const h = orderPage("checkout", async (path) => {
    if (path === "/storefront/orders/preview") return { quote };
    if (path === "/storefront/orders") return { id: "order-1" };
    throw new Error(`Unexpected API call ${path}`);
  }, payments), s = h.state;
  h.storage.set("saidian-user", { id: "member-1" }); h.storage.set("checkout-owner", "member-1");
  s.items.value = [{ skuId: "sku-1", quantity: 1 }]; s.address.value = { id: "address-1" }; s.quote.value = quote;
  s.capabilities.value = { checkout: { enabled: true }, maintenance: { readOnly: false }, payments: [{ channel: "wechat_jsapi", enabled: true }] };
  await s.submit();
  assert.deepEqual(h.requests.map(row => row[0]), ["/storefront/orders/preview", "/storefront/orders"]);
  assert.deepEqual(payments.created, [["order-1", "wechat_jsapi"]]); assert.equal(payments.invoked.length, 1); assert.deepEqual(payments.confirmed, [["payment-1"]]);
  assert.deepEqual(h.navigations, ["/pages/orders/index"]); assert.equal(h.cleared(), 1);
});

test("checkout only offers payment for the current browser and honors an explicitly closed market", async () => {
  const h = orderPage("checkout"), s = h.state;
  s.address.value = { id: "synthetic-address" }; s.quote.value = { payableCents: 100, lines: [] };
  s.capabilities.value = { checkout: { enabled: true }, payments: [{ channel: "wechat_h5", enabled: true }] };
  assert.equal(button(h.tree(), "立即付款").props.disabled, true);
  s.capabilities.value.payments.push({ channel: "wechat_jsapi", enabled: true });
  assert.equal(Boolean(button(h.tree(), "立即付款").props.disabled), false);
  s.capabilities.value.checkout.enabled = false;
  assert.equal(button(h.tree(), "立即付款").props.disabled, true);
  await s.submit(); assert.deepEqual(h.requests, []);
  s.uncertain.value = true; s.quote.value = null; s.address.value = null;
  assert.equal(Boolean(button(h.tree(), "查询并继续付款").props.disabled), false);
  s.capabilities.value.maintenance = { readOnly: true };
  assert.equal(button(h.tree(), "查询并继续付款").props.disabled, true);
});

async function addressPage(realmName, existing) {
  const { script } = compilePage("address-edit"), hooks = {}, requests = [], notices = [], storage = new Map();
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key), getStorageInfoSync: () => ({ keys: [...storage.keys()] }), showToast() {}, navigateBack() {} };
  const { realm } = realmTestModules(uni, { env: realmName === "global" ? { VITE_APP_REALM: "global" } : {} });
  realm.mallStorage.set("saidian-user", { id: "synthetic-member" });
  const component = evaluate(script.content, { vue, "../../realm": realm,
    "@dcloudio/uni-app": { onLoad: callback => hooks.load = callback },
    "../../china-area": chinaArea,
    "../../api": { api: async (path, input) => { requests.push({ path, input }); return existing ? [existing] : []; }, toast: value => notices.push(value) },
  }, { uni, setTimeout: callback => callback() }).default;
  const state = component.setup({}, { expose() {} });
  await hooks.load(existing ? { id: existing.id } : {});
  return { state, requests, notices };
}
const delivery = { name: "测试收货人", mobile: "13800138000", province: "测试省", city: "测试市", district: "测试区", detail: "测试地址，不真实发货" };
test("global address submits CN and +86 while domestic address keeps its original contract", async () => {
  for (const realm of ["global", "domestic"]) {
    const h = await addressPage(realm); Object.assign(h.state.form, delivery); await h.state.save();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].input.method, "POST");
    assert.equal(h.requests[0].input.data.mobile, realm === "global" ? "+8613800138000" : "13800138000");
    assert.equal(h.requests[0].input.data.countryCode, realm === "global" ? "CN" : undefined);
  }
});
test("address region selector links province, city and district and submits their codes", async () => {
  const h = await addressPage("global");
  const indexes = chinaArea.mainlandRegionIndexes({ province: "广东省", city: "深圳市", district: "南山区" });
  h.state.confirmRegion({ detail: { value: indexes } });
  assert.equal(h.state.regionText.value, "广东省 / 深圳市 / 南山区");
  Object.assign(h.state.form, { name: "测试收货人", mobile: "13800138000", detail: "科技园路 8 号 2 栋 1201" });
  await h.state.save();
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].input.data)), {
    name: "测试收货人", mobile: "+8613800138000", province: "广东省", provinceCode: "440000",
    city: "深圳市", cityCode: "440300", district: "南山区", districtCode: "440305",
    detail: "科技园路 8 号 2 栋 1201", isDefault: false, countryCode: "CN",
  });
});
test("editing a CN address neither doubles the country prefix nor loses its identity", async () => {
  const h = await addressPage("global", { ...delivery, id: "address-1", mobile: "+8613800138000", countryCode: "CN" });
  assert.equal(h.state.form.mobile, "13800138000"); await h.state.save();
  assert.equal(h.requests[1].input.data.id, "address-1"); assert.equal(h.requests[1].input.data.mobile, "+8613800138000");
});
test("editing an unsupported existing delivery country never silently rewrites it to CN", async () => {
  const h = await addressPage("global", { ...delivery, id: "address-us", countryCode: "US", mobile: "+12025550123" });
  await h.state.save(); assert.equal(h.requests.length, 1); assert.equal(h.state.form.countryCode, "US");
  assert.match(h.notices[0], /仅支持中国大陆/);
});
