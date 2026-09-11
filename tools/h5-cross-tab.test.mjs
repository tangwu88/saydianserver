// Runs actual API and checkout code in independent document VMs sharing storage and
// a deterministic LockManager implementation. No database, browser, or network.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { realmTestModules } from "./h5-realm-fixture.mjs";
const repo = process.env.H5_TEST_REPO || resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidate = process.env.H5_CANDIDATE_ROOT || "";
const ts = createRequire(resolve(repo, "apps/api/package.json"))("typescript");
const source = relative => readFileSync(candidate && existsSync(resolve(candidate, relative)) ? resolve(candidate, relative) : resolve(repo, relative), "utf8");
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = (id, revision = "original") => ({ token: "H5-UNIT-ACCESS-" + id + "-" + revision, refreshToken: "H5-UNIT-REFRESH-" + id + "-" + revision, user: { id } });
function evaluate(code, globals = {}, imports = {}, mini = false) {
  if (!mini) code = code.replace(/\/\* #ifdef MP-WEIXIN \*\/[\s\S]*?\/\* #endif \*\//g, "");
  code = code.replace(/import\.meta\.env/g, '({ VITE_API_BASE: "/api/saidian-mall/v1" })');
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, Error, ...globals,
    require(name) { assert.ok(Object.hasOwn(imports, name), "Unexpected import: " + name); return imports[name]; } });
  return module.exports;
}
const model = evaluate(source("apps/shop/src/commerce-model.ts"));
class TestLocks {
  held = new Set();
  queues = new Map();
  request(name, options, callback) {
    return new Promise((resolve, reject) => {
      if (options.ifAvailable && this.held.has(name)) {
        Promise.resolve().then(() => callback(null)).then(resolve, reject); return;
      }
      const queue = this.queues.get(name) || [];
      queue.push({ callback, resolve, reject }); this.queues.set(name, queue); this.drain(name);
    });
  }
  drain(name) {
    if (this.held.has(name)) return;
    const next = this.queues.get(name)?.shift();
    if (!next) return;
    this.held.add(name);
    Promise.resolve().then(() => next.callback({ name, mode: "exclusive" })).then(
      value => { this.held.delete(name); next.resolve(value); this.drain(name); },
      error => { this.held.delete(name); next.reject(error); this.drain(name); },
    );
  }
}
function environment(options = {}) {
  const original = session("H5-UNIT-A");
  const storage = new Map([
    ["saidian-token", original.token], ["saidian-refresh-token", original.refreshToken],
    ["saidian-user", original.user], ["checkout-owner", original.user.id],
    ["saidian-session-revision", "H5-UNIT-INITIAL"], ["saidian-session-commit", "H5-UNIT-INITIAL"],
    ["employee-token", "H5-UNIT-INDEPENDENT-EMPLOYEE"],
  ]);
  const locks = options.locks === undefined ? new TestLocks() : options.locks;
  const documents = [], events = [];
  function documentInstance() {
    const listeners = new Map(), documentListeners = new Map(), requests = [], navigations = [], writes = [];
    const current = { privateView: { owner: original.user.id }, requests, navigations, writes };
    const window = { localStorage: {}, addEventListener(name, callback) {
      const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list);
    } };
    const document = { visibilityState: "visible", addEventListener(name, callback) {
      const list = documentListeners.get(name) || []; list.push(callback); documentListeners.set(name, list);
    } };
    function change(key, value, remove) {
      if (remove) storage.delete(key); else storage.set(key, clone(value));
      writes.push({ key, value: clone(value), checkoutLocked: locks?.held?.has("saidian-mall:checkout:v1") || false });
      for (const other of documents) if (other !== current) events.push(() => other.emit("storage", { key, storageArea: other.window.localStorage }));
    }
    const uni = {
      getStorageSync: key => clone(storage.get(key)),
      setStorageSync: (key, value) => change(key, value, false),
      removeStorageSync: key => change(key, undefined, true),
      request: request => requests.push(request),
      reLaunch: navigation => { navigations.push(navigation.url); current.privateView = null; },
      navigateTo: navigation => { navigations.push(navigation.url); navigation.complete?.(); },
      redirectTo: navigation => navigations.push(navigation.url),
      showToast() {},
    };
    current.window = window; current.document = document; current.uni = uni;
    current.emit = (name, event = {}) => (listeners.get(name) || []).forEach(callback => callback(event));
    current.visibility = state => { document.visibilityState = state; (documentListeners.get("visibilitychange") || []).forEach(callback => callback()); };
    const realmModules = realmTestModules(uni, { repo, source });
    current.realm = realmModules.realm;
    current.api = evaluate(source("apps/shop/src/api.ts"), { uni, window, document, navigator: { locks }, getCurrentPages: () => [{ route: "pages/checkout/index" }] }, { "./commerce-model": model, "./realm": current.realm, "./realm-config": realmModules.config });
    documents.push(current); current.api.startMallSessionSync();
    return current;
  }
  return { storage, locks, events, documentInstance, flushStorage() { while (events.length) events.shift()(); } };
}
const respond = (request, data, statusCode = 200) => request.success({ statusCode, data });
test("foreign login invalidates private views and in-flight data before the storage event is delivered", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pending = a.api.api("/storefront/orders", { auth: true });
  const rejected = assert.rejects(pending, /账号已切换/);
  await b.api.saveMallSession(session("H5-UNIT-B"));
  respond(a.requests[0], [{ owner: "H5-UNIT-A" }]); await rejected;
  h.flushStorage();
  assert.equal(a.privateView, null); assert.deepEqual(a.navigations, ["/pages/profile/index"]);
  assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-B");
  assert.equal(h.storage.get("checkout-owner"), "H5-UNIT-B");
  assert.equal(h.storage.get("employee-token"), "H5-UNIT-INDEPENDENT-EMPLOYEE");
});
test("logout followed by logging back into the same ID still invalidates older requests", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pending = a.api.api("/storefront/addresses", { auth: true }), rejected = assert.rejects(pending, /账号已切换/);
  await b.api.clearMallSession(true); await b.api.saveMallSession(session("H5-UNIT-A", "new-login"));
  respond(a.requests[0], [{ name: "old private address" }]); await rejected;
  h.flushStorage(); assert.equal(a.privateView, null);
  assert.equal(h.storage.get("saidian-token"), session("H5-UNIT-A", "new-login").token);
});
test("missed storage events are recovered on BFCache pageshow or returning to the foreground", async () => {
  for (const restore of ["pageshow", "visibility"]) {
    const h = environment(), a = h.documentInstance(), b = h.documentInstance();
    a.visibility("hidden"); await b.api.saveMallSession(session("H5-UNIT-B")); h.events.length = 0;
    if (restore === "pageshow") a.emit("pageshow"); else a.visibility("visible");
    assert.equal(a.privateView, null); assert.deepEqual(a.navigations, ["/pages/profile/index"]);
    assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-B");
  }
});
test("foreign token rotation and employee-session changes do not reset customer pages", () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  b.uni.setStorageSync("saidian-token", "H5-UNIT-ROTATED");
  b.uni.setStorageSync("saidian-refresh-token", "H5-UNIT-ROTATED-REFRESH");
  b.uni.setStorageSync("employee-token", "H5-UNIT-NEW-EMPLOYEE");
  h.flushStorage(); assert.equal(a.navigations.length, 0); assert.ok(a.privateView);
});
test("two documents rotate a shared refresh token only once and both retry with the rotated access token", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pa = a.api.api("/storefront/orders", { auth: true }), pb = b.api.api("/storefront/addresses", { auth: true });
  void respond(a.requests[0], { message: "expired" }, 401); void respond(b.requests[0], { message: "expired" }, 401);
  await tick(); assert.equal(a.requests.length + b.requests.length, 3);
  const refreshed = session("H5-UNIT-A", "rotated");
  respond(a.requests[1], refreshed); await tick();
  assert.equal(a.requests.filter(x => x.url.endsWith("/auth/refresh")).length, 1);
  assert.equal(b.requests.filter(x => x.url.endsWith("/auth/refresh")).length, 0);
  for (const [doc, index] of [[a, 2], [b, 1]]) {
    assert.equal(doc.requests[index].header.authorization, "Bearer " + refreshed.token);
    respond(doc.requests[index], { owner: "H5-UNIT-A" });
  }
  await Promise.all([pa, pb]); h.flushStorage();
  assert.equal(a.navigations.length + b.navigations.length, 0);
});
test("a late login response cannot replace the account committed by another document", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pending = a.api.api("/auth/password/login", { method: "POST" }), rejected = assert.rejects(pending, /账号已切换/);
  await b.api.saveMallSession(session("H5-UNIT-B"));
  respond(a.requests[0], session("H5-UNIT-A")); await rejected;
  assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-B");
});
test("an already received login result remains bound to its original session when queued for saving", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pending = a.api.api("/auth/sms/login", { method: "POST" });
  respond(a.requests[0], session("H5-UNIT-A")); const result = await pending;
  await b.api.saveMallSession(session("H5-UNIT-B"));
  await assert.rejects(a.api.saveMallSession(result), /账号已切换/);
  assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-B");
});
test("a login writer waits for an in-flight refresh and its newer account is never overwritten", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pending = a.api.api("/storefront/orders", { auth: true }), rejected = assert.rejects(pending, /账号已切换/);
  void respond(a.requests[0], { message: "expired" }, 401); await tick();
  const save = b.api.saveMallSession(session("H5-UNIT-B"));
  assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-A");
  respond(a.requests[1], session("H5-UNIT-A", "rotated")); await save; await tick();
  if (a.requests[2]) respond(a.requests[2], { owner: "H5-UNIT-A" });
  await rejected;
  assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-B");
});
test("a delayed 401 cannot refresh or clear another document's newly logged-in account", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const pending = a.api.api("/storefront/orders", { auth: true }), rejected = assert.rejects(pending, /账号已切换/);
  await b.api.saveMallSession(session("H5-UNIT-B"));
  respond(a.requests[0], { message: "expired" }, 401); await rejected;
  assert.equal(a.requests.length, 1); assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-B");
});
test("network failure or a mismatched refresh response preserves the current session and frozen checkout", async () => {
  for (const mismatch of [false, true]) {
    const h = environment(), a = h.documentInstance();
    const draft = { key: "H5-UNIT-FROZEN", userId: "H5-UNIT-A", uncertain: true };
    h.storage.set("checkout-draft", draft);
    const pending = a.api.api("/storefront/orders", { auth: true });
    const rejected = assert.rejects(pending, /网络|账号不匹配/);
    void respond(a.requests[0], { message: "expired" }, 401); await tick();
    if (mismatch) respond(a.requests[1], session("H5-UNIT-B")); else a.requests[1].fail({ errMsg: "网络连接失败" });
    await rejected;
    assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-A");
    assert.deepEqual(h.storage.get("checkout-draft"), draft); assert.equal(a.navigations.length, 0);
  }
});
test("mixed credential writes cannot authorize a request, and commit events never clear another user's checkout", async () => {
  const h = environment(), a = h.documentInstance();
  h.storage.set("saidian-session-revision", "H5-UNIT-WRITING");
  await assert.rejects(a.api.api("/storefront/orders", { auth: true }), /账号已切换/);
  assert.equal(a.requests.length, 0);
  h.storage.set("saidian-user", { id: "H5-UNIT-B" }); h.storage.set("checkout-owner", "H5-UNIT-B");
  h.storage.set("checkout-draft", { userId: "H5-UNIT-B", key: "H5-UNIT-B-DRAFT" });
  h.storage.set("saidian-session-commit", "H5-UNIT-WRITING");
  a.emit("storage", { key: "saidian-session-commit", storageArea: a.window.localStorage });
  assert.equal(h.storage.get("checkout-draft").key, "H5-UNIT-B-DRAFT"); assert.equal(a.privateView, null);
});
test("unsupported H5 locks fail closed for new login, refresh and checkout while explicit logout remains possible", async () => {
  const h = environment({ locks: null }), a = h.documentInstance(); let called = false;
  await assert.rejects(a.api.withMallCheckoutLock(async () => { called = true; }), /不支持安全下单/);
  assert.throws(() => a.api.saveMallSession(session("H5-UNIT-B")), /不支持安全的跨标签登录/);
  const pending = a.api.api("/storefront/orders", { auth: true }), rejected = assert.rejects(pending, /不支持/);
  void respond(a.requests[0], { message: "expired" }, 401); await rejected;
  assert.equal(a.requests.length, 1); assert.equal(called, false); assert.equal(h.storage.get("saidian-user").id, "H5-UNIT-A");
  await a.api.clearMallSession(); assert.equal(h.storage.has("saidian-token"), false);
  assert.equal(h.storage.get("employee-token"), "H5-UNIT-INDEPENDENT-EMPLOYEE");
});
test("a denied Web Lock never executes the protected operation or rewrites storage", async () => {
  const h = environment({ locks: { request: () => Promise.reject(new Error("SecurityError: denied")) } }), a = h.documentInstance();
  const before = clone([...h.storage]);
  await assert.rejects(a.api.withMallCheckoutLock(async () => assert.fail("must not run")), /denied/);
  await assert.rejects(a.api.saveMallSession(session("H5-UNIT-B")), /denied/);
  assert.deepEqual(clone([...h.storage]), before);
});
function checkoutFixture(options = {}) {
  const h = environment(options), quotes = [], creates = [], orderIds = new Map(), errors = [];
  const script = source("apps/shop/src/pages/checkout/index.vue").match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1] +
    "\nexport const handles={submit,items,address,quote,uncertain,submitting,error};";
  function page() {
    const doc = h.documentInstance();
    const handles = evaluate(script, { uni: doc.uni }, {
      "../../realm": doc.realm,
      "vue": { ref: value => ({ value }), computed: callback => ({ get value() { return callback(); } }) },
      "@dcloudio/uni-app": { onShow() {} },
      "../../commerce-model": model,
      "../../payments": { paymentEnvironment: () => "wechat" },
      "../../api": { ...doc.api, requireLogin: () => true, toast: error => errors.push(String(error)),
        api: async (path, request) => {
          if (path.endsWith("/preview")) return new Promise(resolve => quotes.push({ doc, resolve }));
          assert.equal(path, "/storefront/orders");
          const key = request.headers["idempotency-key"];
          if (!orderIds.has(key)) orderIds.set(key, "H5-UNIT-ORDER-" + (orderIds.size + 1));
          return new Promise((resolve, reject) => creates.push({ doc, key, sessionStamp: request.sessionStamp, payload: clone(request.data), resolve: () => resolve({ id: orderIds.get(key) }), reject }));
        },
      },
    }).handles;
    handles.items.value = [{ skuId: "H5-UNIT-SKU", quantity: 1 }];
    handles.address.value = { id: "H5-UNIT-ADDRESS" }; handles.quote.value = { payableCents: 100 };
    return { ...doc, ...handles };
  }
  return { ...h, page, quotes, creates, orderIds, errors, quote(index = 0) { quotes[index].resolve({ quote: { fingerprint: "q1:" + "a".repeat(64), payableCents: 100, lines: [] } }); } };
}
test("cross-document checkout lock starts before quoting and preserves one key across an unknown result and recovery", async () => {
  const h = checkoutFixture(), a = h.page(), b = h.page();
  const first = a.submit(); await tick(); const blocked = b.submit(); await blocked;
  assert.equal(h.quotes.length, 1); assert.equal(h.creates.length, 0); assert.equal(h.storage.has("checkout-draft"), false);
  assert.match(b.error.value, /另一个商城标签/);
  h.quote(); await tick(); assert.equal(h.creates.length, 1);
  const frozen = clone(h.storage.get("checkout-draft")); assert.equal(frozen.uncertain, true);
  await b.submit(); assert.equal(h.creates.length, 1);
  h.creates[0].reject(new Error("网络连接失败")); await first;
  assert.deepEqual(h.storage.get("checkout-draft"), frozen);
  b.uncertain.value = true; const recovery = b.submit(); await tick();
  assert.equal(h.quotes.length, 1); assert.equal(h.creates.length, 2);
  assert.equal(h.creates[1].key, frozen.key); assert.deepEqual(h.creates[1].payload, frozen.payload);
  h.creates[1].resolve(); await recovery;
  assert.equal(h.orderIds.size, 1); assert.equal(h.storage.has("checkout-draft"), false);
  assert.equal(h.storage.get("checkout-pending").orderId, "H5-UNIT-ORDER-1");
});
test("a second document reuses the completed order instead of creating a new idempotency key", async () => {
  const h = checkoutFixture(), a = h.page(), b = h.page();
  const first = a.submit(); await tick(); h.quote(); await tick(); h.creates[0].resolve(); await first;
  await b.submit(); assert.equal(h.quotes.length, 1); assert.equal(h.creates.length, 1);
  assert.ok(b.navigations.some(url => url.endsWith("H5-UNIT-ORDER-1")));
});
test("switch-away-and-back while checkout awaits a quote cannot submit stale data under the same member ID", async () => {
  const h = checkoutFixture(), a = h.page(), b = h.page();
  const pending = a.submit(); await tick();
  await b.api.saveMallSession(session("H5-UNIT-B")); await b.api.saveMallSession(session("H5-UNIT-A", "new-login"));
  h.quote(); await pending; assert.equal(h.creates.length, 0); assert.match(a.error.value, /账号已切换/);
});
test("definitive rejection edits the owned draft while the checkout lock is still held", async () => {
  const h = checkoutFixture(), a = h.page();
  const pending = a.submit(); await tick(); h.quote(); await tick();
  h.creates[0].reject(Object.assign(new Error("validation rejected"), { status: 400 })); await pending;
  const rejectionWrite = a.writes.find(write => write.key === "checkout-draft" && write.value?.uncertain === false);
  assert.ok(rejectionWrite); assert.equal(rejectionWrite.checkoutLocked, true);
  assert.equal(h.locks.held.has("saidian-mall:checkout:v1"), false);
});
test("unavailable checkout locks do not quote, create, or replace an uncertain draft", async () => {
  const h = checkoutFixture({ locks: null }), a = h.page();
  const draft = { key: "H5-UNIT-KEEP", userId: "H5-UNIT-A", uncertain: true, payload: { items: [{ skuId: "H5-UNIT-SKU", quantity: 1 }] } };
  h.storage.set("checkout-draft", draft); a.uncertain.value = true;
  await a.submit();
  assert.equal(h.quotes.length + h.creates.length, 0); assert.deepEqual(h.storage.get("checkout-draft"), draft);
  assert.match(a.error.value, /不支持安全下单/);
});
test("mini-program and non-document execution retain the existing local operation path", async () => {
  const uni = { getStorageSync() {} };
  for (const mini of [false, true]) {
    const globals = mini ? { uni, window: {}, document: {}, navigator: { get locks() { assert.fail("mini must not access browser locks"); } } } : { uni };
    const { realm, config } = realmTestModules(uni, { repo, source, mini });
    const api = evaluate(source("apps/shop/src/api.ts"), globals, { "./commerce-model": model, "./realm": realm, "./realm-config": config }, mini);
    api.startMallSessionSync();
    assert.equal(await api.withMallCheckoutLock(async () => "local"), "local");
  }
});

test("checkout supplies the captured session fence to the actual create request", async () => {
  const h = checkoutFixture(), a = h.page();
  const pending = a.submit(); await tick(); h.quote(); await tick();
  assert.equal(h.creates[0].sessionStamp, a.api.mallSessionStamp());
  h.creates[0].resolve(); await pending;
});
test("a checkout-bound request cannot use a different account even after the storage listener has synchronized", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const originalStamp = a.api.mallSessionStamp();
  await b.api.saveMallSession(session("H5-UNIT-B")); h.flushStorage();
  await assert.rejects(a.api.api("/storefront/orders", { auth: true, method: "POST", sessionStamp: originalStamp }), /账号已切换/);
  assert.equal(a.requests.length, 0);
});
test("a token read racing a foreign commit cannot send the old page's request as the new account", async () => {
  const h = environment(), a = h.documentInstance();
  const read = a.uni.getStorageSync; let tokenReads = 0;
  a.uni.getStorageSync = key => {
    if (key === "saidian-token" && ++tokenReads === 3) {
      h.storage.set("saidian-session-revision", "H5-UNIT-RACE");
      h.storage.set("saidian-user", { id: "H5-UNIT-B" }); h.storage.set("saidian-token", "H5-UNIT-B-ACCESS");
      h.storage.set("saidian-session-commit", "H5-UNIT-RACE");
    }
    return read(key);
  };
  await assert.rejects(a.api.api("/storefront/orders", { auth: true, method: "POST" }), /账号已切换/);
  assert.equal(a.requests.length, 0);
});
test("a late public response cannot release a Promise.all batch holding the previous member's private data", async () => {
  const h = environment(), a = h.documentInstance(), b = h.documentInstance();
  const privateLoad = a.api.api("/storefront/addresses", { auth: true });
  const publicLoad = a.api.api("/storefront/capabilities");
  const batch = Promise.all([privateLoad, publicLoad]), rejected = assert.rejects(batch, /账号已切换/);
  respond(a.requests[0], [{ owner: "H5-UNIT-A" }]); await tick();
  await b.api.saveMallSession(session("H5-UNIT-B")); respond(a.requests[1], { demo: true }); await rejected;
});
test("explicit logout can safely repair an interrupted credential commit after its lock was released", async () => {
  const h = environment(), a = h.documentInstance();
  h.storage.set("saidian-session-revision", "H5-UNIT-INTERRUPTED");
  await a.api.clearMallSession();
  assert.equal(h.storage.has("saidian-token"), false);
  assert.equal(h.storage.get("saidian-session-revision"), h.storage.get("saidian-session-commit"));
  assert.equal(h.storage.get("employee-token"), "H5-UNIT-INDEPENDENT-EMPLOYEE");
});
