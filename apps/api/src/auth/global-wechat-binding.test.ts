import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { GlobalWechatBindingService } from "./global-wechat-binding.service";
import { WechatH5AuthService, officialRedirectUri } from "./wechat-h5-auth.service";
import { CommerceCapabilitiesService } from "../commerce/commerce-capabilities.service";
import { AuthService } from "./auth.service";
import { sha256 } from "../common/crypto";

const appId = "wx1234567890abcdef", bindTicket = "a".repeat(64), stateText = "e".repeat(64), verifier = "v".repeat(64);
const password = "Synthetic-password-0001", memberId = "11111111-1111-4111-8111-111111111111";
const redirectUri = "https://demo.invalid/global/saidian-mall/oauth/callback";
let originalHash: string;
beforeAll(async () => { originalHash = await hash(password, 4); });
beforeEach(() => {
  for (const [key, value] of Object.entries({ APP_REALM: "global", GLOBAL_WECHAT_H5_ENABLED: "true", H5_DEMO_ENABLED: "false", BUSINESS_WRITES_PAUSED: "false", MAINTENANCE_READ_ONLY: "false", COMMERCE_STOREFRONT_URL: "https://demo.invalid/global/saidian-mall/", REFRESH_TOKEN_PEPPER: "synthetic-pepper-only", GLOBAL_UNVERIFIED_REGISTRATION_ENABLED: "true" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("External calls are forbidden; positive provider responses must be synthetic")));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function harness(existing = true, verified = true) {
  let state: any = {
    users: existing ? [{ id: memberId, email: "member@example.com", mobile: null, emailVerifiedAt: verified ? new Date() : null, mobileVerifiedAt: null, status: "ACTIVE", passwordHash: originalHash, nickname: "Existing", locale: "en" }] : [],
    identities: [], challenges: [], throttles: [], sessions: [], oldSessionsRevoked: false, consents: [],
    tickets: [{ tokenHash: sha256(bindTicket), appId, openId: "official-openid-one", unionId: "metadata-only-union", returnTo: "/pages/profile/index", expiresAt: new Date(Date.now() + 300_000), consumedAt: null }],
  };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("lt" in value) return row[key] < value.lt;
      if ("lte" in value) return row[key] <= value.lte;
      if ("gt" in value) return row[key] > value.gt;
      if ("not" in value) return row[key] !== value.not;
    }
    return row[key] === value;
  });
  const updateRows = (rows: any[], { where, data }: any) => { const found = rows.filter(row => matches(row, where)); for (const row of found) for (const [key, value] of Object.entries(data) as any) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value; return { count: found.length }; };
  const db: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: {
      findUnique: vi.fn(async ({ where }: any) => state.users.find((row: any) => matches(row, where)) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.users.find((row: any) => matches(row, where)), data)),
      create: vi.fn(async ({ data }: any) => { const row = { id: randomUUID(), status: "ACTIVE", emailVerifiedAt: null, mobileVerifiedAt: null, ...data }; state.users.push(row); return row; }),
    },
    userSession: { updateMany: vi.fn(async () => { state.oldSessionsRevoked = true; return { count: 2 }; }) },
    integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: "CONFIGURED", publicConfig: { redirectUri } }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    globalLegalDocument: { findMany: vi.fn().mockResolvedValue(["user_agreement", "privacy_policy"].map(documentType => ({ documentType, version: "legal-v1", locale: "en", contentHtml: "Synthetic reviewed legal text" }))) },
    consentRecord: { upsert: vi.fn(async ({ create }: any) => { state.consents.push(create); return create; }) },
    wechatOfficialIdentity: {
      findUnique: vi.fn(async ({ where }: any) => state.identities.find((row: any) => matches(row, where.appId_openId ?? where.userId_appId)) ?? null),
      create: vi.fn(async ({ data }: any) => { const row = { id: randomUUID(), ...data }; state.identities.push(row); return row; }),
    },
    commerceWechatBindTicket: {
      findUnique: vi.fn(async ({ where }: any) => state.tickets.find((row: any) => matches(row, where)) ?? null),
      updateMany: vi.fn(async (input: any) => updateRows(state.tickets, input)),
      create: vi.fn(async ({ data }: any) => { state.tickets.push({ consumedAt: null, ...data }); return data; }),
    },
    commerceOAuthState: {
      create: vi.fn(), findUnique: vi.fn().mockResolvedValue({ stateHash: sha256(stateText), codeChallenge: sha256(verifier), appId, returnTo: "/pages/profile/index", referralCode: null, expiresAt: new Date(Date.now() + 300_000), consumedAt: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    globalVerificationThrottle: {
      upsert: vi.fn(async ({ create }: any) => { if (!state.throttles.some((row: any) => row.key === create.key)) state.throttles.push(create); }),
      updateMany: vi.fn(async (input: any) => updateRows(state.throttles, input)),
    },
    globalVerificationChallenge: {
      count: vi.fn(async ({ where }: any) => state.challenges.filter((row: any) => matches(row, where)).length),
      create: vi.fn(async ({ data }: any) => { state.challenges.push({ ...data, attempts: 0, createdAt: new Date(), sentAt: null, consumedAt: null }); }),
      findUnique: vi.fn(async ({ where }: any) => state.challenges.find((row: any) => matches(row, where)) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.challenges.find((row: any) => matches(row, where)), data)),
      updateMany: vi.fn(async (input: any) => updateRows(state.challenges, input)),
    },
  };
  // Model database transaction serialization and rollback without live data.
  let tail = Promise.resolve();
  db.$transaction = vi.fn((run: any) => { const result = tail.then(async () => { const before = structuredClone(state); try { return await run(db); } catch (error) { state = before; throw error; } }); tail = result.then(() => undefined, () => undefined); return result; });
  const auth: any = { issueMallSession: vi.fn(async (id: string) => { const user = state.users.find((row: any) => row.id === id); if (!user || user.status !== "ACTIVE" || !(user.emailVerifiedAt || user.mobileVerifiedAt)) throw new Error("verified gate"); state.sessions.push(id); return { token: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: new Date().toISOString(), user: { id, mobile: user.mobile, nickname: user.nickname } }; }) };
  const delivery: any = { capabilities: vi.fn().mockResolvedValue({ email: true, sms: true, smsCountries: ["US", "DE"] }), assertAvailable: vi.fn().mockResolvedValue({}), send: vi.fn().mockResolvedValue(undefined) };
  const secrets: any = { resolve: vi.fn().mockResolvedValue({ appId, appSecret: "synthetic-official-secret-only" }) };
  const binding = new GlobalWechatBindingService(db, auth, delivery);
  const h5 = new WechatH5AuthService(db, auth, secrets, binding);
  const capabilities = new CommerceCapabilitiesService(db, secrets, h5);
  return { db, auth, delivery, binding, h5, capabilities, get state() { return state; } };
}
const accountInput = () => ({ bindTicket, identifier: "MEMBER@example.com", password, consentVersion: "legal-v1", locale: "en" });
const codeRequest = () => ({ bindTicket, channel: "email", identifier: "member@example.com", locale: "en" });
async function codeInput(h: ReturnType<typeof harness>) { const response = await h.binding.requestCode(appId, codeRequest()); return { bindTicket, challengeId: response.challengeId, code: h.delivery.send.mock.calls.at(-1)![0].code, password, consentVersion: "legal-v1", locale: "en" }; }

describe("global WeChat gate, callback and consent", () => {
  it.each(["flag", "demo", "maintenance"])("fails closed at capability and direct OAuth before persistence: %s", async scenario => {
    if (scenario === "flag") vi.stubEnv("GLOBAL_WECHAT_H5_ENABLED", "false");
    if (scenario === "demo") vi.stubEnv("H5_DEMO_ENABLED", "true");
    if (scenario === "maintenance") vi.stubEnv("BUSINESS_WRITES_PAUSED", "true");
    const h = harness(); expect((await h.capabilities.publicCapabilities()).login.wechatH5.enabled).toBe(false);
    await expect(h.h5.authorize({ returnTo: "/pages/profile/index", codeChallenge: sha256(verifier), consentVersion: "legal-v1" })).rejects.toMatchObject({ status: 503 });
    await expect(h.binding.bindAccount(appId, accountInput())).rejects.toMatchObject({ status: 503 });
    expect(h.db.commerceOAuthState.create).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["https://demo.invalid/saidian-mall/oauth/callback", redirectUri + "?next=bad", redirectUri + "#/pages/login/index", "https://evil.invalid/global/saidian-mall/oauth/callback", "http://localhost/global/saidian-mall/oauth/callback"])("requires the exact international HTTPS callback: %s", url => {
    expect(() => officialRedirectUri(url, url.includes("localhost") ? "http://localhost/global/saidian-mall/" : "https://demo.invalid/global/saidian-mall/")).toThrow();
  });
  it("builds only the configured official authorization and does not mutate native/mini/WeCom identity", async () => {
    const h = harness(); const result = await h.h5.authorize({ returnTo: "/pages/profile/index", codeChallenge: sha256(verifier), consentVersion: "legal-v1", locale: "en" });
    const url = new URL(result.authorizeUrl); expect(url.searchParams.get("appid")).toBe(appId); expect(url.searchParams.get("redirect_uri")).toBe(redirectUri); expect(url.searchParams.get("scope")).toBe("snsapi_base");
    expect(h.db.user.update).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps authorization unavailable for missing/currently replaced legal documents", async () => {
    const h = harness(); h.db.globalLegalDocument.findMany.mockResolvedValue([]);
    expect((await h.capabilities.publicCapabilities()).login.wechatH5.enabled).toBe(false);
    await expect(h.h5.authorize({ returnTo: "/", codeChallenge: sha256(verifier), consentVersion: "legal-v1" })).rejects.toMatchObject({ status: 503 });
    expect(h.db.commerceOAuthState.create).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an invalid verifier/state and stale consent without exchanging a code", async () => {
    const h = harness();
    await expect(h.h5.login({ code: "test", state: stateText, codeVerifier: "x".repeat(64), consentVersion: "legal-v1" })).rejects.toMatchObject({ status: 401 });
    await expect(h.h5.login({ code: "test", state: stateText, codeVerifier: verifier, consentVersion: "old" })).rejects.toMatchObject({ status: 409 });
    expect(fetch).not.toHaveBeenCalled(); expect(h.db.commerceOAuthState.updateMany).not.toHaveBeenCalled();
  });
  it("logs an already scoped verified-email identity in without needing a Chinese phone", async () => {
    const h = harness(); h.state.identities.push({ id: randomUUID(), appId, openId: "official-openid-one", userId: memberId });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ openid: "official-openid-one", access_token: "synthetic", scope: "snsapi_base" })));
    expect(await h.h5.login({ code: "test-code", state: stateText, codeVerifier: verifier, consentVersion: "legal-v1", locale: "en" })).toMatchObject({ requiresAccountBinding: false, requiresMobileBinding: false, user: { id: memberId } });
    expect(h.state.consents).toHaveLength(2); expect(h.db.user.update).not.toHaveBeenCalled();
  });
  it("does not grant a known but unverified identity a mall session", async () => {
    const h = harness(true, false); h.state.identities.push({ id: randomUUID(), appId, openId: "official-openid-one", userId: memberId });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ openid: "official-openid-one", access_token: "synthetic", scope: "snsapi_base" })));
    expect(await h.h5.login({ code: "test-code", state: stateText, codeVerifier: verifier, consentVersion: "legal-v1" })).toMatchObject({ requiresAccountBinding: true, requiresMobileBinding: true });
    expect(h.auth.issueMallSession).not.toHaveBeenCalled(); expect(h.db.user.update).not.toHaveBeenCalled();
  });
  it("advertises distinct unavailable binding channels without enabling checkout or payments", async () => {
    const h = harness(); h.delivery.capabilities.mockResolvedValue({ email: false, sms: false, smsCountries: [] });
    expect(await h.capabilities.publicCapabilities()).toMatchObject({ realm: "global", consentVersion: "legal-v1", login: { wechatH5: { enabled: true }, wechatBinding: { bindExistingAvailable: true, emailOtpAvailable: false, smsOtpAvailable: false, email: { reason: expect.any(String) }, sms: { reason: expect.any(String) } } }, checkout: { enabled: false }, payments: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("global password identity binding", () => {
  it("binds the exact existing verified account and preserves its password/verified fields", async () => {
    const h = harness(); const before = structuredClone(h.state.users[0]);
    expect(await h.binding.bindAccount(appId, accountInput())).toMatchObject({ requiresAccountBinding: false, user: { id: memberId } });
    expect(h.state.users[0]).toEqual(before); expect(h.state.identities[0]).toMatchObject({ appId, userId: memberId, unionId: "metadata-only-union" }); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects password-only elevation of a temporarily unverified account", async () => {
    const h = harness(true, false);
    await expect(h.binding.bindAccount(appId, accountInput())).rejects.toMatchObject({ status: 403, response: expect.objectContaining({ errorKey: "account_verification_required" }) });
    expect(h.state.identities).toHaveLength(0); expect(h.state.tickets[0].consumedAt).toBeNull();
  });
  it.each(["wrong-password", "disabled-config", "disabled-user", "old-consent", "wrong-app", "expired-ticket"])("rejects %s without a session or binding", async scenario => {
    const h = harness(); const input = accountInput();
    if (scenario === "wrong-password") input.password = "Wrong-password";
    if (scenario === "disabled-config") h.db.integrationConfig.findUnique.mockResolvedValue({ state: "DISABLED" });
    if (scenario === "disabled-user") h.state.users[0].status = "FROZEN";
    if (scenario === "old-consent") input.consentVersion = "old";
    if (scenario === "wrong-app") h.state.tickets[0].appId = "wxOtherAppId000000";
    if (scenario === "expired-ticket") h.state.tickets[0].expiresAt = new Date(0);
    await expect(h.binding.bindAccount(appId, input)).rejects.toThrow(); expect(h.state.identities).toHaveLength(0); expect(h.auth.issueMallSession).not.toHaveBeenCalled();
  });
  it.each(["openid", "account"])("will not replace a conflicting %s binding", async kind => {
    const h = harness(); h.state.identities.push({ id: randomUUID(), appId, openId: kind === "openid" ? "official-openid-one" : "different-openid", userId: kind === "account" ? memberId : randomUUID() });
    await expect(h.binding.bindAccount(appId, accountInput())).rejects.toMatchObject({ status: 409 });
    expect(h.state.identities).toHaveLength(1); expect(h.state.tickets[0].consumedAt).toBeNull();
  });
  it("only one concurrent claimant may consume a ticket", async () => {
    const h = harness(); const outcomes = await Promise.allSettled([h.binding.bindAccount(appId, accountInput()), h.binding.bindAccount(appId, accountInput())]);
    expect(outcomes.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(h.state.identities).toHaveLength(1); expect(h.state.sessions).toHaveLength(1);
  });
  it("rejects stale login identity reads after unbinding", async () => {
    const h = harness(); h.db.wechatOfficialIdentity.findUnique.mockResolvedValueOnce({ id: randomUUID(), appId, openId: "official-openid-one", userId: memberId }).mockResolvedValue(null);
    await expect(h.binding.linkedUser(appId, "official-openid-one", "legal-v1", "en")).rejects.toMatchObject({ status: 401 }); expect(h.state.consents).toHaveLength(0);
  });
});

describe("ticket-scoped international binding verification", () => {
  it("returns opaque challenge metadata and creates a verified new email account only after OTP", async () => {
    const h = harness(false); const input = await codeInput(h);
    expect(h.state.challenges[0]).toMatchObject({ purpose: "wechat_bind", sentAt: expect.any(Date) });
    expect(h.state.users).toHaveLength(0); expect(h.delivery.send.mock.calls[0][0].purpose).toBe("wechat_bind");
    const result = await h.binding.bindCode(appId, input);
    expect(result).toMatchObject({ requiresAccountBinding: false, user: { id: expect.any(String) } });
    expect(h.state.users[0]).toMatchObject({ email: "member@example.com", emailVerifiedAt: expect.any(Date), mobileVerifiedAt: null }); expect(h.state.users[0].passwordHash).toMatch(/^\$2b\$12\$/);
    expect(h.state.challenges[0].consumedAt).toBeInstanceOf(Date); expect(h.state.tickets[0].consumedAt).toBeInstanceOf(Date); expect(fetch).not.toHaveBeenCalled();
  });
  it("normalizes international phone binding without any Chinese-number fallback", async () => {
    const h = harness(false); const response = await h.binding.requestCode(appId, { ...codeRequest(), channel: "sms", identifier: "+12025550123" });
    await h.binding.bindCode(appId, { bindTicket, challengeId: response.challengeId, code: h.delivery.send.mock.calls[0][0].code, password, consentVersion: "legal-v1" });
    expect(h.state.users[0]).toMatchObject({ mobile: "+12025550123", mobileVerifiedAt: expect.any(Date), emailVerifiedAt: null });
    expect(h.delivery.assertAvailable).toHaveBeenCalledWith("sms", "US");
  });
  it("keeps an existing verified user's password and ID, requiring that old password too", async () => {
    const h = harness(); const input = await codeInput(h); await h.binding.bindCode(appId, input);
    expect(h.state.users).toHaveLength(1); expect(h.state.users[0]).toMatchObject({ id: memberId, passwordHash: originalHash, nickname: "Existing" }); expect(h.state.oldSessionsRevoked).toBe(false);
  });
  it("rejects OTP-driven takeover of an email preclaimed with a different password", async () => {
    const h = harness(true, false); const input = await codeInput(h);
    await expect(h.binding.bindCode(appId, { ...input, password: "Victim-new-password" })).rejects.toMatchObject({ status: 401 });
    expect(h.state.users[0].emailVerifiedAt).toBeNull(); expect(h.state.oldSessionsRevoked).toBe(false); expect(h.state.identities).toHaveLength(0); expect(h.state.challenges[0].consumedAt).toBeNull(); expect(h.state.challenges[0].attempts).toBe(1);
  });
  it("limits password guessing even when the submitted OTP is correct", async () => {
    const h = harness(true, false); const input = await codeInput(h);
    for (let attempt = 0; attempt < 5; attempt++) await expect(h.binding.bindCode(appId, { ...input, password: "Wrong-original-password" })).rejects.toMatchObject({ status: 401 });
    expect(h.state.challenges[0].attempts).toBe(5);
    await expect(h.binding.bindCode(appId, input)).rejects.toMatchObject({ status: 400 });
    expect(h.state.users[0].emailVerifiedAt).toBeNull(); expect(h.state.identities).toHaveLength(0);
  });
  it("requires old-password plus OTP before upgrading, and revokes every old session atomically", async () => {
    const h = harness(true, false); const input = await codeInput(h); await h.binding.bindCode(appId, input);
    expect(h.state.users[0]).toMatchObject({ passwordHash: originalHash, emailVerifiedAt: expect.any(Date) }); expect(h.state.oldSessionsRevoked).toBe(true);
    expect(h.db.userSession.updateMany.mock.invocationCallOrder[0]).toBeLessThan(h.db.user.update.mock.invocationCallOrder[0]); expect(h.state.sessions).toHaveLength(1);
  });
  it("rolls back verification and session revocation when identity/ticket claim loses", async () => {
    const h = harness(true, false); const input = await codeInput(h); h.db.commerceWechatBindTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.binding.bindCode(appId, input)).rejects.toMatchObject({ status: 401 });
    expect(h.state.users[0].emailVerifiedAt).toBeNull(); expect(h.state.oldSessionsRevoked).toBe(false); expect(h.state.challenges[0].consumedAt).toBeNull();
  });
  it("binds OTP proof to its original ticket, not merely a matching app/openId", async () => {
    const h = harness(); const input = await codeInput(h); const otherTicket = "b".repeat(64);
    h.state.tickets.push({ ...h.state.tickets[0], tokenHash: sha256(otherTicket) });
    await expect(h.binding.bindCode(appId, { ...input, bindTicket: otherTicket })).rejects.toMatchObject({ status: 400 });
    expect(h.state.challenges[0].attempts).toBe(1); expect(h.state.identities).toHaveLength(0);
  });
  it.each(["purpose", "unsent", "expired", "consumed", "attempts"])("rejects invalid challenge condition %s without granting identity", async condition => {
    const h = harness(); const input = await codeInput(h); const row = h.state.challenges[0];
    if (condition === "purpose") row.purpose = "register";
    if (condition === "unsent") row.sentAt = null;
    if (condition === "expired") row.expiresAt = new Date(0);
    if (condition === "consumed") row.consumedAt = new Date();
    if (condition === "attempts") row.attempts = 5;
    await expect(h.binding.bindCode(appId, input)).rejects.toMatchObject({ status: 400 }); expect(h.state.identities).toHaveLength(0); expect(h.state.sessions).toHaveLength(0);
  });
  it("limits incorrect code attempts and concurrent replay", async () => {
    const h = harness(false); const input = await codeInput(h);
    await expect(h.binding.bindCode(appId, { ...input, code: "000000" })).rejects.toMatchObject({ status: 400 }); expect(h.state.challenges[0].attempts).toBe(1);
    const result = await Promise.allSettled([h.binding.bindCode(appId, input), h.binding.bindCode(appId, input)]);
    expect(result.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(h.state.users).toHaveLength(1); expect(h.state.identities).toHaveLength(1); expect(h.state.sessions).toHaveLength(1);
  });
  it("never sends an unavailable channel, and invalidates unsuccessful delivery", async () => {
    const h = harness(); h.delivery.assertAvailable.mockRejectedValueOnce(new Error("channel unavailable"));
    await expect(h.binding.requestCode(appId, codeRequest())).rejects.toThrow("unavailable"); expect(h.state.challenges).toHaveLength(0); expect(h.delivery.send).not.toHaveBeenCalled();
    h.delivery.send.mockRejectedValueOnce(new Error("synthetic delivery failure"));
    await expect(h.binding.requestCode(appId, codeRequest())).rejects.toThrow("failure"); expect(h.state.challenges[0].consumedAt).toBeInstanceOf(Date); expect(h.state.users).toHaveLength(1);
  });
  it("enforces ticket/identifier throttles and rejects non-binding purposes", async () => {
    const h = harness(); await h.binding.requestCode(appId, codeRequest());
    await expect(h.binding.requestCode(appId, { ...codeRequest(), identifier: "another@example.com" })).rejects.toMatchObject({ status: 429 });
    await expect(h.binding.requestCode(appId, { ...codeRequest(), purpose: "reset_password" })).rejects.toMatchObject({ status: 400 }); expect(h.delivery.send).toHaveBeenCalledOnce();
  });
});

describe("global mall refresh keeps real verification boundaries", () => {
  it("reports the international password-login verification gate without changing the domestic error", async () => {
    const service = new AuthService({} as any, {} as any, {} as any, {} as any);
    vi.spyOn(service as any, "passwordUser").mockResolvedValue({ id: memberId, emailVerifiedAt: null, mobileVerifiedAt: null });
    const issue = vi.spyOn(service as any, "issueSession");
    await expect(service.loginForMall("member@example.com", password)).rejects.toMatchObject({ status: 403, response: { errorKey: "account_verification_required" } });
    expect(issue).not.toHaveBeenCalled();
    vi.stubEnv("APP_REALM", "domestic");
    await expect(service.loginForMall("19900001234", password)).rejects.toMatchObject({ status: 401, message: "请先使用手机验证码验证后登录商城" });
    expect(issue).not.toHaveBeenCalled();
  });
  it("adds only safe international member display fields and keeps the domestic shape unchanged", () => {
    const service = new AuthService({} as any, {} as any, {} as any, {} as any) as any;
    const session = { accessToken: "synthetic", refreshToken: "synthetic-refresh", expiresAt: "test", member: { id: memberId, nickname: "Member", memberNo: "1042", promo_code: "1042", emailMasked: "m***@example.com", phoneMasked: "+12***0123" } };
    const global = service.mallSession(session, "+12025550123");
    expect(global.user).toMatchObject({ memberNo: "1042", promo_code: "1042", emailMasked: "m***@example.com", phoneMasked: "+12***0123", mobile: "+12***0123" });
    expect(JSON.stringify(global)).not.toContain("+12025550123"); expect(global.user).not.toHaveProperty("emailVerifiedAt");
    vi.stubEnv("APP_REALM", "domestic");
    expect(service.mallSession(session, "19900001234").user).toEqual({ id: memberId, nickname: "Member", mobile: "19900001234", avatarUrl: null });
  });
  it("rejects an unverified App refresh token without rotating it; App refresh still keeps its existing policy", async () => {
    const update = vi.fn().mockResolvedValue({ count: 1 });
    const user = { id: memberId, status: "ACTIVE", emailVerifiedAt: null, mobileVerifiedAt: null };
    const service = new AuthService({ userSession: { findUnique: vi.fn().mockResolvedValue({ id: "session", user, userId: memberId, expiresAt: new Date(Date.now() + 300_000), revokedAt: null }), updateMany: update } } as any, {} as any, {} as any, {} as any);
    vi.spyOn(service as any, "sessionContract").mockResolvedValue({ member: { id: memberId }, accessToken: "test" });
    await expect(service.refreshForMall("synthetic-refresh")).rejects.toMatchObject({ status: 403 }); expect(update).not.toHaveBeenCalled();
    await service.refresh("synthetic-refresh"); expect(update).toHaveBeenCalledOnce();
  });
});
