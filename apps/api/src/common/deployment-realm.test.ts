import { afterEach, describe, expect, it, vi } from "vitest";
import { sign, verify } from "jsonwebtoken";
import { assertDeploymentRealm, authAudience, authIssuer, isGlobalRealm } from "./deployment-realm";
import { resolveLegacySession } from "./legacy-session-bridge";
import { UserAuthGuard } from "./user-auth.guard";
import { normalizedMobile } from "./crypto";
import { AuthService } from "../auth/auth.service";

afterEach(() => vi.unstubAllEnvs());
describe("fixed account deployment isolation", () => {
  it("preserves domestic defaults and China mobile parsing", () => {
    vi.stubEnv("APP_REALM", "domestic"); expect(isGlobalRealm()).toBe(false); expect(authIssuer()).toBe("saydianapp-server"); expect(authAudience()).toBe("saydian-app");
    expect(normalizedMobile("13800138000")).toBe("13800138000"); expect(normalizedMobile("+12025550123")).toBe("");
  });
  it("uses international parsing only in the global process", () => {
    vi.stubEnv("APP_REALM", "global"); expect(normalizedMobile("+1 202 555 0123")).toBe("+12025550123"); expect(normalizedMobile("13800138000")).toBe("");
  });
  it("rejects bridge and invalid JWT deployment configuration", () => {
    expect(() => assertDeploymentRealm({ APP_REALM: "global", LEGACY_SESSION_BRIDGE_ENABLED: "true" })).toThrow("disabled");
    expect(() => assertDeploymentRealm({ APP_REALM: "global", AUTH_AUDIENCE: "saydian-app" })).toThrow("global app");
    expect(() => assertDeploymentRealm({ APP_REALM: "untrusted" })).toThrow("APP_REALM");
  });
  it("requires the fixed global public prefix and a separate database in production", () => {
    const config = { APP_REALM: "global", NODE_ENV: "production", PUBLIC_BASE_URL: "https://app.saydian.cn/global", DATABASE_URL: "postgres://global_app:synthetic@global-db/saydian_global" };
    expect(() => assertDeploymentRealm(config)).not.toThrow(); expect(() => assertDeploymentRealm({ ...config, DATABASE_URL: "postgres://domestic:synthetic@db/saydian" })).toThrow("dedicated");
    expect(() => assertDeploymentRealm({ ...config, PUBLIC_BASE_URL: "https://app.saydian.cn" })).toThrow("PUBLIC_BASE_URL");
  });
  it("never tries imported credentials for global, even if a caller passes the bridge flag", async () => {
    const transaction = vi.fn(); expect(await resolveLegacySession({ $transaction: transaction } as any, "opaque-synthetic-token", "/api/v1/member/index", { APP_REALM: "global", LEGACY_SESSION_BRIDGE_ENABLED: "true" })).toBeNull(); expect(transaction).not.toHaveBeenCalled();
  });
  it("blocks domestic OTP and social account creation before storage or outbound provider access", async () => {
    vi.stubEnv("APP_REALM", "global");
    const auth = new AuthService({} as any, {} as any, {} as any, {} as any);
    await expect(auth.register({ mobile: "+12025550123", password: "Synthetic-password", consentSource: "test", consentVersion: "test" }, true)).rejects.toThrow("verified email");
    await expect(auth.registerWithSms({ mobile: "+12025550123", code: "123456", password: "Synthetic-password", consentSource: "test", consentVersion: "test" })).rejects.toThrow("verification-code");
    await expect(auth.loginWechatMini({ code: "test", consentSource: "test", consentVersion: "test" })).rejects.toThrow("international phone");
    await expect(auth.loginWechatApp({ code: "test", state: "test", platform: "android", consentAccepted: true, consentSource: "test", consentVersion: "test" })).rejects.toThrow("international phone");
  });
  it("issues and refreshes global claims with masked profile fields and no private identity data", async () => {
    vi.stubEnv("APP_REALM", "global"); vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-global-session-key-not-production"); vi.stubEnv("REFRESH_TOKEN_PEPPER", "synthetic-global-refresh-key-not-production");
    const user = { id: "00000000-0000-4000-8000-000000000001", compatibilityId: 1, status: "ACTIVE", nickname: "Saydian user", email: "session@example.com", emailVerifiedAt: new Date(), mobile: null, legacyMemberId: null, passwordHash: "must-not-leak", avatarUrl: null, gender: "UNSPECIFIED", birthday: null, heightCm: null, weightKg: null, locale: "de" };
    const create = vi.fn(async () => undefined);
    const prisma = { user: { findUniqueOrThrow: async () => user }, userSession: { create, findUnique: async () => ({ id: "session", user, expiresAt: new Date(Date.now() + 900000), revokedAt: null }), updateMany: async () => ({ count: 1 }) } };
    const auth = new AuthService(prisma as any, {} as any, {} as any, {} as any);
    const first = await auth.issueSession(user.id);
    const second = await auth.refresh(first.refreshToken);
    for (const session of [first, second]) {
      expect(verify(session.accessToken, process.env.ACCESS_TOKEN_SECRET!, { issuer: "saydian-global-server", audience: "saydian-global-app" })).toMatchObject({ sub: user.id, typ: "access" });
      expect(session.member).toMatchObject({ emailMasked: "s***@example.com", locale: "de" });
      expect(session.member).not.toHaveProperty("passwordHash"); expect(session.member).not.toHaveProperty("email");
      expect(new Date(session.expiresAt).toISOString()).toBe(session.expiresAt);
    }
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect((create.mock.calls[0] as any)[0].data.refreshTokenHash).not.toBe(first.refreshToken);
  });
  for (const [target, issuer, audience] of [["global", "saydianapp-server", "saydian-app"], ["domestic", "saydian-global-server", "saydian-global-app"]]) {
    it(`rejects the other account domain token on ${target} before any DB lookup`, async () => {
      vi.stubEnv("APP_REALM", target!); vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-shared-secret-to-test-issuer-boundary"); vi.stubEnv("LEGACY_SESSION_BRIDGE_ENABLED", "false");
      const token = sign({ sub: "user", sid: "session", jti: "nonce", typ: "access" }, process.env.ACCESS_TOKEN_SECRET!, { issuer, audience });
      const findFirst = vi.fn(); const request = { path: "/api/saydian-app/v2/members/me", header: (name: string) => name === "authorization" ? `Bearer ${token}` : "global" };
      await expect(new UserAuthGuard({ userSession: { findFirst } } as any).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).rejects.toThrow(); expect(findFirst).not.toHaveBeenCalled();
    });
  }
  it("allows a verified global email identity through the commerce guard without a domestic phone", async () => {
    vi.stubEnv("APP_REALM", "global"); vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-test-key-longer-than-thirty-two");
    const token = sign({ sub: "user", sid: "session", jti: "nonce", typ: "access" }, process.env.ACCESS_TOKEN_SECRET!, { issuer: authIssuer(), audience: authAudience() });
    const findFirst = vi.fn(async () => ({ id: "session" })); const request = { path: "/api/saidian-mall/v1/storefront/cart", header: () => `Bearer ${token}` };
    expect(await new UserAuthGuard({ userSession: { findFirst } } as any).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).toBe(true);
    expect((findFirst.mock.calls[0] as any)[0].where.user.OR).toContainEqual({ email: { not: null }, emailVerifiedAt: { not: null } });
  });
});
