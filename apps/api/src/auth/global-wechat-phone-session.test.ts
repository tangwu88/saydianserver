import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verify, sign } from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { AuthService } from "./auth.service";
import { UserAuthGuard } from "../common/user-auth.guard";
import { H5_PHONE_TEST_SESSION_PREFIX } from "./global-wechat-policy";
import { sha256 } from "../common/crypto";

const appId = "wx1234567890abcdef", userId = "11111111-1111-4111-8111-111111111111", accessSecret = "synthetic-phone-test-signing-secret-only", pepper = "synthetic-phone-test-pepper";
beforeEach(() => {
  for (const [key, value] of Object.entries({ APP_REALM: "global", GLOBAL_WECHAT_H5_ENABLED: "true", GLOBAL_WECHAT_PHONE_TEST_ENABLED: "true", GLOBAL_UNVERIFIED_REGISTRATION_ENABLED: "true", H5_DEMO_ENABLED: "false", MAINTENANCE_READ_ONLY: "false", BUSINESS_WRITES_PAUSED: "false", ACCESS_TOKEN_SECRET: accessSecret, REFRESH_TOKEN_PEPPER: pepper, COMMERCE_STOREFRONT_URL: "https://app.saydian.cn/global/saidian-mall/" })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No provider calls")));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function harness() {
  const user = { id: userId, compatibilityId: 42, mobile: "+12025550123", mobileVerifiedAt: null as Date | null, email: null, emailVerifiedAt: null, status: "ACTIVE", passwordHash: null, nickname: "Synthetic", gender: "UNSPECIFIED", birthday: null, heightCm: null, weightKg: null, avatarUrl: null, legacyMemberId: null };
  let linked = true, sessions: any[] = [];
  const db: any = {
    user: { findUniqueOrThrow: vi.fn(async () => user) },
    integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: "CONFIGURED", publicConfig: { redirectUri: "https://app.saydian.cn/global/saidian-mall/oauth/callback" } }) },
    wechatOfficialIdentity: { findUnique: vi.fn(async ({ where }: any) => linked && where.userId_appId?.appId === appId ? { userId, appId, openId: "synthetic-openid" } : null) },
    userSession: {
      create: vi.fn(async ({ data }: any) => { sessions.push({ ...data, revokedAt: null, user }); return data; }),
      findUnique: vi.fn(async ({ where }: any) => sessions.find(row => row.refreshTokenHash === where.refreshTokenHash) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => sessions.find(row => row.id === where.id)),
      findFirst: vi.fn(async ({ where }: any) => {
        if (user.status !== "ACTIVE") return null;
        if (where.user.wechatOfficialIdentities && (!linked || where.user.wechatOfficialIdentities.some.appId !== appId)) return null;
        if (where.user.OR && !(user.emailVerifiedAt || user.mobileVerifiedAt)) return null;
        return sessions.find(row => row.id === where.id && row.userId === where.userId && row.accessJti === where.accessJti && !row.revokedAt && row.expiresAt > new Date()) ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = sessions.find(row => row.id === where.id && row.refreshTokenHash === where.refreshTokenHash && row.accessJti === where.accessJti && !row.revokedAt && row.expiresAt > new Date());
        if (!row || user.status !== "ACTIVE" || !linked) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }),
    },
  };
  const secrets: any = { resolve: vi.fn().mockResolvedValue({ appId, appSecret: "synthetic-official-app-secret" }) };
  const service = new AuthService(db, {} as any, secrets, {} as any), guard = new UserAuthGuard(db, service);
  function request(token: string, method = "GET", path = "/api/saidian-mall/v1/auth/wechat/h5/account") {
    return guard.canActivate({ switchToHttp: () => ({ getRequest: () => ({ method, path, url: path, header: () => `Bearer ${token}` }) }) } as any);
  }
  return { user, db, secrets, service, request, sessions, unlink() { linked = false; } };
}

describe("limited international H5 phone-test session provenance", () => {
  it("persists test provenance and exposes only masked account status", async () => {
    const h = harness(), response = await h.service.issuePhoneTestMallSession(userId);
    const claims = verify(response.token, accessSecret) as any;
    expect(claims.jti).toMatch(/^h5-phone-test:/); expect(h.sessions[0].accessJti).toBe(claims.jti);
    expect(response.user).toMatchObject({ memberNo: "42", phoneVerified: false, phoneTestMode: true });
    expect(await h.request(response.token)).toBe(true);
    expect(await h.service.mallAccount(userId, h.sessions[0].id)).toMatchObject({ phoneTestMode: true, phoneVerified: false, phoneVerificationStatus: "pending" });
    expect(JSON.stringify(response)).not.toContain(h.user.mobile); expect(h.user.passwordHash).toBeNull(); expect(h.user.mobileVerifiedAt).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["GET", "/api/saydian-app/v2/member/profile"], ["GET", "/api/saydian-app/v2/auth/profile"], ["POST", "/api/saydian-app/v2/health/records"],
    ["GET", "/api/saidian-mall/v1/storefront/orders"], ["POST", "/api/saidian-mall/v1/storefront/orders"], ["POST", "/api/saidian-mall/v1/auth/wechat/h5/account"],
  ])("rejects test access to %s %s", async (method, path) => {
    const h = harness(), response = await h.service.issuePhoneTestMallSession(userId);
    await expect(h.request(response.token, method, path)).rejects.toMatchObject({ status: 401 }); expect(h.db.userSession.findFirst).not.toHaveBeenCalled();
  });
  it("allows only the exact existing logout operation outside the H5 account path", async () => {
    const h = harness(), response = await h.service.issuePhoneTestMallSession(userId);
    expect(await h.request(response.token, "POST", "/api/saydian-app/v2/auth/logout")).toBe(true);
    await expect(h.request(response.token, "GET", "/api/saydian-app/v2/auth/logout")).rejects.toThrow();
  });
  it("rejects the test refresh at the App entry point without rotation", async () => {
    const h = harness(), response = await h.service.issuePhoneTestMallSession(userId);
    await expect(h.service.refresh(response.refreshToken)).rejects.toMatchObject({ status: 401 }); expect(h.db.userSession.updateMany).not.toHaveBeenCalled();
  });
  it("retains test provenance across H5 rotation, invalidates the old token, and never grants an App session", async () => {
    const h = harness(), first = await h.service.issuePhoneTestMallSession(userId), second = await h.service.refreshForMall(first.refreshToken);
    expect(h.sessions[0].accessJti).toMatch(/^h5-phone-test:/); expect(second.user).toMatchObject({ phoneTestMode: true, phoneVerified: false });
    await expect(h.request(first.token)).rejects.toThrow(); expect(await h.request(second.token)).toBe(true);
    await expect(h.service.refresh(second.refreshToken)).rejects.toMatchObject({ status: 401 });
  });
  it.each(["flag", "wechat-flag", "config", "appid", "unlink", "frozen", "revoked"])("rejects existing access and refresh immediately after %s changes", async scenario => {
    const h = harness(), response = await h.service.issuePhoneTestMallSession(userId);
    if (scenario === "flag") vi.stubEnv("GLOBAL_WECHAT_PHONE_TEST_ENABLED", "false");
    if (scenario === "wechat-flag") vi.stubEnv("GLOBAL_WECHAT_H5_ENABLED", "false");
    if (scenario === "config") h.db.integrationConfig.findUnique.mockResolvedValue({ state: "DISABLED" });
    if (scenario === "appid") h.secrets.resolve.mockResolvedValue({ appId: "wxOtherApplication123", appSecret: "synthetic-official-secret" });
    if (scenario === "unlink") h.unlink();
    if (scenario === "frozen") h.user.status = "FROZEN";
    if (scenario === "revoked") h.sessions[0].revokedAt = new Date();
    await expect(h.request(response.token)).rejects.toThrow(); await expect(h.service.refreshForMall(response.refreshToken)).rejects.toThrow(); expect(h.db.userSession.updateMany).not.toHaveBeenCalled();
  });
  it("does not treat an ordinary unverified App session as a phone-test session", async () => {
    const h = harness(), id = randomUUID(), jti = randomUUID(), refreshToken = "ordinary-synthetic-refresh";
    h.sessions.push({ id, userId, accessJti: jti, refreshTokenHash: sha256(`${refreshToken}:${pepper}`), user: h.user, revokedAt: null, expiresAt: new Date(Date.now() + 300_000) });
    const token = sign({ typ: "access", sub: userId, sid: id }, accessSecret, { algorithm: "HS256", jwtid: jti, issuer: "saydian-global-server", audience: "saydian-global-app" });
    await expect(h.request(token)).rejects.toThrow(); await expect(h.service.refreshForMall(refreshToken)).rejects.toMatchObject({ status: 403 }); expect(h.db.userSession.updateMany).not.toHaveBeenCalled();
    expect(h.sessions[0].accessJti).not.toContain(H5_PHONE_TEST_SESSION_PREFIX);
  });
});
