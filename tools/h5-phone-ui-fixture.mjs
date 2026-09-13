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
let phoneRequested = false, signedIn = false, scenario = "bind";
const evidence = { oauth: 0, codeRequests: 0, phoneBindings: 0, accountReads: 0, promotionReads: 0, rejectedWrites: 0, logouts: 0, externalCalls: 0 };
const user = { id: "00000000-0000-4000-8000-000000000081", memberNo: 81, nickname: "界面测试会员", emailMasked: null, phoneMasked: "+86***8000", phoneVerified: false, phoneTestMode: true, phoneVerificationStatus: "pending", mobile: "+86***8000", avatarUrl: null };
const promoterUser = { ...user, id: "00000000-0000-4000-8000-000000000091", memberNo: 91, nickname: "Saydian user", phoneMasked: "+86***0091", phoneVerified: true, phoneTestMode: false, phoneVerificationStatus: "verified", mobile: "+86***0091" };
const activeUser = () => scenario === "promotion" ? promoterUser : user;
const session = (returnTo = "/pages/profile/index") => ({ token: "LOCAL-UI-FIXTURE-NOT-A-REAL-TOKEN", refreshToken: "LOCAL-UI-FIXTURE-NOT-A-REAL-REFRESH", expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: activeUser(), requiresMobileBinding: false, requiresAccountBinding: false, returnTo });
const tinySvg = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480"><rect width="100%" height="100%" fill="#fff6f7"/><text x="50%" y="45%" text-anchor="middle" font-size="28" fill="#d20b27">Saydian</text><text x="50%" y="55%" text-anchor="middle" font-size="18" fill="#667085">本地推广海报</text></svg>');
const promoterDashboard = () => ({
  employee: { id: "00000000-0000-4000-8000-000000000092", name: "Saydian user", avatarUrl: null, referralCode: "29CCA1E6EB", departmentNames: [] },
  range: { key: "month", start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z", endExclusive: true, timezone: "Asia/Shanghai" },
  paidOrders: 3, salesCents: 149800, refundCents: 980, netSalesCents: 148820,
  trend: null, trendStatus: "UNAVAILABLE", trendReason: null,
  orders: [{ id: "00000000-0000-4000-8000-000000000093", orderNo: "LOCAL-PROMOTION-001", status: "PAID", payableCents: 149800, paidAt: "2026-09-13T02:30:00.000Z", createdAt: "2026-09-13T02:28:00.000Z", user: { nickname: "测试会员" } }],
  pagination: { page: 1, pageSize: 10, total: 1, hasMore: false },
  promotion: { referralCode: "29CCA1E6EB", linkUrl: "http://127.0.0.1:5188/global/saidian-mall/?ref=29CCA1E6EB", qrDataUrl: tinySvg, posterDataUrl: tinySvg }, promotionStatus: "AVAILABLE",
  bonus: { plan: { enabled: true, rateBps: 800, settlementDays: 7, withdrawalEnabled: true, minimumWithdrawCents: 10000, dailyWithdrawLimitCents: 500000, reviewRequired: true }, wallet: { frozenCents: 11986, availableCents: 23600, withdrawingCents: 0, debtCents: 0, totalPaidCents: 10000 }, walletStatus: "AVAILABLE",
    recentAccruals: [{ id: "00000000-0000-4000-8000-000000000094", employeeId: "00000000-0000-4000-8000-000000000092", orderId: "00000000-0000-4000-8000-000000000093", status: "AVAILABLE", grossBonusCents: 11984, reversedBonusCents: 0, createdAt: "2026-09-13T02:30:00.000Z" }], recentWithdrawals: [], withdrawal: { canApply: false, identity: { verified: false, accountHint: null }, pendingCount: 0, availableAmountCents: 23600, dailyUsedCents: 0, dailyRemainingCents: 500000, payoutMode: "MANUAL_RECEIPT_ONLY" } },
});
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
      scenario = "bind"; phoneRequested = false; signedIn = false;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(`<title>Local phone UI fixture</title><script>
        for (const key of Object.keys(localStorage)) if (key.startsWith('saydian-global-mall:')) localStorage.removeItem(key);
        sessionStorage.setItem('saydian-global-mall:oauth-context',JSON.stringify({state:'${state}',verifier:'${"c".repeat(64)}',consentVersion:'${legalVersion}',locale:'en',expiresAt:Date.now()+300000,returnTo:'/pages/profile/index',sessionStamp:JSON.stringify(['',JSON.stringify(['','',false])])}));
        location.replace('${base}oauth/callback?code=LOCAL-FIXTURE-NOT-A-WECHAT-CODE&state=${state}');
      </script>`);
    }
    if (url.pathname === "/fixture/promotion") {
      scenario = "promotion"; phoneRequested = false; signedIn = false;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(`<title>Local promotion UI fixture</title><script>
        for (const key of Object.keys(localStorage)) if (key.startsWith('saydian-global-mall:')) localStorage.removeItem(key);
        sessionStorage.setItem('saydian-global-mall:oauth-context',JSON.stringify({state:'${state}',verifier:'${"c".repeat(64)}',consentVersion:'${legalVersion}',locale:'en',expiresAt:Date.now()+300000,returnTo:'/pages/employee/index',sessionStamp:JSON.stringify(['',JSON.stringify(['','',false])])}));
        location.replace('${base}oauth/callback?code=LOCAL-PROMOTION-NOT-A-WECHAT-CODE&state=${state}');
      </script>`);
    }
    if (url.pathname === "/fixture/evidence") return json(evidence);
    if (url.pathname.startsWith("/global/api/saydian-app/v2/content/legal/")) return json({ code: 200, data: { version: legalVersion, locale: "en", title: "本地界面测试协议", contentHtml: "<p>仅用于本地界面测试，不发送短信，不连接真实账号。</p>" } });
    if (url.pathname === api + "/storefront/capabilities") return json(capabilities);
    if (url.pathname === api + "/storefront/bootstrap") return json({ banners: [], categories: [], featured: [], configs: {}, referral: null, capabilities });
    if (url.pathname === api + "/storefront/products") return json({ items: scenario === "promotion" ? [{ id: "00000000-0000-4000-8000-000000000095", name: "W8 Ultra-R 本地测试商品" }] : [], total: scenario === "promotion" ? 1 : 0, page: 1, pageSize: 100 });
    if (url.pathname === api + "/storefront/categories") return json([]);
    if (req.method === "GET" && url.pathname === api + "/storefront/orders") return signedIn ? json([]) : json({ message: "请重新登录" }, 401);
    if (url.pathname === api + "/auth/wechat/h5/account") { evidence.accountReads++; return signedIn ? json(activeUser()) : json({ message: "请重新登录" }, 401); }
    if (req.method === "GET" && url.pathname === api + "/storefront/promoter/dashboard") { evidence.promotionReads++; return signedIn && scenario === "promotion" ? json(promoterDashboard()) : json({ message: "请重新登录" }, 401); }
    if (req.method === "GET" && url.pathname === api + "/storefront/promoter/promotion") { evidence.promotionReads++; return signedIn && scenario === "promotion" ? json(promoterDashboard().promotion) : json({ message: "请重新登录" }, 401); }
    if (req.method === "GET" && url.pathname === api + "/storefront/promoter/coupons") { evidence.promotionReads++; return signedIn && scenario === "promotion" ? json([{ id: "00000000-0000-4000-8000-000000000096", name: "本地推广券", remainingEmployeeQuota: 2, gifts: [] }]) : json({ message: "请重新登录" }, 401); }
    if (req.method === "GET" && url.pathname === api + "/storefront/promoter/withdrawals") { evidence.promotionReads++; return signedIn && scenario === "promotion" ? json({ wallet: promoterDashboard().bonus.wallet, plan: { enabled: true, minimumWithdrawCents: 10000, dailyWithdrawLimitCents: 500000, reviewRequired: true, settlementDays: 7 }, pendingCount: 0, identity: { verified: false, accountHint: null }, canApply: false, availableAmountCents: 23600, dailyUsedCents: 0, dailyRemainingCents: 500000, payoutMode: "MANUAL_RECEIPT_ONLY", withdrawals: [] }) : json({ message: "请重新登录" }, 401); }
    if (req.method === "POST") {
      let raw = ""; for await (const part of req) { raw += part; if (raw.length > 8192) return json({}, 413); }
      const body = JSON.parse(raw || "{}");
      if (url.pathname === api + "/auth/wechat/h5/login") {
        assert.equal(body.code, scenario === "promotion" ? "LOCAL-PROMOTION-NOT-A-WECHAT-CODE" : "LOCAL-FIXTURE-NOT-A-WECHAT-CODE"); evidence.oauth++;
        if (scenario === "promotion") { signedIn = true; return json(session("/pages/employee/index")); }
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
      evidence.rejectedWrites++; return json({ message: "本地场景不支持此操作" }, 400);
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
