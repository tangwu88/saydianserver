import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);
const vue = nodeRequire("vue"), { parse, compileScript } = nodeRequire("vue/compiler-sfc");

const source = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
function harness({ realm = "global", storage = new Map(), url = "https://app.saydian.cn/global/saidian-mall/", request } = {}) {
  const requests = [], events = {}, session = new Map(), mounted = [], unmounted = [];
  const location = { href: url, assign(value) { this.href = value; } };
  Object.defineProperties(location, { pathname: { get: () => new URL(location.href).pathname }, hash: { get: () => new URL(location.href).hash } });
  const sessionStorage = { getItem: key => session.get(key) ?? null, removeItem: key => session.delete(key), setItem: (key, value) => session.set(key, String(value)) };
  const uni = { getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    request(options) { requests.push(options); request?.(options); }, reLaunch() {}, navigateTo() {}, showToast() {} };
  const context = vm.createContext({ __env: realm === "global" ? { VITE_APP_REALM: "global" } : {}, uni, window: { localStorage: storage, addEventListener(name, fn) { events[name] = fn; } },
    navigator: { userAgent: "MicroMessenger", locks: { request: (_key, _options, run) => Promise.resolve(run({})) } }, document: { addEventListener() {} },
    location, history: { state: null, replaceState(_state, _title, value) { location.href = new URL(value, location.href).href; } }, sessionStorage,
    URL, URLSearchParams, TextEncoder, Date, setTimeout, clearTimeout, setInterval, clearInterval, getCurrentPages: () => [], console });
  const cache = new Map();
  function load(name) {
    const filename = resolve(source, /\.(ts|vue)$/.test(name) ? name : name + ".ts");
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const raw = readFileSync(filename, "utf8");
    const text = (filename.endsWith(".vue") ? compileScript(parse(raw, { filename }).descriptor, { id: "test-auth" }).content : raw).replace(/\/\* #ifdef MP-WEIXIN \*\/[\s\S]*?\/\* #endif \*\//g, "").replaceAll("import.meta.env", "__env");
    const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const run = vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename });
    run(path => {
      if (path === "vue") return { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn) };
      if (path.endsWith(".vue")) return {};
      if (!path.startsWith(".")) throw new Error("Unexpected dependency: " + path);
      return load(resolve(dirname(filename), path));
    }, module, module.exports);
    return module.exports;
  }
  return { load, storage, sessionStorage, session, location, requests, uni, events, mounted, unmount: () => unmounted.forEach(fn => fn()) };
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
test("identifier contracts still require email/E164 and validate passwords", () => {
  const { validGlobalIdentifier, validNewPassword } = harness().load("global-auth-model");
  assert.equal(validGlobalIdentifier("person@example.invalid"), true); assert.equal(validGlobalIdentifier("+14155550123"), true);
  for (const value of ["13812345678", "+0123456789", "not-email", "a@b", "a b@example.com"]) assert.equal(validGlobalIdentifier(value), false);
  assert.equal(validGlobalIdentifier("a@example.com", "sms"), false); assert.equal(validGlobalIdentifier("+8613812345678", "email"), false);
  assert.equal(validNewPassword("abcdefgh"), true); assert.equal(validNewPassword("短".repeat(25)), false); assert.equal(validNewPassword("1234567"), false);
});

test("global phone entry defaults to +86, accepts an adjustable prefix and never prefixes full E164 twice", () => {
  const { normalizeGlobalPhone } = harness().load("global-auth-model");
  assert.equal(normalizeGlobalPhone("13812345678"), "+8613812345678");
  assert.equal(normalizeGlobalPhone("4155550123", "+1"), "+14155550123");
  assert.equal(normalizeGlobalPhone(" +14155550123 ", "+86"), "+14155550123");
  assert.equal(normalizeGlobalPhone("+8613812345678", "+1"), "+8613812345678");
  for (const [phone, prefix] of [["13812345678", "+0"], ["13812345678", "86"], ["13812345678", "+1234"], ["", "+86"], ["123abc", "+86"], ["+0123456789", "+86"], ["123456789012345", "+86"]]) assert.equal(normalizeGlobalPhone(phone, prefix), null);
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

async function settle(check) { for (let i = 0; i < 30; i++) { if (check()) return; await new Promise(resolve => setImmediate(resolve)); } assert.fail("component did not settle"); }
function phoneLoginHarness(t, options = {}) {
  let bindAttempts = 0;
  const mode = options.mode || "test";
  const h = harness({ url: `https://app.saydian.cn/global/saidian-mall/oauth/callback?code=synthetic-code&state=${state}`, request: request => {
    const ok = data => request.success({ statusCode: 200, data });
    if (request.url.includes("/storefront/capabilities")) return ok({ realm: "global", consentVersion: "approved-2026-09", legal: Object.fromEntries(["userAgreement", "privacyPolicy"].map((key, index) => [key, { path: `/api/saydian-app/v2/content/legal/${index ? "privacy_policy" : "user_agreement"}?version=approved-2026-09&locale=en`, version: "approved-2026-09", locale: "en" }])), login: { password: { enabled: true }, wechatH5: { enabled: true }, wechatBinding: { phoneBindingAvailable: options.available !== false, phoneCodeMode: mode } } });
    if (request.url.includes("/content/legal/")) return ok({ code: 200, data: { version: options.legalVersion || "approved-2026-09", locale: "en", contentHtml: "<p>Synthetic reviewed terms</p>" } });
    if (request.url.endsWith("/auth/wechat/h5/login")) return ok({ requiresPhoneBinding: true, bindTicket: "synthetic-ticket", expiresIn: 300, returnTo: "/pages/profile/index" });
    if (request.url.endsWith("/auth/wechat/h5/phone-code")) {
      if (options.phoneCode) return options.phoneCode(request);
      return ok({ challengeId: "synthetic-phone-challenge", expiresIn: 300, retryAfter: 60, maskedIdentifier: "+86***5678", mode, sent: mode === "sms", verificationRequired: mode === "sms" });
    }
    if (request.url.endsWith("/auth/wechat/h5/bind-phone")) {
      bindAttempts++;
      if (options.passwordRequired && bindAttempts === 1) return request.success({ statusCode: 403, data: { errorKey: "phone_password_required", message: "Do not expose this provider detail" } });
      return ok({ token: "synthetic-phone-token", refreshToken: "synthetic-phone-refresh", user: { id: "synthetic-member", memberNo: "12345", phoneMasked: "+86***5678", phoneVerified: mode === "sms", phoneVerificationStatus: mode === "sms" ? "verified" : "pending" } });
    }
    if (request.url.endsWith("/auth/password/login")) return ok({ token: "synthetic-password-token", refreshToken: "synthetic-refresh", user: { id: "existing-member", memberNo: "54321" } });
    throw new Error("Unexpected request " + request.url);
  } });
  h.sessionStorage.setItem(h.load("global-auth-model").OAUTH_CONTEXT_KEY, JSON.stringify(oauthContext(h)));
  h.load("global-oauth").bridgeGlobalOAuth();
  const component = h.load("components/GlobalLogin.vue").default;
  const ui = component.setup({}, { expose() {} });
  h.mounted.forEach(fn => fn()); t.after(h.unmount);
  return { ...h, ui };
}
test("phone step uses real server challenge; temporary mode never claims SMS sent or verification", async t => {
  const h = phoneLoginHarness(t); await settle(() => !h.ui.loading.value);
  assert.equal(h.ui.bindTicket.value, "synthetic-ticket"); assert.equal(h.ui.passwordRequired.value, false);
  h.ui.identifier.value = "+8613812345678"; await h.ui.sendCode();
  assert.equal(h.ui.codeNote.value, "请填写6位验证码"); assert.equal(h.ui.challenge.value.id, "synthetic-phone-challenge");
  h.ui.code.value = "123456"; await h.ui.login();
  const binding = h.requests.find(request => request.url.endsWith("/bind-phone"));
  assert.equal(binding.data.challengeId, "synthetic-phone-challenge"); assert.equal("password" in binding.data, false);
  assert.equal(h.storage.get("saydian-global-mall:saidian-user").phoneVerified, false);
  assert.equal(h.storage.get("saydian-global-mall:saidian-user").phoneVerificationStatus, "pending");
});

test("temporary phone registration directly accepts six digits with the default +86 and one guarded challenge", async t => {
  const h = phoneLoginHarness(t); await settle(() => !h.ui.loading.value);
  assert.equal(h.ui.countryCode.value, "+86"); assert.equal(h.ui.temporaryPhoneCode.value, true);
  h.ui.identifier.value = "13812345678"; h.ui.code.value = "000000"; await h.ui.login();
  const codeCalls = h.requests.filter(request => request.url.endsWith("/phone-code"));
  const bindCalls = h.requests.filter(request => request.url.endsWith("/bind-phone"));
  assert.equal(codeCalls.length, 1); assert.equal(codeCalls[0].data.identifier, "+8613812345678"); assert.equal(codeCalls[0].data.expectedMode, "test");
  assert.equal(bindCalls.length, 1); assert.equal(bindCalls[0].data.code, "000000");
  assert.equal(h.storage.get("saydian-global-mall:saidian-user").phoneVerificationStatus, "pending"); assert.doesNotMatch(h.ui.codeNote.value, /已发送/);
});

test("phone password login uses +86 local input and preserves pasted full international numbers", async t => {
  for (const [identifier, expected] of [["13812345678", "+8613812345678"], ["+14155550123", "+14155550123"]]) {
    const h = phoneLoginHarness(t); await settle(() => !h.ui.loading.value);
    h.ui.cancelBinding(); h.ui.changeContact("sms"); h.ui.identifier.value = identifier; h.ui.password.value = "synthetic-password"; h.ui.accepted.value = true;
    await h.ui.login();
    assert.equal(h.requests.find(request => request.url.endsWith("/auth/password/login")).data.mobile, expected);
  }
});

test("direct temporary confirmation is single-flight and rejects incomplete codes before requesting anything", async t => {
  let pending;
  const h = phoneLoginHarness(t, { phoneCode: request => { pending = request; } }); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "13812345678"; h.ui.code.value = "12345"; await h.ui.login();
  assert.equal(h.requests.some(request => request.url.endsWith("/phone-code")), false);
  h.ui.code.value = "654321"; const first = h.ui.login(); const second = h.ui.login();
  assert.equal(h.requests.filter(request => request.url.endsWith("/phone-code")).length, 1);
  pending.success({ statusCode: 200, data: { challengeId: "direct-test-challenge", expiresIn: 300, retryAfter: 60, mode: "test", sent: false, verificationRequired: false } });
  await Promise.all([first, second]);
  assert.equal(h.requests.filter(request => request.url.endsWith("/bind-phone")).length, 1);
});

test("real SMS confirmation never auto-sends and requires an explicitly requested challenge", async t => {
  const h = phoneLoginHarness(t, { mode: "sms" }); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "13812345678"; h.ui.code.value = "123456"; await h.ui.login();
  assert.equal(h.requests.some(request => /\/(phone-code|bind-phone)$/.test(request.url)), false);
  assert.equal(h.ui.error.value, "请先获取当前手机号的验证码。");
  await h.ui.sendCode(); await h.ui.login();
  const request = h.requests.find(request => request.url.endsWith("/phone-code")); assert.equal("expectedMode" in request.data, false);
  assert.equal(h.requests.filter(request => request.url.endsWith("/bind-phone")).length, 1);
});

test("automatic challenge failure never falls back to sending real SMS", async t => {
  const h = phoneLoginHarness(t, { phoneCode: request => request.success({ statusCode: 503, data: { errorKey: "phone_test_unavailable", message: "internal mode changed" } }) });
  await settle(() => !h.ui.loading.value); h.ui.identifier.value = "13812345678"; h.ui.code.value = "123456"; await h.ui.login();
  const calls = h.requests.filter(request => request.url.endsWith("/phone-code")); assert.equal(calls.length, 1); assert.equal(calls[0].data.expectedMode, "test");
  assert.equal(h.requests.some(request => request.url.endsWith("/bind-phone")), false); assert.equal(h.ui.error.value, "验证码暂时无法使用，请稍后重试。"); assert.equal(h.ui.challenge.value, null);
});

test("automatic challenge rejects a real-SMS response even if stale capabilities said temporary mode", async t => {
  const h = phoneLoginHarness(t, { phoneCode: request => request.success({ statusCode: 200, data: { challengeId: "wrong-mode", expiresIn: 300, retryAfter: 60, mode: "sms", sent: true, verificationRequired: true } }) });
  await settle(() => !h.ui.loading.value); h.ui.identifier.value = "13812345678"; h.ui.code.value = "123456"; await h.ui.login();
  assert.equal(h.ui.challenge.value, null); assert.equal(h.requests.some(request => request.url.endsWith("/bind-phone")), false);
});
test("real SMS step only says sent when server confirms sent SMS", async t => {
  const h = phoneLoginHarness(t, { mode: "sms" }); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "+8613812345678"; await h.ui.sendCode(); assert.match(h.ui.codeNote.value, /已发送至/);
});
test("existing phone password is requested only after server asks and preserves challenge", async t => {
  const h = phoneLoginHarness(t, { mode: "sms", passwordRequired: true }); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "+8613812345678"; await h.ui.sendCode(); h.ui.code.value = "123456";
  await h.ui.login(); assert.equal(h.ui.passwordRequired.value, true); assert.equal(h.ui.challenge.value.id, "synthetic-phone-challenge"); assert.equal(h.ui.code.value, "123456");
  assert.equal(h.ui.error.value, "请输入该手机号原账号的密码。");
  h.ui.password.value = "Synthetic-original-password"; await h.ui.login();
  const calls = h.requests.filter(request => request.url.endsWith("/bind-phone")); assert.equal(calls.length, 2); assert.equal(calls[1].data.password, "Synthetic-original-password");
});
test("disabled code capability cannot send or fabricate a challenge", async t => {
  const h = phoneLoginHarness(t, { available: false, mode: "unavailable" }); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "+8613812345678"; await h.ui.sendCode();
  assert.equal(h.ui.bindingEnabled.value, false); assert.equal(h.ui.challenge.value, null);
  assert.equal(h.requests.some(request => request.url.endsWith("/phone-code")), false);
});
test("duplicate code clicks are fenced; changed contact clears challenge without resetting cooldown", async t => {
  let pending;
  const h = phoneLoginHarness(t, { phoneCode: request => { pending = request; } }); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "+8613812345678"; const first = h.ui.sendCode(); const second = h.ui.sendCode();
  assert.equal(h.requests.filter(request => request.url.endsWith("/phone-code")).length, 1);
  pending.success({ statusCode: 200, data: { challengeId: "real-test-challenge", expiresIn: 300, retryAfter: 60, mode: "test", sent: false, verificationRequired: false } });
  await Promise.all([first, second]); h.ui.identifier.value = "+14155550123"; h.ui.resetChallenge();
  assert.equal(h.ui.challenge.value, null); assert.ok(h.ui.countdown.value > 0);
  h.ui.code.value = "123456"; await h.ui.login(); assert.equal(h.requests.some(request => request.url.endsWith("/bind-phone")), false);
});

test("changing country code clears the previous phone challenge, code and original password", async t => {
  const h = phoneLoginHarness(t); await settle(() => !h.ui.loading.value);
  h.ui.identifier.value = "4155550123"; await h.ui.sendCode(); h.ui.code.value = "123456"; h.ui.passwordRequired.value = true; h.ui.password.value = "old-password";
  h.ui.countryCode.value = "+1"; h.ui.resetChallenge();
  assert.equal(h.ui.challenge.value, null); assert.equal(h.ui.code.value, ""); assert.equal(h.ui.password.value, ""); assert.equal(h.ui.passwordRequired.value, false);
  h.ui.code.value = "123456"; await h.ui.login(); assert.equal(h.requests.some(request => request.url.endsWith("/bind-phone")), false);
  h.ui.countdown.value = 0; await h.ui.login();
  assert.equal(h.requests.filter(request => request.url.endsWith("/phone-code"))[1].data.identifier, "+14155550123");
  const template = readFileSync(resolve(source, "components/GlobalLogin.vue"), "utf8");
  assert.match(template, /id="country-code"[^>]*@input="resetChallenge"/);
});
test("mismatched code response metadata never becomes an accepted challenge", async t => {
  const h = phoneLoginHarness(t, { phoneCode: request => request.success({ statusCode: 200, data: { challengeId: "bad", expiresIn: 300, retryAfter: 60, mode: "test", sent: true, verificationRequired: false } }) });
  await settle(() => !h.ui.loading.value); h.ui.identifier.value = "+8613812345678"; await h.ui.sendCode(); assert.equal(h.ui.challenge.value, null); assert.equal(h.ui.codeNote.value, "");
});
test("changed legal document version blocks OAuth exchange", async t => {
  const h = phoneLoginHarness(t, { legalVersion: "different-version" }); await settle(() => !h.ui.loading.value);
  assert.equal(h.ui.legalReady.value, false); assert.equal(h.requests.some(request => request.url.endsWith("/auth/wechat/h5/login")), false);
});
test("ordinary email password login remains available after cancelling phone step", async t => {
  const h = phoneLoginHarness(t); await settle(() => !h.ui.loading.value); h.ui.cancelBinding();
  h.ui.identifier.value = "member@example.invalid"; h.ui.password.value = "synthetic-password"; h.ui.accepted.value = true;
  await h.ui.login(); assert.equal(h.storage.get("saydian-global-mall:saidian-user").id, "existing-member");
});
test("friendly errors never disclose raw provider reason or internal account details", () => {
  const { authErrorMessage, authUiError } = harness().load("friendly-auth");
  assert.equal(authErrorMessage({ status: 503, message: "GLOBAL_TEST_FLAG appSecret=private" }), "服务暂时不可用，请稍后再试。");
  assert.equal(authErrorMessage({ errorKey: "phone_password_required", message: "database User exists" }), "请输入该手机号原账号的密码。");
  assert.equal(authErrorMessage(authUiError("请检查国家区号和手机号。")), "请检查国家区号和手机号。");
  assert.equal(authErrorMessage(new Error("private diagnostic")), "暂时无法完成，请稍后重试。");
});
test("account refresh updates safe verification status without touching domestic storage", async () => {
  const h = harness({ request: request => request.success({ statusCode: 200, data: { id: "A", memberNo: "123", phoneMasked: "+86***1234", phoneVerified: false, phoneVerificationStatus: "pending" } }) }), api = h.load("api");
  h.storage.set("saidian-user", { id: "domestic" }); await api.saveMallSession({ token: "A-token", user: { id: "A" } });
  const result = await api.refreshGlobalMallAccount(); assert.equal(result.phoneVerified, false); assert.equal(h.storage.get("saidian-user").id, "domestic");
  assert.equal(h.requests[0].url, "/global/api/saidian-mall/v1/auth/wechat/h5/account");
});
test("login/account/help visible UI removes edition notices and uses App brand/theme", () => {
  for (const file of ["GlobalLogin.vue", "GlobalAccount.vue", "GlobalHelp.vue", "DesktopHeader.vue"]) {
    const text = readFileSync(resolve(source, "components", file), "utf8");
    assert.equal(/国际版|国内版|隔离|raw reason/.test(text), false, file);
  }
  assert.match(readFileSync(resolve(source, "global-ui.scss"), "utf8"), /#d20b27/);
  assert.match(readFileSync(resolve(source, "components/GlobalAccount.vue"), "utf8"), /phoneVerified === false[\s\S]*?待验证/);
});
