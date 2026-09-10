import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
function harness({ realm = "global", storage = new Map(), url = "https://app.saydian.cn/global/saidian-mall/", request } = {}) {
  const requests = [], events = {}, session = new Map();
  const location = { href: url, assign(value) { this.href = value; } };
  Object.defineProperties(location, { pathname: { get: () => new URL(location.href).pathname }, hash: { get: () => new URL(location.href).hash } });
  const sessionStorage = { getItem: key => session.get(key) ?? null, removeItem: key => session.delete(key), setItem: (key, value) => session.set(key, String(value)) };
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    request(options) { requests.push(options); request?.(options); }, reLaunch() {}, navigateTo() {}, showToast() {} };
  const context = vm.createContext({ __env: realm === "global" ? { VITE_APP_REALM: "global" } : {}, uni, window: { localStorage: storage, addEventListener(name, fn) { events[name] = fn; } },
    navigator: { locks: { request: (_key, _options, run) => Promise.resolve(run({})) } }, document: { addEventListener() {} },
    location, history: { state: null, replaceState(_state, _title, value) { location.href = new URL(value, location.href).href; } }, sessionStorage,
    URL, URLSearchParams, TextEncoder, Date, setTimeout, clearTimeout, getCurrentPages: () => [], console });
  const cache = new Map();
  function load(name) {
    const filename = resolve(source, name.endsWith(".ts") ? name : name + ".ts");
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const text = readFileSync(filename, "utf8").replace(/\/\* #ifdef MP-WEIXIN \*\/[\s\S]*?\/\* #endif \*\//g, "").replaceAll("import.meta.env", "__env");
    const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const run = vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename });
    run(path => { if (!path.startsWith(".")) throw new Error("Unexpected dependency: " + path); return load(resolve(dirname(filename), path)); }, module, module.exports);
    return module.exports;
  }
  return { load, storage, sessionStorage, session, location, requests, uni, events };
}
const state = "a".repeat(64), verifier = "b".repeat(64);
function oauthContext(h, changes = {}) {
  return { state, verifier, consentVersion: "approved-2026-09", locale: "en", expiresAt: Date.now() + 300000,
    returnTo: "/pages/product/index?id=synthetic-product", sessionStamp: h.load("api").mallOAuthSessionStamp(), ...changes };
}

test("global defaults and every mismatched base / mini build fail closed", () => {
  const { resolveMallConfig } = harness().load("realm-config");
  assert.equal(resolveMallConfig({ VITE_APP_REALM: "global" }).apiBase, "/global/api/saidian-mall/v1");
  assert.equal(resolveMallConfig({}).apiBase, "/api/saidian-mall/v1");
  assert.equal(resolveMallConfig({}, true).apiBase, "https://stest.saydian.cn/api/saidian-mall/v1");
  for (const env of [{ VITE_API_BASE: "/api/saidian-mall/v1" }, { VITE_API_BASE: "https://foreign.invalid/api" }, { VITE_PUBLIC_BASE: "/saidian-mall/" }]) assert.throws(() => resolveMallConfig({ VITE_APP_REALM: "global", ...env }), /国际商城/);
  assert.throws(() => resolveMallConfig({ VITE_APP_REALM: "global" }, true), /小程序/);
});
test("all customer, checkout, employee, OAuth and lock keys are isolated; domestic keys unchanged", () => {
  const { realmKey } = harness().load("realm-config");
  for (const key of ["saidian-token", "saidian-user", "saidian-refresh-token", "saidian-session-revision", "saidian-session-commit", "saidian-ref", "saidian-post-login-route", "checkout-items", "checkout-draft", "checkout-owner", "checkout-pending", "checkout-address", "checkout-cart-ids", "employee-token", "employee-withdrawal-draft", "saidian-mall:session:v1", "saidian-mall:checkout:v1"]) {
    assert.equal(realmKey(key, "domestic"), key); assert.notEqual(realmKey(key, "global"), key);
  }
});
test("only known global browsing and auth endpoints are enabled", () => {
  const { globalApiAllowed, globalPageAllowed } = harness().load("realm-config");
  assert.equal(globalApiAllowed("/storefront/products?page=1"), true);
  assert.equal(globalApiAllowed("/auth/wechat/h5/bind-code", "POST"), true);
  for (const path of ["/wecom/oauth", "/auth/wechat/mini", "/auth/sms-login", "/storefront/cart/items", "/storefront/orders", "https://example.invalid"]) assert.equal(globalApiAllowed(path, "POST"), false);
  assert.equal(globalPageAllowed("/pages/product/index?id=1"), true);
  for (const route of ["/pages/employee/index", "/pages/checkout/index", "//example.invalid", "/pages/login/index#bad"]) assert.equal(globalPageAllowed(route), false);
});
test("email/E164 and password validation do not invent domestic phone defaults", () => {
  const { validGlobalIdentifier, validNewPassword } = harness().load("global-auth-model");
  assert.equal(validGlobalIdentifier("person@example.invalid"), true); assert.equal(validGlobalIdentifier("+14155550123"), true);
  for (const value of ["13812345678", "+0123456789", "not-email", "a@b", "a b@example.com"]) assert.equal(validGlobalIdentifier(value), false);
  assert.equal(validGlobalIdentifier("a@example.com", "sms"), false); assert.equal(validGlobalIdentifier("+8613812345678", "email"), false);
  assert.equal(validNewPassword("abcdefgh"), true); assert.equal(validNewPassword("短".repeat(25)), false); assert.equal(validNewPassword("1234567"), false);
});
test("OAuth context supports the exact global locales and expires without replay", () => {
  const h = harness(), model = h.load("global-auth-model");
  for (const locale of ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"]) assert.equal(model.validOAuthContext(oauthContext(h, { locale }), Date.now()), true);
  for (const changes of [{ expiresAt: Date.now() - 1 }, { expiresAt: Infinity }, { expiresAt: Date.now() + 700000 }, { locale: "unknown" }, { verifier: "bad" }, { consentVersion: "" }]) assert.equal(model.validOAuthContext(oauthContext(h, changes), Date.now()), false);
  h.sessionStorage.setItem(model.OAUTH_CONTEXT_KEY, JSON.stringify(oauthContext(h)));
  assert.equal(model.consumeOAuthContext(h.sessionStorage, state).consentVersion, "approved-2026-09");
  assert.throws(() => model.consumeOAuthContext(h.sessionStorage, state), /过期/);
});
test("malformed, expired and mismatched OAuth contexts are consumed even on failure", () => {
  for (const raw of ["{bad", "null", JSON.stringify({ ...oauthContext(harness()), state: "x".repeat(64) })]) {
    const h = harness(), model = h.load("global-auth-model"); h.sessionStorage.setItem(model.OAUTH_CONTEXT_KEY, raw);
    assert.throws(() => model.consumeOAuthContext(h.sessionStorage, state)); assert.equal(h.sessionStorage.getItem(model.OAUTH_CONTEXT_KEY), null);
  }
});
test("callback URL is scrubbed before any request and delivered only once in memory", () => {
  const h = harness({ url: `https://app.saydian.cn/global/saidian-mall/oauth/callback?code=synthetic-code&state=${state}` });
  const model = h.load("global-auth-model"), bridge = h.load("global-oauth");
  h.sessionStorage.setItem(model.OAUTH_CONTEXT_KEY, JSON.stringify(oauthContext(h)));
  assert.equal(bridge.bridgeGlobalOAuth(), true);
  assert.equal(h.location.href, "https://app.saydian.cn/global/saidian-mall/#/pages/login/index");
  assert.equal(h.requests.length, 0); assert.equal(h.session.size, 0);
  assert.equal(bridge.takeGlobalOAuthCallback().code, "synthetic-code"); assert.equal(bridge.takeGlobalOAuthCallback(), null);
  assert.equal(bridge.bridgeGlobalOAuth(), false);
});
test("cancelled, foreign-path and account-switched callbacks never retain code or URL", () => {
  for (const { path, query, switched } of [{ path: "/global/saidian-mall/oauth/callback", query: `error=access_denied&state=${state}` }, { path: "/saidian-mall/", query: `code=synthetic&state=${state}` }, { path: "/global/saidian-mall/oauth/callback", query: `code=synthetic&state=${state}`, switched: true }]) {
    const h = harness({ url: `https://app.saydian.cn${path}?${query}` }), model = h.load("global-auth-model");
    h.sessionStorage.setItem(model.OAUTH_CONTEXT_KEY, JSON.stringify(oauthContext(h)));
    if (switched) h.storage.set("saydian-global-mall:saidian-session-revision", "new-revision");
    const bridge = h.load("global-oauth"); bridge.bridgeGlobalOAuth();
    const result = bridge.takeGlobalOAuthCallback(); assert.ok(result.error); assert.equal(result.code, undefined); assert.equal(new URL(h.location.href).search, ""); assert.equal(h.session.size, 0);
  }
});
test("OAuth persistent stamp survives page reload and changes after real identity change", async () => {
  const h = harness(), api = h.load("api");
  await api.saveMallSession({ token: "synthetic-global-token", refreshToken: "synthetic-refresh", user: { id: "synthetic-user" } });
  const persisted = api.mallOAuthSessionStamp();
  const reloaded = harness({ storage: h.storage }); assert.equal(reloaded.load("api").mallOAuthSessionStamp(), persisted);
  await reloaded.load("api").clearMallSession(); assert.notEqual(reloaded.load("api").mallOAuthSessionStamp(), persisted);
});
test("account switch clears only international drafts and preserves domestic identity/data", async () => {
  const h = harness(), api = h.load("api");
  h.storage.set("saidian-token", "domestic-token"); h.storage.set("checkout-draft", { owner: "domestic" });
  await api.saveMallSession({ token: "global-a", refreshToken: "r-a", user: { id: "A" } });
  h.storage.set("saydian-global-mall:checkout-draft", { owner: "A" });
  await api.saveMallSession({ token: "global-b", refreshToken: "r-b", user: { id: "B" } });
  assert.equal(h.storage.has("saydian-global-mall:checkout-draft"), false); assert.equal(h.storage.get("saidian-token"), "domestic-token"); assert.equal(h.storage.get("checkout-draft").owner, "domestic");
});
test("global client refuses disabled routes without network and targets its own API", async () => {
  const h = harness({ request: options => options.success({ statusCode: 200, data: { realm: "global" } }) });
  await assert.rejects(h.load("api").api("/storefront/orders", { method: "POST" }), /暂未开放/); assert.equal(h.requests.length, 0);
  await h.load("api").api("/storefront/capabilities?locale=en"); assert.equal(h.requests[0].url, "/global/api/saidian-mall/v1/storefront/capabilities?locale=en");
});
test("global logout revokes server session; network failure reports local-only logout", async () => {
  for (const success of [true, false]) {
    const h = harness({ request: options => success ? options.success({ statusCode: 201, data: { code: 200, data: { loggedOut: true } } }) : options.fail({}) }), api = h.load("api");
    await api.saveMallSession({ token: "synthetic-token", refreshToken: "synthetic-refresh", user: { id: "A" } });
    assert.equal(await api.logoutGlobalMall(), success ? "revoked" : "local"); assert.equal(h.requests[0].url, "/global/api/saydian-app/v2/auth/logout"); assert.equal(h.storage.has("saydian-global-mall:saidian-token"), false);
  }
});
test("late logout response never removes a newly switched account", async () => {
  const h = harness(), api = h.load("api"); await api.saveMallSession({ token: "a", refreshToken: "ra", user: { id: "A" } });
  const pending = api.logoutGlobalMall(); await api.saveMallSession({ token: "b", refreshToken: "rb", user: { id: "B" } });
  h.requests[0].success({ statusCode: 201, data: { code: 200, data: { loggedOut: true } } }); assert.equal(await pending, "changed"); assert.equal(h.storage.get("saydian-global-mall:saidian-user").id, "B");
});
test("legal references can only target published-version global legal endpoints", () => {
  const { globalLegalPath } = harness().load("global-auth-model");
  assert.equal(globalLegalPath("/api/saydian-app/v2/content/legal/user_agreement?version=approved&locale=en"), "/global/api/saydian-app/v2/content/legal/user_agreement?version=approved&locale=en");
  for (const value of ["https://foreign.invalid/?code=x", "/api/saidian-mall/v1/storefront/bootstrap", "/api/saydian-app/v2/content/legal/user_agreement", "/api/saydian-app/v2/content/legal/privacy_policy?locale=en", "/api/saydian-app/v2/content/legal/user_agreement?version=v&locale=en#code=x"]) assert.throws(() => globalLegalPath(value));
});
test("global login source never uses domestic consent; authorize carries the consent snapshot", () => {
  const text = readFileSync(resolve(source, "components/GlobalLogin.vue"), "utf8");
  assert.equal(text.includes("commerce-legal-v1"), false); assert.match(text, /codeChallenge: challengeHash, consentVersion: agreed.version, locale: agreed.locale/);
  assert.match(text, /context.consentVersion !== consent.value.version/); assert.match(text, /if \(busy.value \|\| loading.value\) return/);
  assert.match(readFileSync(resolve(source, "../index.html"), "utf8"), /name="referrer" content="no-referrer"/);
});
