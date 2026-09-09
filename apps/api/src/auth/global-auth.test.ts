import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { GlobalAuthService } from "./global-auth.service";
import { GlobalVerificationDeliveryService } from "./global-verification-delivery.service";
import { globalIdentity, globalLocale, globalLocales, internationalPhone, normalizedEmail } from "./global-identity";

beforeEach(() => { vi.stubEnv("APP_REALM", "global"); vi.stubEnv("REFRESH_TOKEN_PEPPER", "synthetic-global-test-pepper-not-a-live-secret"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function harness() {
  let records = new Map<string, any>();
  let users = new Map<string, any>();
  let throttles = new Map<string, any>();
  const sessions: string[] = [];
  const delivery = { capabilities: vi.fn(async () => ({ email: true, sms: true, smsCountries: ["US", "DE"] })), assertAvailable: vi.fn(async () => ({})), send: vi.fn(async (_input: any) => undefined) };
  const tx: any = {
    globalLegalDocument: { findMany: vi.fn(async () => ["user_agreement", "privacy_policy"].map(documentType => ({ documentType, version: "v1", locale: "en", contentHtml: "Synthetic test legal text", reviewed: true, active: true }))) },
    globalVerificationThrottle: {
      upsert: async ({ where, create }: any) => { if (!throttles.has(where.key)) throttles.set(where.key, create); },
      updateMany: async ({ where, data }: any) => { const row = throttles.get(where.key); if (!row || row.reservedAt > where.reservedAt.lte) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
    },
    globalVerificationChallenge: {
      count: async ({ where }: any) => [...records.values()].filter(row => row.channel === where.channel && row.identifier === where.identifier && row.createdAt > where.createdAt.gt).length,
      create: async ({ data }: any) => { records.set(data.id, { ...data, sentAt: null, consumedAt: null, attempts: 0, createdAt: new Date() }); },
      findUnique: async ({ where }: any) => records.get(where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(records.get(where.id), data),
      updateMany: async ({ where, data }: any) => { const row = records.get(where.id); if (!row || row.consumedAt || row.attempts >= (where.attempts?.lt ?? 99) || (where.expiresAt && row.expiresAt <= where.expiresAt.gt)) return { count: 0 }; if (data.attempts) row.attempts++; if (data.consumedAt) row.consumedAt = data.consumedAt; return { count: 1 }; },
    },
    user: {
      findUnique: async ({ where }: any) => [...users.values()].find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
      create: async ({ data }: any) => { const user = { id: randomUUID(), status: "ACTIVE", ...data }; users.set(user.id, user); return user; },
      update: async ({ where, data }: any) => Object.assign(users.get(where.id), data),
    },
    consentRecord: { create: vi.fn(async () => undefined) },
    userSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma: any = { ...tx, $transaction: async (run: any) => { const snapshot = structuredClone({ records, users, throttles }); try { return await run(tx); } catch (error) { records = snapshot.records; users = snapshot.users; throttles = snapshot.throttles; throw error; } } };
  const auth: any = { issueSession: vi.fn(async (id: string) => { sessions.push(id); const user = users.get(id); return { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: new Date(Date.now() + 900_000).toISOString(), member: { id, nickname: user.nickname ?? "Test", locale: user.locale ?? "en" } }; }), login: vi.fn(async () => ({ accessToken: "synthetic-access" })) };
  const service = new GlobalAuthService(prisma, delivery as any, auth);
  return { service, prisma, delivery, auth, tx, sessions, records: () => records, users: () => users };
}

describe("global international identity", () => {
  it("uses strict valid international numbers rather than China-only length", () => {
    for (const phone of ["+12025550123", "+4915123456789", "+33612345678", "+819012345678", "+821012345678"]) expect(internationalPhone(phone)?.identifier).toBe(phone);
    for (const phone of ["13800138000", "+123", "Call +12025550123", "+12025550123 ext.12"]) expect(internationalPhone(phone)).toBeNull();
  });
  it("normalizes email without accepting malformed identifiers", () => {
    expect(normalizedEmail(" User@Example.COM ")).toBe("user@example.com");
    for (const email of ["a@", "a@-example.com", "a..b@example.com", "a b@example.com", "a@example..com"]) expect(normalizedEmail(email)).toBe("");
    expect(() => globalIdentity("email", "+12025550123")).toThrow();
  });
  it("has the exact eight locales and predictable English fallback", () => {
    expect(globalLocales).toEqual(["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"]);
    expect(globalLocale("zh_TW")).toBe("zh-Hant"); expect(globalLocale("zh-CN")).toBe("zh-Hans"); expect(globalLocale("de-DE")).toBe("de"); expect(globalLocale("ru")).toBe("en");
  });
});

describe("global registration challenges", () => {
  it("does not advertise registration while business writes are paused", async () => {
    vi.stubEnv("BUSINESS_WRITES_PAUSED", "true");
    expect((await harness().service.capabilities("en")).registration).toEqual({ email: false, sms: false });
  });
  it("keeps registration closed without reviewed legal documents and rejects an outdated version", async () => {
    const h = harness(); h.tx.globalLegalDocument.findMany.mockResolvedValueOnce([]);
    const capabilities = await h.service.capabilities("en");
    expect(capabilities.registration).toEqual({ email: false, sms: false }); expect(capabilities.consentVersion).toBeNull(); expect(capabilities.legal).toBeNull();
    h.tx.globalLegalDocument.findMany.mockResolvedValueOnce([]);
    await expect(h.service.requestCode({ channel: "email", identifier: "legal@example.com" })).rejects.toThrow("not available yet");
    expect(h.delivery.send).not.toHaveBeenCalled();
    await expect(h.service.register({ challengeId: randomUUID(), code: "123456", password: "Synthetic-password", consentVersion: "old" })).rejects.toThrow("terms have changed");
    expect(h.users().size).toBe(0);
  });
  it("does not touch persistence or delivery when a channel is unavailable", async () => {
    const h = harness(); h.delivery.assertAvailable.mockRejectedValue(new Error("unavailable"));
    await expect(h.service.requestCode({ channel: "email", identifier: "user@example.com" })).rejects.toThrow("unavailable");
    expect(h.records().size).toBe(0); expect(h.delivery.send).not.toHaveBeenCalled();
  });
  it("returns opaque challenge data, never the code, then creates a verified email account", async () => {
    const h = harness();
    const challenge = await h.service.requestCode({ channel: "email", identifier: "New@Example.com", purpose: "register", locale: "de-DE" });
    expect(challenge).toEqual({ challengeId: expect.any(String), expiresIn: 300, retryAfter: 60, maskedIdentifier: "n***@example.com" });
    const sent = h.delivery.send.mock.calls[0]![0];
    expect(sent.locale).toBe("de"); expect(JSON.stringify(challenge)).not.toContain(sent.code);
    const session = await h.service.register({ challengeId: challenge.challengeId, code: sent.code, password: "Synthetic-only-password!", consentVersion: "v1" });
    const stored = h.users().get(session.member.id);
    expect(stored.email).toBe("new@example.com"); expect(stored.emailVerifiedAt).toBeInstanceOf(Date); expect(stored.mobile).toBeUndefined(); expect(session.member.locale).toBe("de");
    expect(h.tx.consentRecord.create).toHaveBeenCalledTimes(2);
    await expect(h.service.register({ challengeId: challenge.challengeId, code: sent.code, password: "Synthetic-only-password!", consentVersion: "v1" })).rejects.toThrow("expired");
    expect(h.users().size).toBe(1); expect(h.sessions).toHaveLength(1);
  });
  it("creates a verified international phone account with E.164 storage", async () => {
    const h = harness(); const challenge = await h.service.requestCode({ channel: "sms", identifier: "+1 202 555 0123" });
    const session = await h.service.register({ challengeId: challenge.challengeId, code: h.delivery.send.mock.calls[0]![0].code, password: "Synthetic-only-password!", consentVersion: "v1" });
    const stored = h.users().get(session.member.id);
    expect(stored.mobile).toBe("+12025550123"); expect(stored.mobileVerifiedAt).toBeInstanceOf(Date); expect(stored.email).toBeUndefined();
  });
  it("enforces cooldown across verification purposes", async () => {
    const h = harness(); await h.service.requestCode({ channel: "email", identifier: "rate@example.com" });
    await expect(h.service.requestCode({ channel: "email", identifier: "rate@example.com", purpose: "reset_password" })).rejects.toThrow("wait");
    expect(h.delivery.send).toHaveBeenCalledTimes(1);
  });
  it("caps ten requests per recipient per day after cooldowns", async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) h.records().set(String(i), { channel: "email", identifier: "rate@example.com", createdAt: new Date() });
    await expect(h.service.requestCode({ channel: "email", identifier: "rate@example.com" })).rejects.toThrow("Too many"); expect(h.delivery.send).not.toHaveBeenCalled();
  });
  it("does not accept a failed delivery or issue a session", async () => {
    const h = harness(); h.delivery.send.mockRejectedValue(new Error("provider failed"));
    await expect(h.service.requestCode({ channel: "email", identifier: "fail@example.com" })).rejects.toThrow("provider failed");
    expect([...h.records().values()][0].consumedAt).toBeInstanceOf(Date); expect(h.sessions).toHaveLength(0);
  });
  it("commits wrong-attempt counters and rejects the correct code after five failures", async () => {
    const h = harness(); const ch = await h.service.requestCode({ channel: "email", identifier: "try@example.com" });
    const valid = h.delivery.send.mock.calls[0]![0].code; const wrong = valid === "123456" ? "123457" : "123456";
    for (let i = 0; i < 5; i++) await expect(h.service.register({ challengeId: ch.challengeId, code: wrong, password: "Synthetic-only-password!", consentVersion: "v1" })).rejects.toThrow("expired");
    expect(h.records().get(ch.challengeId).attempts).toBe(5);
    await expect(h.service.register({ challengeId: ch.challengeId, code: valid, password: "Synthetic-only-password!", consentVersion: "v1" })).rejects.toThrow("expired"); expect(h.sessions).toHaveLength(0);
  });
  it("rejects expired, wrong-purpose and unknown challenges", async () => {
    const h = harness(); const ch = await h.service.requestCode({ channel: "email", identifier: "reset@example.com", purpose: "reset_password" });
    const input = { challengeId: ch.challengeId, code: h.delivery.send.mock.calls[0]![0].code, password: "Synthetic-only-password!", consentVersion: "v1" };
    await expect(h.service.register(input)).rejects.toThrow("expired");
    h.records().get(ch.challengeId).expiresAt = new Date(0);
    await expect(h.service.resetPassword(input)).rejects.toThrow("expired");
    await expect(h.service.resetPassword({ ...input, challengeId: randomUUID() })).rejects.toThrow("expired");
  });
  it("requires consent and validates UTF-8 password byte length before consuming a code", async () => {
    const h = harness();
    await expect(h.service.register({ password: "Synthetic-only-password!" })).rejects.toThrow("terms");
    await expect(h.service.register({ password: "好".repeat(25), consentVersion: "v1" })).rejects.toThrow("UTF-8"); expect(h.sessions).toHaveLength(0);
  });
  it("resets a verified account and revokes previous sessions in the same transaction", async () => {
    const h = harness(); h.users().set("member", { id: "member", email: "reset@example.com", status: "ACTIVE", passwordHash: "old" });
    const ch = await h.service.requestCode({ channel: "email", identifier: "reset@example.com", purpose: "reset_password" });
    const session = await h.service.resetPassword({ challengeId: ch.challengeId, code: h.delivery.send.mock.calls[0]![0].code, password: "Synthetic-new-password!" });
    expect(h.users().get(session.member.id).passwordHash).not.toBe("old"); expect(h.tx.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: "member", revokedAt: null }, data: { revokedAt: expect.any(Date) } });
  });
  it("does not revive a disabled account through reset", async () => {
    const h = harness(); h.users().set("member", { id: "member", email: "disabled@example.com", status: "DISABLED" });
    const ch = await h.service.requestCode({ channel: "email", identifier: "disabled@example.com", purpose: "reset_password" });
    await expect(h.service.resetPassword({ challengeId: ch.challengeId, code: h.delivery.send.mock.calls[0]![0].code, password: "Synthetic-new-password!" })).rejects.toThrow("cannot be reset"); expect(h.sessions).toHaveLength(0);
  });
  it("normalizes login aliases and is unavailable on the domestic deployment", async () => {
    const h = harness(); await h.service.login({ identifier: "Test@Example.com", password: "Synthetic-only-password!" }); expect(h.auth.login).toHaveBeenCalledWith("test@example.com", "Synthetic-only-password!");
    vi.stubEnv("APP_REALM", "domestic"); await expect(h.service.capabilities()).rejects.toThrow("unavailable");
  });
});

describe("global real-channel readiness", () => {
  it("is disabled by default without reading any credentials", async () => {
    vi.stubEnv("GLOBAL_EMAIL_PROVIDER", "disabled"); vi.stubEnv("GLOBAL_SMS_PROVIDER", "disabled");
    const resolve = vi.fn(); const service = new GlobalVerificationDeliveryService({} as any, { resolve } as any);
    expect(await service.capabilities()).toEqual({ email: false, sms: false, smsCountries: [] }); expect(resolve).not.toHaveBeenCalled();
  });
  it("requires configured and operator-verified delivery with actual secret fields", async () => {
    vi.stubEnv("GLOBAL_EMAIL_PROVIDER", "webhook"); vi.stubEnv("GLOBAL_SMS_PROVIDER", "disabled");
    const row = { state: "CONFIGURED", publicConfig: { provider: "webhook", deliveryVerified: false } };
    const resolve = vi.fn(async () => ({ webhookUrl: "https://example.invalid/verify", webhookToken: "synthetic-provider-token" }));
    const service = new GlobalVerificationDeliveryService({ integrationConfig: { findUnique: async () => row } } as any, { resolve } as any);
    expect((await service.capabilities()).email).toBe(false); expect(resolve).not.toHaveBeenCalled();
    row.publicConfig.deliveryVerified = true; expect((await service.capabilities()).email).toBe(true);
    resolve.mockResolvedValue({} as any); expect((await service.capabilities()).email).toBe(false);
  });
  it("never promises every phone country and does not call the network outside configured countries", async () => {
    vi.stubEnv("GLOBAL_SMS_PROVIDER", "webhook"); vi.stubEnv("GLOBAL_EMAIL_PROVIDER", "disabled");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const service = new GlobalVerificationDeliveryService({ integrationConfig: { findUnique: async () => ({ state: "CONFIGURED", publicConfig: { provider: "webhook", deliveryVerified: true, countries: ["US", "US", "ZZ"] } }) } } as any, { resolve: async () => ({ webhookUrl: "https://example.invalid/verify", webhookToken: "synthetic-provider-token" }) } as any);
    expect((await service.capabilities()).smsCountries).toEqual(["US"]);
    await expect(service.assertAvailable("sms", "DE")).rejects.toThrow("not available"); expect(fetch).not.toHaveBeenCalled();
  });
});
