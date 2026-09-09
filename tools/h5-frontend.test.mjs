// No browser, network, test framework, or database required. Runs the real TS modules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

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
  const api = load("apps/shop/src/api.ts", { uni, getCurrentPages: () => [{ route: "pages/checkout/index", options: {} }] }, { "./commerce-model": model });
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
