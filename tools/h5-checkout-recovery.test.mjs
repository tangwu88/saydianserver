// Execute the real checkout script with isolated in-memory Vue/uni/API adapters.
// No browser, database, network or mutable runtime profile is used.
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
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function evaluate(source, globals = {}, imports = {}) {
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, Error, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected import: " + name); return imports[name]; } });
  return module.exports;
}
const model = evaluate(readFileSync(resolve(repo, "apps/shop/src/commerce-model.ts"), "utf8"));
const script = readFileSync(resolve(repo, "apps/shop/src/pages/checkout/index.vue"), "utf8")
  .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] +
  "\nexport const testHandles={submit,items,address,quote,uncertain,submitting,error,quoteNeedsConfirmation,capabilities};";
const tick = () => new Promise(resolve => setImmediate(resolve));
const quoteToken = "q1:" + "a".repeat(64);
const quoted = { quote: { fingerprint: quoteToken, subtotalCents: 100, payableCents: 100, lines: [] } };
function fixture(options = {}) {
  let nextQuote = options.quote || quoted;
  const storage = new Map([["saidian-user", { id: "H5-TEST-A" }], ["checkout-owner", "H5-TEST-A"]]);
  const quoteWait = [], createWait = [], createReject = [], calls = [], redirects = [], errors = [], orders = new Map();
  async function api(path, request) {
    if (path.endsWith("/preview")) {
      calls.push({ kind: "quote" });
      return options.deferQuote ? new Promise(resolve => quoteWait.push(resolve)) : nextQuote;
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
      getSystemInfoSync: () => ({ windowWidth: 390 }),
    };
    const result = evaluate(script, { uni, setInterval: () => 1, clearInterval() {}, setTimeout: callback => { callback(); return 1; } }, {
      "../../realm": realmTestModules(uni, { repo }).realm,
      "vue": { ref: value => ({ value }), computed: callback => ({ get value() { return callback(); } }) },
      "@dcloudio/uni-app": { onShow() {}, onHide() {}, onUnload() {} },
      "../../api": { api, withMallCheckoutLock: callback => { options.beforeLock?.(storage); return callback(); }, mallSessionStamp: () => storage.get("saidian-user")?.id, money: value => String(value), requireLogin: () => true, toast: error => errors.push(String(error)), clearCheckoutState() {} },
      "../../commerce-model": model,
      "../../payments": {
        paymentEnvironment: () => "wechat",
        createOrderPayment: async orderId => ({ id: `PAY-${orderId}`, status: "pending", invoke: {} }),
        invokePayment: async () => ({}),
        confirmPayment: async () => ({ paid: false }),
      },
    }).testHandles;
    result.items.value = [{ skuId: "H5-TEST-SKU", quantity: 1 }];
    result.address.value = { id: "H5-TEST-ADDRESS" };
    result.quote.value = clone(options.displayedQuote || quoted.quote);
    result.capabilities.value = { checkout: { enabled: true }, maintenance: { readOnly: false }, payments: [{ channel: "wechat_jsapi", enabled: true }] };
    return result;
  }
  function switchAccount() {
    storage.set("saidian-user", { id: "H5-TEST-B" }); storage.set("checkout-owner", "H5-TEST-B");
    storage.delete("checkout-draft"); storage.delete("checkout-pending");
  }
  return { storage, quoteWait, createWait, createReject, calls, redirects, errors, orders, instance, switchAccount, setQuote(value) { nextQuote = value; } };
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
  assert.match(product, /uncertain[\s\S]*?restoreCheckout\(\)/);
  assert.match(cart, /uncertain[\s\S]*?navigateTo\(\{url:'\/pages\/checkout\/index'\}\)/);
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

const detailedQuote = () => ({ fingerprint: quoteToken, pricingVersion: 1, subtotalCents: 1000, couponDiscountCents: 100, pointDiscountCents: 200, shippingCents: 50, payableCents: 750,
  lines: [{ skuId: "H5-TEST-SKU", quantity: 1, unitPriceCents: 1000, totalCents: 1000, couponDiscountCentsSnapshot: 100, pointDiscountCentsSnapshot: 200, cashPaidCentsSnapshot: 700 }] });
test("a changed checkout quote pauses before creating a key, then a second click confirms the new amount", async () => {
  const old = detailedQuote(), changed = { ...old, shippingCents: 100, payableCents: 800 };
  const h = fixture({ displayedQuote: old, quote: { quote: changed } }), page = h.instance();
  await page.submit();
  assert.equal(page.quoteNeedsConfirmation.value, true); assert.match(page.error.value, /再次确认/); assert.equal(page.quote.value.payableCents, 800);
  assert.equal(h.calls.filter(x => x.kind === "create").length, 0); assert.equal(h.storage.has("checkout-draft"), false);
  await page.submit();
  assert.equal(h.calls.filter(x => x.kind === "create").length, 1); assert.equal(page.quoteNeedsConfirmation.value, false); assert.equal(h.orders.size, 1);
});
test("coupon, points, line price and freight changes require confirmation even with unchanged final cash", async () => {
  const old = detailedQuote();
  for (const changed of [
    { ...old, couponDiscountCents: 50, pointDiscountCents: 250 },
    { ...old, couponDiscountCents: 150, shippingCents: 100 },
    { ...old, lines: [{ ...old.lines[0], unitPriceCents: 1100, totalCents: 1100 }] },
    { ...old, lines: [{ ...old.lines[0], pointDiscountCentsSnapshot: 150, cashPaidCentsSnapshot: 750 }] },
  ]) {
    const h = fixture({ displayedQuote: old, quote: { quote: changed } }), page = h.instance(); await page.submit();
    assert.equal(page.quoteNeedsConfirmation.value, true); assert.equal(h.calls.filter(x => x.kind === "create").length, 0);
  }
});
test("a second price change pauses again, while copy-only changes do not require another confirmation", async () => {
  const old = detailedQuote(), h = fixture({ displayedQuote: old, quote: { quote: { ...old, payableCents: 800 } } }), page = h.instance();
  await page.submit(); h.setQuote({ quote: { ...old, payableCents: 850 } }); await page.submit();
  assert.equal(h.calls.filter(x => x.kind === "create").length, 0); assert.equal(page.quote.value.payableCents, 850);
  h.setQuote({ quote: { ...old, payableCents: 850, availablePointCents: 9000, lines: [{ ...old.lines[0], name: "New display name", image: "new.jpg" }] } });
  await page.submit(); assert.equal(h.calls.filter(x => x.kind === "create").length, 1);
});
test("a confirmed quote with an unknown create result still recovers its exact key without a new quote", async () => {
  const old = detailedQuote(), h = fixture({ deferCreate: true, displayedQuote: old, quote: { quote: { ...old, payableCents: 800 } } }), page = h.instance();
  await page.submit(); const pending = page.submit(); await tick();
  const frozen = clone(h.storage.get("checkout-draft")); h.createReject[0](new Error("request timeout")); await pending;
  const quoteCount = h.calls.filter(x => x.kind === "quote").length;
  h.setQuote({ quote: { ...old, payableCents: 900 } }); const recover = page.submit(); await tick();
  assert.equal(h.calls.filter(x => x.kind === "quote").length, quoteCount);
  const creates = h.calls.filter(x => x.kind === "create"); assert.equal(creates[1].key, frozen.key); assert.deepEqual(creates[1].payload, frozen.payload);
  h.createWait[1](); await recover; assert.equal(h.orders.size, 1);
});

test("new orders carry the server quote condition and unknown results retain it", async () => {
  const h = fixture({ deferCreate: true }), page = h.instance(), pending = page.submit(); await tick();
  const draft = clone(h.storage.get("checkout-draft"));
  assert.equal(draft.payload.expectedQuote, quoteToken);
  h.createReject[0](new Error("timeout")); await pending;
  const retry = page.submit(); await tick();
  assert.equal(h.calls.filter(x => x.kind === "quote").length, 1);
  assert.equal(h.calls.filter(x => x.kind === "create")[1].payload.expectedQuote, quoteToken);
  h.createWait[1](); await retry;
});

test("missing server quote conditions fail closed only for new orders", async () => {
  for (const fingerprint of [undefined, "", "invalid"]) {
    const h = fixture({ quote: { quote: { ...quoted.quote, fingerprint } } }), page = h.instance();
    await page.submit();
    assert.equal(h.calls.filter(x => x.kind === "create").length, 0); assert.match(page.error.value, /报价凭据/);
    assert.equal(h.storage.has("checkout-draft"), false);
  }
});

test("a server quote conflict keeps no pending order and the next confirmed quote uses its own condition", async () => {
  const h = fixture({ deferCreate: true }), page = h.instance(), pending = page.submit(); await tick();
  const first = clone(h.storage.get("checkout-draft"));
  h.createReject[0](Object.assign(new Error("订单金额已变更，请重新获取报价并确认后提交"), { status: 409, errorKey: "quote_changed" })); await pending;
  assert.equal(h.storage.get("checkout-draft").uncertain, false); assert.equal(h.storage.has("checkout-pending"), false); assert.equal(h.redirects.length, 0);
  assert.match(page.error.value, /金额已变更/);
  const nextToken = "q1:" + "b".repeat(64);
  h.setQuote({ quote: { ...quoted.quote, fingerprint: nextToken, payableCents: 120 } });
  await page.submit(); assert.equal(h.calls.filter(x => x.kind === "create").length, 1);
  const retry = page.submit(); await tick();
  const second = h.calls.filter(x => x.kind === "create")[1];
  assert.notEqual(second.key, first.key); assert.equal(second.payload.expectedQuote, nextToken);
  h.createWait[1](); await retry;
});

test("a same-key in-progress response remains uncertain and retries the frozen condition", async () => {
  const h = fixture({ deferCreate: true }), page = h.instance(), pending = page.submit(); await tick();
  const original = clone(h.storage.get("checkout-draft"));
  h.createReject[0](Object.assign(new Error("订单正在确认，请保留当前订单内容并稍后重试"), { status: 503, errorKey: "order_in_progress" })); await pending;
  assert.equal(h.storage.get("checkout-draft").uncertain, true);
  const retry = page.submit(); await tick();
  const creates = h.calls.filter(x => x.kind === "create");
  assert.equal(creates[1].key, original.key); assert.deepEqual(creates[1].payload, original.payload);
  assert.equal(h.calls.filter(x => x.kind === "quote").length, 1);
  h.createWait[1](); await retry;
});

test("an explicitly closed market only replays the existing owned frozen request and never requotes", async () => {
  const h = fixture(), page = h.instance();
  const draft = { userId: "H5-TEST-A", key: "frozen-before-market-closed", uncertain: true, payload: { addressId: "old-address", items: [{ skuId: "old-sku", quantity: 1 }], expectedQuote: quoteToken } };
  h.storage.set("checkout-draft", draft); page.uncertain.value = true; page.address.value = null; page.quote.value = null;
  page.capabilities.value = { checkout: { enabled: false } };
  await page.submit(); assert.deepEqual(h.calls, [{ kind: "create", key: draft.key, payload: draft.payload }]);
  assert.equal(h.storage.get("checkout-pending").userId, "H5-TEST-A");
});

test("closed-market replay refuses a stale uncertain flag, foreign draft, missing payload or removal while acquiring the lock", async () => {
  const draft = { userId: "H5-TEST-A", key: "frozen-before-market-closed", uncertain: true, payload: { addressId: "address", items: [{ skuId: "sku", quantity: 1 }] } };
  for (const value of [undefined, { ...draft, uncertain: false }, { ...draft, userId: "H5-TEST-B" }, { ...draft, payload: undefined }, { ...draft, key: "short" }]) {
    const h = fixture(), page = h.instance(); if (value) h.storage.set("checkout-draft", value);
    page.uncertain.value = true; page.capabilities.value = { checkout: { enabled: false } };
    await page.submit(); assert.deepEqual(h.calls, []); assert.equal(h.storage.has("checkout-pending"), false);
  }
  const h = fixture({ beforeLock: storage => storage.delete("checkout-draft") }), page = h.instance();
  h.storage.set("checkout-draft", draft); page.uncertain.value = true; page.capabilities.value = { checkout: { enabled: false } };
  await page.submit(); assert.deepEqual(h.calls, []); assert.match(page.error.value, /暂停新下单/);
});

test("maintenance still blocks a frozen replay and a closed market blocks fresh orders", async () => {
  for (const recovering of [true, false]) {
    const h = fixture(), page = h.instance();
    h.storage.set("checkout-draft", { userId: "H5-TEST-A", key: "frozen-maintenance", uncertain: recovering, payload: {} });
    page.uncertain.value = recovering; page.capabilities.value = { checkout: { enabled: false }, maintenance: { readOnly: recovering } };
    await page.submit(); assert.deepEqual(h.calls, []); assert.equal(h.storage.has("checkout-pending"), false);
  }
});
