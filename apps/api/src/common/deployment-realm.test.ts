import { afterEach, describe, expect, it, vi } from "vitest";
import { sign, verify } from "jsonwebtoken";
import { assertDeploymentRealm, authAudience, authIssuer } from "./deployment-realm";
import { UserAuthGuard } from "./user-auth.guard";
import { normalizedMobile } from "./crypto";
import { AuthService } from "../auth/auth.service";
import { apiAlias } from "./api-alias.middleware";

afterEach(() => vi.unstubAllEnvs());
describe("one account domain with legacy transport aliases", () => {
  it.each(["domestic", "global", "untrusted"])("ignores former account selector %s", realm => {
    vi.stubEnv("APP_REALM", realm);
    expect(authIssuer()).toBe("saydian-global-server");
    expect(authAudience()).toBe("saydian-global-app");
    expect(normalizedMobile("13800138000")).toBe("+8613800138000");
    expect(normalizedMobile("+1 202 555 0123")).toBe("+12025550123");
  });
  it("preserves session keys and disables imported sessions at startup", () => {
    expect(() => assertDeploymentRealm({ LEGACY_SESSION_BRIDGE_ENABLED: "true" })).toThrow("disabled");
    for (const key of ["AUTH_ISSUER", "AUTH_AUDIENCE"]) expect(() => assertDeploymentRealm({ [key]: "another-system" })).toThrow("account domain");
    expect(() => assertDeploymentRealm({ NODE_ENV: "production", PUBLIC_BASE_URL: "https://app.saydian.cn" })).not.toThrow();
    expect(() => assertDeploymentRealm({ NODE_ENV: "production", PUBLIC_BASE_URL: "https://app.saydian.cn/global" })).toThrow("PUBLIC_BASE_URL");
  });
  it("issues and refreshes existing claims without exposing private member fields", async () => {
    vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-global-session-key-not-production");
    vi.stubEnv("REFRESH_TOKEN_PEPPER", "synthetic-global-refresh-key-not-production");
    const user = { id: "00000000-0000-4000-8000-000000000001", compatibilityId: 1, status: "ACTIVE", nickname: "Test", email: "session@example.com", emailVerifiedAt: new Date(), mobile: null, legacyMemberId: null, passwordHash: "must-not-leak", gender: "UNSPECIFIED", locale: "de" };
    const create = vi.fn();
    const prisma = { user: { findUniqueOrThrow: async () => user }, userSession: { create, findUnique: async () => ({ id: "session", user, expiresAt: new Date(Date.now() + 900000), revokedAt: null }), updateMany: async () => ({ count: 1 }) } };
    const auth = new AuthService(prisma as any, {} as any, {} as any, {} as any);
    const first = await auth.issueSession(user.id);
    const second = await auth.refresh(first.refreshToken);
    for (const session of [first, second]) {
      expect(verify(session.accessToken, process.env.ACCESS_TOKEN_SECRET!, { issuer: authIssuer(), audience: authAudience() })).toMatchObject({ sub: user.id, typ: "access" });
      expect(session.member).toMatchObject({ emailMasked: "s***@example.com", locale: "de" });
      expect(session.member).not.toHaveProperty("passwordHash");
      expect(session.member).not.toHaveProperty("email");
    }
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(create.mock.calls[0]![0].data.refreshTokenHash).not.toBe(first.refreshToken);
  });
  it.each(["/api/saydian-app/v2/members/me", "/global/api/saydian-app/v2/members/me"])("uses the same valid session at %s", url => verifyRoute(url, true));
  it.each(["/api/saydian-app/v2/members/me", "/global/api/saydian-app/v2/members/me"])("rejects another issuer at %s before database access", url => verifyRoute(url, false));
});

async function verifyRoute(url: string, valid: boolean) {
  vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-shared-secret-to-test-issuer-boundary");
  vi.stubEnv("LEGACY_SESSION_BRIDGE_ENABLED", "false");
  const token = sign({ sub: "user", sid: "session", jti: "nonce", typ: "access" }, process.env.ACCESS_TOKEN_SECRET!, { issuer: valid ? authIssuer() : "saydianapp-server", audience: valid ? authAudience() : "saydian-app" });
  const request: any = { url, originalUrl: url, get path() { return this.url; }, header: () => `Bearer ${token}` };
  apiAlias(request, {} as any, vi.fn());
  const findFirst = vi.fn(async () => ({ id: "session" }));
  const activation = new UserAuthGuard({ userSession: { findFirst } } as any).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any);
  if (valid) {
    await expect(activation).resolves.toBe(true);
    expect(request.authUser).toEqual({ id: "user", sessionId: "session" });
  } else {
    await expect(activation).rejects.toThrow();
    expect(findFirst).not.toHaveBeenCalled();
  }
}
