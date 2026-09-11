// Explicit synthetic HTTP acceptance for the global phone-entry test mode.
// The synthetic bind ticket stands in for an already-validated OAuth callback.
// Never exchanges real WeChat codes, sends SMS, or reads/modifies real members.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";

assert(process.argv.includes("--synthetic-phone-test"), "Explicit synthetic opt-in is required");
assert.equal(process.env.APP_REALM, "global");
assert.equal(new URL(process.env.DATABASE_URL).pathname, "/saydian_global");
assert.equal(process.env.GLOBAL_WECHAT_PHONE_TEST_ENABLED, "true", "Do not activate test mode from a smoke script");
assert.equal(process.env.ALLOW_TEST_OTP, "false", "General OTP bypass must stay disabled");
assert.equal(process.env.GLOBAL_SMS_PROVIDER, "disabled", "Real SMS must remain impossible even if the phone-test switch changes");
setDefaultResultOrder("ipv4first");
const require = createRequire("/workspace/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const prefix = "/global/api/saidian-mall/v1", app = "/global/api/saydian-app/v2";
const marker = `synthetic-phone-test-${randomBytes(12).toString("hex")}`;
const startedAt = Date.now();
const ticket = randomBytes(32).toString("hex"), appId = "wx7e7ce80930fa40f4";
const digest = value => createHash("sha256").update(value).digest("hex");
const ticketHash = digest(ticket);
let phone, challengeId, userId, phoneReservation, checks = 0;
const evidence = { syntheticRemoved: false, realWechatExchange: false, smsSent: false, steps: [] };
function check(value, message) { assert(value, message); checks++; }
async function request(path, { body, token, expected = body === undefined ? 200 : 201 } = {}) {
  assert([prefix + "/storefront/capabilities?locale=en", prefix + "/auth/wechat/h5/phone-code", prefix + "/auth/wechat/h5/bind-phone", prefix + "/auth/wechat/h5/account", prefix + "/auth/refresh", app + "/auth/refresh", app + "/auth/logout", app + "/members/me", prefix + "/storefront/orders"].includes(path));
  const response = await fetch("https://app.saydian.cn" + path, { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  check([expected].flat().includes(response.status), `Unexpected HTTP ${response.status} for ${path}`);
  evidence.steps.push({ path, status: response.status }); return response.json();
}
try {
  const caps = await request(prefix + "/storefront/capabilities?locale=en");
  check(caps.realm === "global" && caps.login.wechatBinding.phoneCodeMode === "test", "Live test capability not enabled");
  check(caps.login.wechatBinding.smsOtpAvailable === false && caps.checkout.enabled === false, "Real SMS and checkout must remain closed");
  check(typeof caps.consentVersion === "string" && Boolean(caps.consentVersion), "Reviewed legal version missing");
  // NANP 555-01xx is a fictional-number block; never sends to these numbers.
  for (let suffix = 10; suffix < 99; suffix++) {
    const candidate = `+165055501${String(suffix).padStart(2, "0")}`;
    if (!await prisma.user.findUnique({ where: { mobile: candidate }, select: { id: true } }) &&
        !await prisma.globalVerificationChallenge.findFirst({ where: { identifier: candidate }, select: { id: true } }) &&
        !await prisma.globalVerificationThrottle.findUnique({ where: { key: digest(`sms:${candidate}`) } })) { phone = candidate; break; }
  }
  check(Boolean(phone), "No unused fictional phone available; no existing data changed");
  await prisma.commerceWechatBindTicket.create({ data: { tokenHash: ticketHash, appId, openId: marker, returnTo: "/pages/profile/index", expiresAt: new Date(Date.now() + 300_000) } });
  const code = await request(prefix + "/auth/wechat/h5/phone-code", { body: { bindTicket: ticket, identifier: phone, locale: "en" } });
  challengeId = code.challengeId;
  phoneReservation = await prisma.globalVerificationThrottle.findUnique({ where: { key: digest(`sms:${phone}`) } });
  check(code.mode === "test" && code.sent === false && code.verificationRequired === false, "Temporary challenge must not claim delivery");
  const challenge = await prisma.globalVerificationChallenge.findUnique({ where: { id: challengeId } });
  check(challenge?.sentAt === null && challenge.purpose === "wechat_phone_test", "Test purpose or delivery metadata incorrect");
  const payload = { bindTicket: ticket, challengeId, code: "987654", consentVersion: caps.consentVersion, locale: "en" };
  const outcomes = await Promise.allSettled([1, 2].map(() => request(prefix + "/auth/wechat/h5/bind-phone", { body: payload, expected: [201, 400, 401, 409] })));
  check(outcomes.every(result => result.status === "fulfilled"), "Concurrent phone requests did not complete as expected");
  const competing = outcomes.map(result => result.value);
  check(competing.filter(result => result.token).length === 1, "Competing phone submissions must create exactly one session");
  const session = competing.find(result => result.token);
  userId = session.user?.id;
  check(Boolean(userId) && session.user.phoneTestMode === true, "Missing restricted test session");
  const user = await prisma.user.findUnique({ where: { id: userId } });
  check(user?.mobile === phone && user.mobileVerifiedAt === null && user.email === null && user.passwordHash === null, "Phone ownership or password must not be fabricated");
  const identity = await prisma.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId: marker } } });
  check(identity?.userId === userId, "Synthetic identity mapped to the wrong user");
  const own = await request(prefix + "/auth/wechat/h5/account", { token: session.token });
  check(own.id === userId && own.phoneVerified === false && own.phoneVerificationStatus === "pending", "Safe account readback mismatch");
  await request(app + "/members/me", { token: session.token, expected: 401 });
  await request(prefix + "/storefront/orders", { token: session.token, expected: 401 });
  await request(app + "/auth/refresh", { body: { refreshToken: session.refreshToken }, expected: 401 });
  const rotated = await request(prefix + "/auth/refresh", { body: { refreshToken: session.refreshToken } });
  check(rotated.token !== session.token && rotated.user.phoneTestMode === true, "Refresh must retain restricted provenance");
  const savedSession = await prisma.userSession.findFirst({ where: { userId, revokedAt: null } });
  check(savedSession?.accessJti.startsWith("h5-phone-test:"), "Session provenance was lost on rotation");
  await request(prefix + "/auth/wechat/h5/bind-phone", { body: payload, expected: 401 });
  await request(app + "/auth/logout", { token: rotated.token, body: {} });
  await request(prefix + "/auth/wechat/h5/account", { token: rotated.token, expected: 401 });
  await request(prefix + "/auth/refresh", { body: { refreshToken: rotated.refreshToken }, expected: 401 });
} finally {
  // Resolve only this cryptographically unique synthetic identity before cleanup.
  const owned = await prisma.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId: marker } } });
  if (owned) {
    const candidate = await prisma.user.findUnique({ where: { id: owned.userId }, include: { wechatOfficialIdentities: true } });
    const safe = (!userId || userId === owned.userId) && candidate && candidate.createdAt.valueOf() >= startedAt && candidate.mobile === phone &&
      candidate.email === null && candidate.passwordHash === null && candidate.mobileVerifiedAt === null && candidate.emailVerifiedAt === null &&
      candidate.wechatOfficialIdentities.length === 1 && candidate.wechatOfficialIdentities[0].openId === marker;
    if (safe) await prisma.user.delete({ where: { id: owned.userId } });
    else evidence.cleanupBlocked = true;
  }
  const ownChallenges = phone ? (await prisma.globalVerificationChallenge.findMany({ where: { identifier: phone, purpose: "wechat_phone_test", createdAt: { gte: new Date(startedAt) } }, select: { id: true, codeHash: true } }))
    .filter(row => row.codeHash === digest(`global:${row.id}:${process.env.REFRESH_TOKEN_PEPPER}:wechat-phone-test:${ticketHash}`)).map(row => row.id) : [];
  if (ownChallenges.length) await prisma.globalVerificationChallenge.deleteMany({ where: { id: { in: ownChallenges }, identifier: phone, purpose: "wechat_phone_test" } });
  await prisma.commerceWechatBindTicket.deleteMany({ where: { tokenHash: ticketHash, appId, openId: marker } });
  await prisma.globalVerificationThrottle.deleteMany({ where: { key: digest(`wechat-bind-ticket:${ticketHash}`) } });
  if (phoneReservation) await prisma.globalVerificationThrottle.deleteMany({ where: { key: phoneReservation.key, reservedAt: phoneReservation.reservedAt } });
  const remainingPhoneReservation = phone && await prisma.globalVerificationThrottle.findUnique({ where: { key: digest(`sms:${phone}`) } });
  evidence.syntheticRemoved = !evidence.cleanupBlocked && !await prisma.wechatOfficialIdentity.findUnique({ where: { appId_openId: { appId, openId: marker } } }) &&
    (!userId || !await prisma.user.findUnique({ where: { id: userId } })) && !await prisma.commerceWechatBindTicket.findUnique({ where: { tokenHash: ticketHash } }) &&
    !await prisma.globalVerificationChallenge.count({ where: { id: { in: ownChallenges } } }) &&
    (!remainingPhoneReservation || (phoneReservation && remainingPhoneReservation.reservedAt.valueOf() !== phoneReservation.reservedAt.valueOf()));
  await prisma.$disconnect();
}
check(evidence.syntheticRemoved, "Synthetic cleanup incomplete");
console.log(JSON.stringify({ checks, ...evidence }));
