// Execute the real checkout script with isolated in-memory Vue/uni/API adapters.
// No browser, database, network or mutable runtime profile is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const repo = process.env.H5_TEST_REPO || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(resolve(repo, "apps/api/package.json"))("typescript");
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function evaluate(source, globals = {}, imports = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected import: " + name); return imports[name]; } });
  return module.exports;
}
const model = evaluate(readFileSync(resolve(repo, "apps/shop/src/commerce-model.ts"), "utf8"));
const script = readFileSync(resolve(repo, "apps/shop/src/pages/checkout/index.vue"), "utf8")
  .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] +
  "\nexport const testHandles={submit,items,address,quote,uncertain,submitting};";
const tick = () => new Promise(resolve => setImmediate(resolve));
const quoted = { quote: { subtotalCents: 100, payableCents: 100, lines: [] } };
function fixture(options = {}) {
  const storage = new Map([["saidian-user", { id: "H5-TEST-A" }], ["checkout-owner", "H5-TEST-A"]]);
  const quoteWait = [], createWait = [], createReject = [], calls = [], redirects = [], errors = [], orders = new Map();
  async function api(path, request) {
    if (path.endsWith("/preview")) {
      calls.push({ kind: "quote" });
      return options.deferQuote ? new Promise(resolve => quoteWait.push(resolve)) : quoted;
    }
    assert.equal(path, "/storefront/orders");
    const key = request.headers["idempotency-key"];
    calls.push({ kind: "create", key, payload: clone(request.data) });
    if (!orders.has(key)) orders.set(key, { id: "H5-TEST-ORDER-" + (orders.size + 1) });
    const response = orders.get(key);
    return options.deferCreate ? new Promise((resolve, reject) => { createWait.push(() => resolve(response)); createReject.push(reject); }) : response;
  }
  function instance() {
    const uni = {
      getStorageSync: key => clone(storage.get(key)), setStorageSync: (key, value) => storage.set(key, clone(value)),
      removeStorageSync: key => storage.delete(key), redirectTo: options => redirects.push(options.url),
    };
    const result = evaluate(script, { uni }, {
      "vue": { ref: value => ({ value }), computed: callback => ({ get value() { return callback(); } }) },
      "@dcloudio/uni-app": { onShow() {} },
      "../../api": { api, withMallCheckoutLock: callback => callback(), mallSessionStamp: () => storage.get("saidian-user")?.id, money: value => String(value), requireLogin: () => true, toast: error => errors.push(String(error)) },
      "../../commerce-model": model,
    }).testHandles;
    result.items.value = [{ skuId: "H5-TEST-SKU", quantity: 1 }];
    result.address.value = { id: "H5-TEST-ADDRESS" };
    result.quote.value = quoted.quote;
    return result;
  }
  function switchAccount() {
    storage.set("saidian-user", { id: "H5-TEST-B" }); storage.set("checkout-owner", "H5-TEST-B");
    storage.delete("checkout-draft"); storage.delete("checkout-pending");
  }
  return { storage, quoteWait, createWait, createReject, calls, redirects, errors, orders, instance, switchAccount };
}
test("unknown create result recovers exactly the frozen key and payload without re-quoting", async () => {
  const h = fixture(), page = h.instance();
  const draft = { userId: "H5-TEST-A", uncertain: true, key: "H5-TEST-FROZEN-KEY",
    payload: { addressId: "H5-TEST-OLD-ADDRESS", items: [{ skuId: "H5-TEST-OLD-SKU", quantity: 2 }], pointCents: 900 } };
  h.storage.set("checkout-draft", draft); page.uncertain.value = true;
  await page.submit();
  assert.equal(h.calls.filter(call => call.kind === "quote").length, 0);
  assert.deepEqual(h.calls[0], { kind: "create", key: draft.key, payload: draft.payload });
  assert.equal(h.storage.has("checkout-draft"), false);
  assert.equal(h.storage.get("checkout-pending").userId, "H5-TEST-A");
});
test("a second checkout re-reads an in-flight draft after its quote and reuses the same key", async () => {
  const h = fixture({ deferQuote: true, deferCreate: true });
  const a = h.instance(), b = h.instance(), pa = a.submit(), pb = b.submit();
  assert.equal(h.quoteWait.length, 2);
  h.quoteWait[0](quoted); await tick();
  assert.equal(h.storage.get("checkout-draft").uncertain, true);
  h.quoteWait[1](quoted); await tick();
  const creates = h.calls.filter(call => call.kind === "create");
  assert.equal(creates.length, 2); assert.equal(creates[0].key, creates[1].key);
  assert.deepEqual(creates[0].payload, creates[1].payload); assert.equal(h.orders.size, 1);
  h.createWait.forEach(resolve => resolve()); await Promise.all([pa, pb]);
});
test("a delayed quote cannot create a new key after another checkout already received its order", async () => {
  const h = fixture({ deferQuote: true }), a = h.instance(), b = h.instance();
  const pa = a.submit(), pb = b.submit();
  h.quoteWait[0](quoted); await pa;
  assert.ok(h.storage.get("checkout-pending").orderId);
  h.quoteWait[1](quoted); await pb;
  assert.equal(h.calls.filter(call => call.kind === "create").length, 1);
  assert.equal(h.orders.size, 1);
  assert.ok(h.redirects.every(url => url.includes("H5-TEST-ORDER-1")));
});
test("account change while quoting prevents a request using stale checkout fields", async () => {
  const h = fixture({ deferQuote: true }), pending = h.instance().submit();
  h.switchAccount(); h.quoteWait[0](quoted); await pending;
  assert.equal(h.calls.filter(call => call.kind === "create").length, 0);
  assert.equal(h.storage.has("checkout-draft"), false);
  assert.ok(h.errors.some(error => error.includes("账号")));
});
test("late create response cannot write the previous account's pending order after an account switch", async () => {
  const h = fixture({ deferCreate: true }), pending = h.instance().submit();
  await tick(); assert.equal(h.createWait.length, 1);
  h.switchAccount(); h.createWait[0](); await pending;
  assert.equal(h.storage.has("checkout-pending"), false);
  assert.equal(h.storage.get("saidian-user").id, "H5-TEST-B");
  assert.equal(h.redirects.length, 0);
});
test("unknown-result recovery is reachable even after stock/cart was consumed", () => {
  const product = readFileSync(resolve(repo, "apps/shop/src/pages/product/index.vue"), "utf8").split("function buyNow()")[1].split("function toggleFavorite")[0];
  const cart = readFileSync(resolve(repo, "apps/shop/src/pages/cart/index.vue"), "utf8").split("function checkout()")[1].split("function shop")[0];
  for (const source of [product, cart]) assert.match(source, /uncertain[\s\S]*?navigateTo\(\{url:'\/pages\/checkout\/index'\}\)/);
  assert.ok(product.indexOf("uncertain") < product.indexOf("if (!ensure())"));
  assert.ok(cart.indexOf("uncertain") < cart.indexOf("if (!selected.value.length)"));
});
test("a late business rejection cannot clear another request's unknown state", async () => {
  const h = fixture({ deferCreate: true }), pending = h.instance().submit(); await tick();
  const newer = { key: "H5-TEST-NEWER-KEY", userId: "H5-TEST-A", uncertain: true };
  h.storage.set("checkout-draft", newer);
  h.createReject[0](Object.assign(new Error("old rejection"), { status: 409 })); await pending;
  assert.deepEqual(h.storage.get("checkout-draft"), newer);
});
test("a definite rejection clears only the same owned request's unknown flag", async () => {
  const h = fixture({ deferCreate: true }), pending = h.instance().submit(); await tick();
  const original = clone(h.storage.get("checkout-draft"));
  h.createReject[0](Object.assign(new Error("definite validation error"), { status: 400 })); await pending;
  assert.deepEqual(h.storage.get("checkout-draft"), { ...original, uncertain: false });
});
