// Opt-in synthetic acceptance against the international instance only.
// Never activates integrations, exchanges a WeChat code, sends an OTP, or uses
// real member data. Readiness checks are not a real WeChat authorization receipt.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-wechat-h5"), "Explicit --synthetic-wechat-h5 opt-in is required");
assert(process.env.APP_REALM === "global", "Run only in the international API container");
assert(new URL(process.env.DATABASE_URL).pathname === "/saydian_global", "Unexpected database");
setDefaultResultOrder("ipv4first");
const require = createRequire("/workspace/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const { sign } = require("jsonwebtoken");
const prisma = new PrismaClient();
const origin = "https://app.saydian.cn";
const mall = "/global/api/saidian-mall/v1";
const app = "/global/api/saydian-app/v2";
const storefront = "/global/saidian-mall/";
const marker = `qa.wechat-h5.${Date.now()}.${randomBytes(5).toString("hex")}`;
const password = randomBytes(30).toString("base64url");
const subjects = [];
let checks = 0;
const evidence = { requests: [], syntheticRemoved: false, realWechatExchange: false, realOtpDelivery: false };
function check(value, message) { assert(value, message); checks++; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

async function request(path, { token, body, expected = body === undefined ? 200 : 201, raw = true, headers = {} } = {}) {
  assert(path.startsWith(mall + "/") || path.startsWith(app + "/"), "Refuse an API outside the fixed global prefixes");
  assert(!/(?:verification-code|sms\/request|register|send-code|binding-code)/.test(path), "This smoke must never request OTP delivery or public registration");
  // These inputs are deliberately invalid at multiple independent boundaries.
  // The script never submits a valid OAuth code or valid verifier, even if the
  // real integration has subsequently been configured by an authorized operator.
  if (path.endsWith("/auth/wechat/h5/login")) {
    assert(body?.code === "" && body?.codeVerifier === "invalid-synthetic-verifier", "Refuse any potentially exchangeable OAuth request");
  }
  if (/\/auth\/wechat\/h5\/bind-(?:account|code)$/.test(path)) {
    assert(body?.bindTicket === "invalid-synthetic-ticket", "Refuse a usable WeChat binding ticket in this gate-only smoke");
  }
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  check((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${path}: unexpected HTTP ${response.status}`);
  evidence.requests.push({ path, status: response.status });
  return raw ? result : result.data;
}

async function createSubject(label, verified, mobile = null) {
  const email = `${marker}.${label}@example.invalid`;
  const user = await prisma.user.create({ data: {
    email, ...(mobile ? { mobile, mobileVerifiedAt: new Date() } : {}),
    ...(verified && !mobile ? { emailVerifiedAt: new Date() } : {}),
    passwordHash: await hash(password, 12), nickname: "Synthetic international H5 acceptance", locale: "en",
  } });
  subjects.push({ id: user.id, email });
  return user;
}

async function syntheticSession(userId) {
  const id = randomUUID(), jti = randomUUID(), refreshToken = randomBytes(32).toString("base64url");
  await prisma.userSession.create({ data: {
    id, userId, accessJti: jti,
    refreshTokenHash: sha256(`${refreshToken}:${process.env.REFRESH_TOKEN_PEPPER}`),
    expiresAt: new Date(Date.now() + 300_000),
  } });
  const claims = { sub: userId, sid: id, typ: "access" };
  const options = { algorithm: "HS256", expiresIn: 300, jwtid: jti, issuer: "saydian-global-server", audience: "saydian-global-app" };
  return { id, refreshToken, token: sign(claims, process.env.ACCESS_TOKEN_SECRET, options),
    wrongRealmToken: sign(claims, process.env.ACCESS_TOKEN_SECRET, { ...options, issuer: "saydianapp-server", audience: "saydian-app" }) };
}

async function staticPage(path) {
  const response = await fetch(origin + path, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  check(response.status === 200 && response.headers.get("content-type")?.includes("text/html"), `H5 route is not HTML: ${path}`);
  const html = await response.text();
  check(html.includes('<div id="app"'), `H5 application mount missing: ${path}`);
  if (path.includes("/oauth/callback")) {
    check(response.headers.get("cache-control")?.includes("no-store"), "OAuth callback must not be cached");
    check(response.headers.get("referrer-policy") === "no-referrer", "OAuth callback must not forward code/state through Referer");
  }
  return html;
}

try {
  const html = await staticPage(storefront);
  await staticPage(storefront + "oauth/callback?code=synthetic-route-only&state=synthetic-route-only");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match => match[1]);
  check(scripts.length > 0, "H5 entry has no script assets");
  for (const src of scripts.slice(0, 3)) {
    const url = new URL(src, origin + storefront);
    check(url.origin === origin && url.pathname.startsWith(storefront), "H5 script must stay in its independent global static tree");
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    check(response.status === 200 && !response.headers.get("content-type")?.includes("text/html") && !text.trimStart().startsWith("<!DOCTYPE"), "Missing H5 asset was disguised as the SPA HTML");
  }
  const missingAsset = await fetch(origin + storefront + "assets/synthetic-missing-" + marker + ".js", { redirect: "error", signal: AbortSignal.timeout(20_000) });
  check(missingAsset.status === 404, "Missing global H5 assets must return 404, not SPA HTML");

  const capabilities = await request(mall + "/storefront/capabilities");
  check(typeof capabilities.login?.wechatH5?.enabled === "boolean", "Missing official-account capability state");
  check(!JSON.stringify(capabilities).match(/appSecret|privateKey|refreshToken|accessToken/), "Public capabilities exposed a credential field");
  evidence.wechatH5Enabled = capabilities.login.wechatH5.enabled;
  evidence.maintenanceReadOnly = capabilities.maintenance?.readOnly === true;
  const legal = await request(app + "/auth/capabilities?locale=en", { raw: false });
  check(legal.realm === "global", "Unexpected account realm");
  if (legal.legal) {
    for (const document of Object.values(legal.legal)) {
      check(typeof document.path === "string" && document.path.startsWith("/api/saydian-app/v2/content/legal/"), "Legal document path is outside the global App API");
      await request("/global" + document.path, { raw: false });
    }
  }

  // Do not bypass existing read-only controls just to run mutation checks.
  check(!evidence.maintenanceReadOnly, "Business writes are paused; stop without changing runtime maintenance controls");
  const emailMember = await createSubject("verified-email", true);
  const unverified = await createSubject("unverified", false);
  // NANP 202-555-0100..0199 are synthetic test numbers; never send an SMS.
  let phone;
  for (let n = 100; n <= 199; n++) {
    const candidate = `+12025550${n}`;
    if (!(await prisma.user.findUnique({ where: { mobile: candidate }, select: { id: true } }))) { phone = candidate; break; }
  }
  check(Boolean(phone), "No unused synthetic telephone identifier is available; do not modify existing users");
  const phoneMember = await createSubject("verified-phone", false, phone);

  const login = await request(mall + "/auth/password/login", { body: { mobile: emailMember.email, identifier: emailMember.email, password } });
  check(login.user?.id === emailMember.id && typeof login.token === "string" && typeof login.refreshToken === "string", "Verified email login must keep raw mall session shape and member ownership");
  check(!JSON.stringify(login.user).match(/passwordHash|mobileVerifiedAt|emailVerifiedAt/), "Login response exposed internal account verification fields");
  await request(mall + "/storefront/cart", { token: login.token });
  const profile = await request(app + "/members/me", { token: login.token, raw: false });
  check(profile.id === emailMember.id, "App and H5 must resolve the same international member");
  const refreshed = await request(mall + "/auth/refresh", { body: { refreshToken: login.refreshToken } });
  check(refreshed.user?.id === emailMember.id && refreshed.token !== login.token && refreshed.refreshToken !== login.refreshToken, "H5 refresh did not rotate the same member's session");
  await request(mall + "/auth/refresh", { body: { refreshToken: login.refreshToken }, expected: 401 });
  await request(mall + "/storefront/cart", { token: login.token, expected: 401 });
  await request(mall + "/storefront/cart", { token: refreshed.token });

  const phoneLogin = await request(mall + "/auth/password/login", { body: { mobile: phoneMember.mobile, identifier: phoneMember.mobile, password } });
  check(phoneLogin.user?.id === phoneMember.id, "Verified international phone login did not preserve member ownership");
  await request(mall + "/auth/password/login", { body: { mobile: unverified.email, identifier: unverified.email, password }, expected: 403 });
  const unverifiedSession = await syntheticSession(unverified.id);
  await request(mall + "/storefront/cart", { token: unverifiedSession.token, expected: 401 });
  await request(mall + "/auth/refresh", { body: { refreshToken: unverifiedSession.refreshToken }, expected: 403 });
  const retained = await prisma.userSession.findUnique({ where: { id: unverifiedSession.id }, select: { refreshTokenHash: true, revokedAt: true } });
  check(retained?.refreshTokenHash === sha256(`${unverifiedSession.refreshToken}:${process.env.REFRESH_TOKEN_PEPPER}`) && !retained.revokedAt,
    "Rejected unverified mall refresh must not rotate or revoke the original App session");
  const emailSession = await syntheticSession(emailMember.id);
  await request(mall + "/storefront/cart", { token: emailSession.wrongRealmToken, headers: { "X-App-Realm": "global", "X-Realm": "global" }, expected: 401 });
  await prisma.user.update({ where: { id: emailMember.id }, data: { status: "DISABLED" } });
  await request(mall + "/storefront/cart", { token: emailSession.token, expected: 401 });
  await request(mall + "/auth/refresh", { body: { refreshToken: refreshed.refreshToken }, expected: 401 });
  await prisma.user.update({ where: { id: emailMember.id }, data: { status: "ACTIVE" } });
  await prisma.userSession.update({ where: { id: emailSession.id }, data: { revokedAt: new Date() } });
  await request(mall + "/storefront/cart", { token: emailSession.token, expected: 401 });

  // No OAuth state is created here. Empty code + invalid verifier + random,
  // absent state ensure this endpoint cannot reach the WeChat exchange boundary.
  await request(mall + "/auth/wechat/h5/login", { body: {
    code: "", state: randomBytes(32).toString("hex"), codeVerifier: "invalid-synthetic-verifier",
    consentVersion: legal.consentVersion ?? "", locale: "en", consentAccepted: true,
  }, expected: [400, 401, 409, 503] });
  // External return URLs must be rejected or the entire feature must be closed.
  await request(mall + "/auth/wechat/h5/authorize-url", { body: {
    returnTo: "https://external.example.invalid/", codeChallenge: sha256("synthetic".repeat(8)),
    consentVersion: legal.consentVersion ?? "", locale: "en", consentAccepted: true,
  }, expected: [400, 409, 503] });
  await request(mall + "/auth/wechat/h5/bind-account", { body: {
    bindTicket: "invalid-synthetic-ticket", identifier: emailMember.email, password,
    consentVersion: legal.consentVersion ?? "", locale: "en",
  }, expected: [400, 401, 409, 503] });
  await request(mall + "/auth/wechat/h5/bind-code", { body: {
    bindTicket: "invalid-synthetic-ticket", challengeId: randomUUID(), code: "", password,
    consentVersion: legal.consentVersion ?? "", locale: "en",
  }, expected: [400, 401, 409, 503] });
  check(await prisma.wechatOfficialIdentity.count({ where: { userId: { in: subjects.map(subject => subject.id) } } }) === 0, "Gate tests must not bind a WeChat identity");
  check(await prisma.globalVerificationChallenge.count({ where: { identifier: { in: [...subjects.map(subject => subject.email), phone] } } }) === 0, "Gate tests must not create an OTP challenge");
} finally {
  for (const subject of subjects) {
    const row = await prisma.user.findUnique({ where: { id: subject.id }, select: { id: true, email: true } });
    if (!row) continue;
    assert(row.email === subject.email && row.email.startsWith(marker + ".") && row.email.endsWith("@example.invalid"), "Refuse to remove anything except this run's exact synthetic member");
    await prisma.user.delete({ where: { id: subject.id } });
  }
  evidence.syntheticRemoved = (await prisma.user.count({ where: { id: { in: subjects.map(subject => subject.id) } } })) === 0;
  await prisma.$disconnect();
  check(evidence.syntheticRemoved, "Synthetic members were not fully removed");
  console.log(JSON.stringify({ ...evidence, checks }));
}
