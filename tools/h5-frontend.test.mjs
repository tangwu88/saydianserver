// No browser, network, test framework, or database required. Runs the real TS modules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { realmTestModules } from "./h5-realm-fixture.mjs";

const repo = process.env.H5_TEST_REPO || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(resolve(repo, "apps/api/package.json"))("typescript");
function load(relative, globals = {}, imports = {}) {
  let source = readFileSync(resolve(repo, relative), "utf8");
  // Match the H5 compiler's exclusion of MP-WEIXIN branches.
  source = source.replace(/\/\* #ifdef MP-WEIXIN \*\/[\s\S]*?\/\* #endif \*\//g, "");
  source = source.replace(/import\.meta\.env/g, '({ VITE_API_BASE: "/api/saidian-mall/v1" })');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected import: " + name); return imports[name]; },
  }, { filename: relative });
  return module.exports;
}
const model = load("apps/shop/src/commerce-model.ts");
const normalize = (value) => JSON.parse(JSON.stringify(value));

test("realm fixture executes storage isolation with scoped customer and employee promotion routes", () => {
  const storage = new Map(), uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) };
  const domestic = realmTestModules(uni, { repo }), global = realmTestModules(uni, { repo, env: { VITE_APP_REALM: "global" } });
  domestic.realm.mallStorage.set("saidian-token", "domestic-test"); global.realm.mallStorage.set("saidian-token", "global-test");
  assert.equal(domestic.realm.mallStorage.get("saidian-token"), "domestic-test"); assert.equal(global.realm.mallStorage.get("saidian-token"), "global-test");
  assert.equal(domestic.realm.mallStorageKey("checkout-draft"), "checkout-draft"); assert.equal(global.realm.mallStorageKey("checkout-draft"), "saydian-global-mall:checkout-draft");
  assert.equal(domestic.realm.isGlobalMall, false); assert.equal(global.realm.isGlobalMall, true);
  assert.equal(global.config.globalApiAllowed("/storefront/orders", "POST"), true); assert.equal(global.config.globalPageAllowed("/pages/checkout/index"), true);
  assert.equal(global.config.globalApiAllowed("/wecom/oauth", "POST"), true); assert.equal(global.config.globalPageAllowed("/pages/employee/index"), true);
  assert.equal(global.config.globalApiAllowed("/auth/referral", "POST"), true); assert.equal(global.config.globalApiAllowed("/wecom/oauth", "GET"), false);
});

test("legacy orders without item snapshots remain unknown and canonical orders retain quantity", () => {
  for (const order of [undefined, null, { readOnly: true, source: "legacy", snapshot: { goods: [] } },
    { items: null }, { items: [] }, { items: {} }, { items: [null] }, { items: [{ quantity: "2" }] },
    { items: [{ quantity: 0 }] }, { items: [{ quantity: 1.5 }] }]) {
    assert.deepEqual(normalize(model.orderItemSummary(order)), { items: [], quantity: null });
  }
  const canonical = { items: [{ id: "line-A", quantity: 2, unitPriceCents: 100 }, { id: "line-B", quantity: 3, unitPriceCents: 200 }] };
  assert.deepEqual(normalize(model.orderItemSummary(canonical)), { items: canonical.items, quantity: 5 });
  assert.deepEqual(canonical.items.map(item => item.quantity), [2, 3]);
  assert.equal(model.orderItemSummary({ items: [{ quantity: Number.MAX_SAFE_INTEGER }, { quantity: 1 }] }).quantity, null);
  for (const relative of ["apps/shop/src/pages/orders/index.vue", "apps/shop/src/pages/order-detail/index.vue"]) {
    const source = readFileSync(resolve(repo, relative), "utf8");
    assert.match(source, /orderItemSummary\(order\)/);
    assert.doesNotMatch(source, /order\.items\.reduce/);
    assert.match(source, /历史订单 · 只读/);
    assert.match(source, /未获取/);
  }
});

test("money parsing uses exact cents and rejects invalid precision", () => {
  for (const [input, expected] of [["0", 0], ["0.01", 1], ["1.1", 110], ["123.45", 12345]]) assert.equal(model.parseMoneyCents(input), expected);
  for (const input of ["", "-1", "1.001", "1e2", "NaN", "Infinity", "1,000", "1000000000"]) assert.throws(() => model.parseMoneyCents(input));
});
test("post-login routes remain internal and exclude login loops", () => {
  assert.equal(model.safeMallRoute("/pages/orders/index?status=PAID"), "/pages/orders/index?status=PAID");
  for (const input of ["https://example.invalid", "//example.invalid", "javascript:alert(1)", "/pages/login/index", "/pages/../index", "/pages/orders/index?x=\\bad", "/pages/orders/index?x=\r\n"]) assert.equal(model.safeMallRoute(input), "/pages/profile/index");
});
test("checkout fingerprint is stable for item ordering but bound to account and values", () => {
  const base = { addressId: "address-A", items: [{ skuId: "sku-B", quantity: 2 }, { skuId: "sku-A", quantity: 1 }], pointCents: 100 };
  const fingerprint = model.checkoutFingerprint("member-A", base);
  assert.equal(fingerprint, model.checkoutFingerprint("member-A", { ...base, items: [...base.items].reverse() }));
  assert.notEqual(fingerprint, model.checkoutFingerprint("member-B", base));
  for (const change of [{ addressId: "address-B" }, { pointCents: 101 }, { couponClaimId: "coupon" }, { buyerRemark: "changed" }, { items: [{ skuId: "sku-A", quantity: 2 }] }]) assert.notEqual(fingerprint, model.checkoutFingerprint("member-A", { ...base, ...change }));
});
test("payment channels follow environment, and pending is not paid", () => {
  const channels = ["wechat_jsapi", "wechat_mini", "wechat_native", "wechat_h5", "alipay_wap", "alipay_page"].map(channel => ({ channel }));
  assert.deepEqual(normalize(model.channelsForEnvironment(channels, "wechat", false)).map(x => x.channel), ["wechat_jsapi"]);
  assert.deepEqual(normalize(model.channelsForEnvironment(channels, "mini", false)).map(x => x.channel), ["wechat_mini"]);
  assert.deepEqual(normalize(model.channelsForEnvironment(channels, "browser", true)).map(x => x.channel), ["wechat_native", "alipay_page"]);
  assert.deepEqual(normalize(model.channelsForEnvironment(channels, "browser", false)).map(x => x.channel), ["wechat_h5", "alipay_wap"]);
  assert.equal(model.isPaidStatus("PENDING"), false);
  assert.equal(model.isPaidStatus("SUCCEEDED"), true);
});

function sessionHarness() {
  const storage = new Map(), requests = [], navigations = [];
  const uni = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key),
    request: options => requests.push(options),
    navigateTo: options => { navigations.push(options.url); options.complete?.(); },
    login: () => assert.fail("H5 must not invoke mini-program login"),
    showToast() {},
  };
  const { realm, config } = realmTestModules(uni, { repo });
  const api = load("apps/shop/src/api.ts", { uni, getCurrentPages: () => [{ route: "pages/checkout/index", options: {} }] }, { "./commerce-model": model, "./realm": realm, "./realm-config": config });
  return { api, storage, requests, navigations };
}
const session = id => ({ token: "test-access-" + id, refreshToken: "test-refresh-" + id, user: { id } });
const checkoutKeys = ["checkout-items", "checkout-address", "checkout-draft", "checkout-pending", "checkout-cart-ids"];
function addCheckout(storage) { for (const key of checkoutKeys) storage.set(key, "test-" + key); }

test("old account refresh cannot overwrite or clear a newer login", async () => {
  const h = sessionHarness(); h.api.saveMallSession(session("member-A"));
  const pending = h.api.api("/storefront/orders", { auth: true });
  const rejected = assert.rejects(pending, /账号已切换|登录已失效|unauthorized/);
  const handling = h.requests[0].success({ statusCode: 401, data: { message: "unauthorized" } });
  assert.equal(h.requests[1].url, "/api/saidian-mall/v1/auth/refresh");
  h.api.saveMallSession(session("member-B"));
  h.requests[1].success({ statusCode: 200, data: session("member-A-refreshed") });
  await handling; await rejected;
  assert.equal(h.storage.get("saidian-token"), "test-access-member-B");
  assert.equal(h.storage.get("saidian-user").id, "member-B");
  assert.equal(h.navigations.length, 0);
});
test("same member can recover an uncertain checkout after session expiry", async () => {
  const h = sessionHarness(); h.api.saveMallSession(session("member-A")); addCheckout(h.storage);
  const pending = h.api.api("/storefront/orders", { auth: true });
  const rejected = assert.rejects(pending, /expired/);
  const handling = h.requests[0].success({ statusCode: 401, data: { message: "expired" } });
  h.requests[1].success({ statusCode: 401, data: {} }); await handling; await rejected;
  assert.equal(h.storage.has("saidian-token"), false);
  assert.equal(h.storage.get("checkout-owner"), "member-A");
  h.api.saveMallSession(session("member-A"));
  for (const key of checkoutKeys) assert.equal(h.storage.get(key), "test-" + key);
});
test("switching member clears customer checkout but preserves employee identity", () => {
  const h = sessionHarness(); h.api.saveMallSession(session("member-A")); addCheckout(h.storage);
  h.storage.set("employee-token", "test-independent-employee-token");
  h.api.clearMallSession(true); h.api.saveMallSession(session("member-B"));
  for (const key of checkoutKeys) assert.equal(h.storage.has(key), false, key);
  assert.equal(h.storage.get("checkout-owner"), "member-B");
  assert.equal(h.storage.get("employee-token"), "test-independent-employee-token");
  h.api.clearMallSession();
  assert.equal(h.storage.has("checkout-owner"), false);
  assert.equal(h.storage.get("employee-token"), "test-independent-employee-token");
});
test("unknown money remains unknown instead of a fake zero", () => {
  const { api } = sessionHarness();
  assert.equal(api.money(null), "未获取"); assert.equal(api.money(undefined), "未获取");
  assert.equal(api.money(Number.NaN), "未获取"); assert.equal(api.money(0), "¥0.00");
  assert.equal(api.money(1250), "¥12.50");
});
test("public SKU projection excludes cost, ERP identifiers, and future private fields", () => {
  const { publicSku } = load("apps/api/src/commerce/commerce-public-sku.ts");
  const visible = { id: "sku-test", specification: "测试规格", image: null, salePriceCents: 1000, marketPriceCents: null, stock: 2, enabled: true };
  const result = publicSku({ ...visible, costPriceCents: 900, erpSkuId: "private-erp", supplierSecretFuture: "must-not-leak", product: { privateField: true } });
  assert.deepEqual(normalize(result), visible);
});

function shoppingPage(page, handles) {
  const requests = [], messages = [], hooks = { onLoad: [], onShow: [], onHide: [], onUnload: [] };
  const uni = { getStorageSync() {}, setStorageSync() {}, removeStorageSync() {} };
  const { realm } = realmTestModules(uni, { repo });
  const text = readFileSync(resolve(repo, `apps/shop/src/pages/${page}/index.vue`), "utf8").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] + `\nexport const handles={${handles}};`;
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const imports = {
    "vue": { ref: value => ({ value }), reactive: value => value, computed: fn => ({ get value() { return fn(); } }) },
    "@dcloudio/uni-app": Object.fromEntries(Object.keys(hooks).map(key => [key, fn => hooks[key].push(fn)])),
    "../../realm": realm, "../../commerce-model": model,
    "../../api": { api: (path, input) => new Promise((resolve, reject) => requests.push({ path, input, resolve, reject })), toast: value => messages.push(String(value)), money: String },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Error, uni, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { ...module.exports.handles, requests, messages, hooks };
}

test("cart minus clamps an overstocked quantity to actual stock and never sends a zero quantity", async () => {
  const h = shoppingPage("cart", "update,cart,busy");
  const item = { skuId: "sku-A", quantity: 5, selected: true, sku: { stock: 2 } };
  const pending = h.update(item, 4, true);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].input.data.quantity, 2);
  h.requests[0].resolve({ items: [{ ...item, quantity: 2 }] }); await pending;
  assert.equal(h.cart.items[0].quantity, 2); assert.equal(h.busy.value, false);
  await h.update({ ...item, sku: { stock: 0 } }, 4, true);
  assert.equal(h.requests.length, 1); assert.match(h.messages.at(-1), /缺货/);
});
test('cart selected count represents item quantities rather than distinct SKU rows',()=>{
  const h=shoppingPage('cart','cart,selectedQuantity');
  h.cart.items=[{selected:true,available:true,quantity:2},{selected:true,available:true,quantity:3},{selected:false,available:true,quantity:7},{selected:true,available:false,quantity:4}];
  assert.equal(h.selectedQuantity.value,5);
});

test('cart loading failure stays visible until a successful retry instead of claiming an empty cart',async()=>{
  const h=shoppingPage('cart','load,cart,error,loading');
  const pending=h.load(); assert.equal(h.loading.value,true);
  h.requests[0].reject(new Error('network unavailable')); await pending;
  assert.equal(h.error.value,'network unavailable'); assert.equal(h.loading.value,false);
  const retry=h.load(); h.requests[1].resolve({items:[{id:'cart-row'}]}); await retry;
  assert.equal(h.error.value,''); assert.equal(h.cart.items[0].id,'cart-row');
  const source=readFileSync(resolve(repo,'apps/shop/src/pages/cart/index.vue'),'utf8');
  assert.match(source,/v-if="error"[^>]*role="alert"/);
  assert.match(source,/v-else-if="!error"/);
  assert.match(source,/重新加载购物车/);
});

test("cart keeps normal decrement and rejects increment beyond stock without duplicate updates", async () => {
  const h = shoppingPage("cart", "update,cart,busy"), item = { skuId: "sku-A", quantity: 2, selected: true, sku: { stock: 2 } };
  await h.update(item, 3, true); assert.equal(h.requests.length, 0);
  const pending = h.update(item, 1, true); await h.update(item, 1, true);
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].input.data.quantity, 1);
  h.requests[0].resolve({ items: [{ ...item, quantity: 1 }] }); await pending;
  assert.equal(h.cart.items[0].quantity, 1);
});

test("orders keeps the latest tab's result when an older status response arrives last", async () => {
  const h = shoppingPage("orders", "load,select,status,orders,error,loading");
  const first = h.load(); h.status.value = "SHIPPED"; const second = h.load();
  h.requests[1].resolve([{ id: "shipped-order" }]); await second;
  h.requests[0].resolve([{ id: "all-order" }]); await first;
  assert.equal(h.orders.value[0].id, "shipped-order"); assert.equal(h.status.value, "SHIPPED"); assert.equal(h.loading.value, false);
});

test("an old order failure cannot replace the new tab, and a current error remains retryable", async () => {
  const h = shoppingPage("orders", "load,select,status,orders,error,loading");
  const first = h.load(); const second = h.load();
  h.requests[1].resolve([{ id: "latest-order" }]); await second; h.requests[0].reject(new Error("old error")); await first;
  assert.equal(h.error.value, ""); assert.equal(h.orders.value[0].id, "latest-order");
  const failed = h.load(); h.requests[2].reject(new Error("network unavailable")); await failed;
  assert.equal(h.error.value, "network unavailable"); assert.equal(h.loading.value, false);
  const retry = h.load(); h.requests[3].resolve([]); await retry;
  assert.equal(h.error.value, ""); assert.equal(h.orders.value.length, 0);
});

test("hidden or unloaded order pages ignore responses and load fresh on return", async () => {
  for (const event of ["onHide", "onUnload"]) {
    const h = shoppingPage("orders", "load,orders,error,loading");
    const pending = h.load(); h.hooks[event].forEach(fn => fn()); h.requests[0].resolve([{ id: "hidden-order" }]); await pending;
    assert.equal(h.orders.value.length, 0);
    const visible = h.hooks.onShow[0](); h.requests[1].resolve([{ id: "fresh-order" }]); await visible;
    assert.equal(h.orders.value[0].id, "fresh-order"); assert.equal(h.loading.value, false);
  }
});
