// Local, disposable UI fixture only. Never bundled in API/admin/H5 images.
// No network clients, real OAuth exchanges, SMS sends, or database connections.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

assert(process.argv.length === 3 && process.argv[2] === "--local-fixture", "Use explicit --local-fixture; this server binds loopback only");
const root = resolve(fileURLToPath(new URL("../apps/shop/dist/build/h5", import.meta.url)));
const base = "/global/saidian-mall/", api = "/global/api/saidian-mall/v1";
const legalVersion = "local-phone-ui-fixture-v1";
const state = "a".repeat(64), ticket = "b".repeat(64), challenge = "00000000-0000-4000-8000-000000000082";
let phoneRequested = false, signedIn = false;
const evidence = { oauth: 0, codeRequests: 0, phoneBindings: 0, accountReads: 0, logouts: 0, externalCalls: 0 };
const user = { id: "00000000-0000-4000-8000-000000000081", memberNo: 81, nickname: "界面测试会员", emailMasked: null, phoneMasked: "+86***8000", phoneVerified: false, phoneTestMode: true, phoneVerificationStatus: "pending", mobile: "+86***8000", avatarUrl: null };
const session = () => ({ token: "LOCAL-UI-FIXTURE-NOT-A-REAL-TOKEN", refreshToken: "LOCAL-UI-FIXTURE-NOT-A-REAL-REFRESH", expiresAt: new Date(Date.now() + 3600_000).toISOString(), user, requiresMobileBinding: false, requiresAccountBinding: false, returnTo: "/pages/profile/index" });
const reference = type => ({ version: legalVersion, locale: "en", path: `/api/saydian-app/v2/content/legal/${type}?version=${legalVersion}&locale=en` });
const capabilities = { realm: "global", consentVersion: legalVersion, legal: { userAgreement: reference("user_agreement"), privacyPolicy: reference("privacy_policy") },
  login: { password: { enabled: true }, sms: { enabled: false }, wechatH5: { enabled: true }, wechatBinding: { phoneBindingAvailable: true, phoneCodeMode: "test", verificationRequired: false, verifiedAccountRequired: true, password: { enabled: true }, sms: { enabled: false }, email: { enabled: false }, smsCountries: [] } }, checkout: { enabled: false }, payments: [], maintenance: { readOnly: false }, demo: false };
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:5188");
  const json = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
  if (req.headers.host !== "127.0.0.1:5188" && req.headers.host !== "localhost:5188") return json({ message: "Loopback fixture only" }, 403);
  try {
    if (url.pathname === "/fixture/bind") {
      phoneRequested = false; signedIn = false;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(`<title>Local phone UI fixture</title><script>
        for (const key of Object.keys(localStorage)) if (key.startsWith('saydian-global-mall:')) localStorage.removeItem(key);
        sessionStorage.setItem('saydian-global-mall:oauth-context',JSON.stringify({state:'${state}',verifier:'${"c".repeat(64)}',consentVersion:'${legalVersion}',locale:'en',expiresAt:Date.now()+300000,returnTo:'/pages/profile/index',sessionStamp:JSON.stringify(['',JSON.stringify(['','',false])])}));
        location.replace('${base}oauth/callback?code=LOCAL-FIXTURE-NOT-A-WECHAT-CODE&state=${state}');
      </script>`);
    }
    if (url.pathname === "/fixture/evidence") return json(evidence);
    if (url.pathname.startsWith("/global/api/saydian-app/v2/content/legal/")) return json({ code: 200, data: { version: legalVersion, locale: "en", title: "本地界面测试协议", contentHtml: "<p>仅用于本地界面测试，不发送短信，不连接真实账号。</p>" } });
    if (url.pathname === api + "/storefront/capabilities") return json(capabilities);
    if (url.pathname === api + "/storefront/bootstrap") return json({ banners: [], categories: [], featured: [], configs: {}, referral: null, capabilities });
    if (url.pathname === api + "/storefront/products") return json({ items: [], total: 0, page: 1, pageSize: 20 });
    if (url.pathname === api + "/storefront/categories") return json([]);
    if (url.pathname === api + "/auth/wechat/h5/account") { evidence.accountReads++; return signedIn ? json(user) : json({ message: "请重新登录" }, 401); }
    if (req.method === "POST") {
      let raw = ""; for await (const part of req) { raw += part; if (raw.length > 8192) return json({}, 413); }
      const body = JSON.parse(raw || "{}");
      if (url.pathname === api + "/auth/wechat/h5/login") {
        assert.equal(body.code, "LOCAL-FIXTURE-NOT-A-WECHAT-CODE"); evidence.oauth++;
        return json({ requiresMobileBinding: true, requiresAccountBinding: true, bindTicket: ticket, expiresIn: 300, returnTo: "/pages/profile/index" });
      }
      if (url.pathname === api + "/auth/wechat/h5/phone-code") {
        assert.equal(body.bindTicket, ticket); assert.equal(body.identifier, "+8613800138000"); assert.equal(body.expectedMode, "test"); phoneRequested = true; evidence.codeRequests++;
        return json({ challengeId: challenge, expiresIn: 300, retryAfter: 60, maskedIdentifier: user.phoneMasked, mode: "test", sent: false, verificationRequired: false });
      }
      if (url.pathname === api + "/auth/wechat/h5/bind-phone") {
        assert(phoneRequested); assert.equal(body.bindTicket, ticket); assert.equal(body.challengeId, challenge); assert.match(body.code, /^\d{6}$/);
        evidence.phoneBindings++; signedIn = true; return json(session());
      }
      if (url.pathname === api + "/auth/refresh" && signedIn) return json(session());
      if (url.pathname === "/global/api/saydian-app/v2/auth/logout") { evidence.logouts++; signedIn = false; return json({ code: 200, data: { loggedOut: true } }, 201); }
      return json({ message: "本地场景不支持此操作" }, 400);
    }
    if (!url.pathname.startsWith(base)) return json({}, 404);
    const relative = decodeURIComponent(url.pathname.slice(base.length));
    const file = resolve(root, relative || "index.html");
    assert(file.startsWith(root + sep));
    let target = file;
    if (relative === "oauth/callback") target = resolve(root, "index.html");
    if (!(await stat(target)).isFile()) return json({}, 404);
    res.writeHead(200, { "content-type": mime[extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(await readFile(target));
  } catch { if (!res.headersSent) json({ message: "Local fixture assertion failed" }, 400); else res.end(); }
});
server.listen(5188, "127.0.0.1", () => console.log("Local-only H5 UI fixture: http://127.0.0.1:5188/fixture/bind (no external services)"));
