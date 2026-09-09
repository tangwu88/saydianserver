import { afterEach, describe, expect, it, vi } from "vitest";
import { hash } from "bcryptjs";
import { sign } from "jsonwebtoken";
import { AuthService } from "./auth.service";
import { UserAuthGuard } from "../common/user-auth.guard";

const registration = { mobile: "19900009991", password: "Synthetic-test-only!", nickname: "SYSTEM-QA", consentVersion: "synthetic-v1", consentSource: "test" };
function service(prisma: any) { return new AuthService(prisma, {} as any, {} as any, {} as any); }
afterEach(() => vi.unstubAllEnvs());
describe("verified registration and inactive member boundaries", () => {
  it("rejects registration without a server-verified SMS proof before any persistence", async () => {
    const user = { findUnique: vi.fn() };
    await expect(service({ user }).register(registration)).rejects.toThrow("验证码");
    expect(user.findUnique).not.toHaveBeenCalled();
  });
  it("writes mobile verification in the registration transaction, never as a later partial update", async () => {
    const create = vi.fn(async ({ data }) => ({ id: "member", ...data }));
    const tx = { user: { create }, consentRecord: { upsert: vi.fn() } };
    const auth = service({ user: { findUnique: async () => null }, $transaction: (run: any) => run(tx) });
    (auth as any).consumeSms = vi.fn().mockResolvedValue(undefined);
    (auth as any).issueSession = vi.fn().mockResolvedValue({ member: { id: "member" } });
    await auth.registerWithSms({ ...registration, code: "123456" });
    expect(create.mock.calls[0]?.[0].data.mobileVerifiedAt).toBeInstanceOf(Date);
    expect((auth as any).consumeSms).toHaveBeenCalledWith(registration.mobile, "123456", "register");
  });
  it("does not reactivate an old deleted identity through re-registration", async () => {
    const auth = service({ user: { findUnique: async () => ({ id: "old", status: "DELETED" }) } });
    await expect(auth.register(registration, true)).rejects.toThrow("已注册");
  });
  for (const status of ["DISABLED", "DELETION_PENDING", "DELETED"]) {
    it(`SMS sign-in cannot revive ${status}`, async () => {
      const update = vi.fn(), create = vi.fn();
      const tx = { user: { findUnique: async () => ({ id: "old", status }), update, create } };
      const auth = service({ $transaction: (run: any) => run(tx) });
      (auth as any).consumeSms = vi.fn().mockResolvedValue(undefined);
      await expect(auth.loginWithSms({ mobile: registration.mobile, code: "123456", consentVersion: "test", consentSource: "test" })).rejects.toThrow("账号不可用");
      expect(update).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    });
  }
  it("correct password alone cannot issue a mall session for an unverified phone", async () => {
    const auth = service({ user: { findUnique: async () => ({ id: "unverified", status: "ACTIVE", mobile: registration.mobile, mobileVerifiedAt: null, passwordHash: await hash(registration.password, 12) }) } });
    (auth as any).issueSession = vi.fn();
    await expect(auth.loginForMall(registration.mobile, registration.password)).rejects.toThrow("验证码");
    expect((auth as any).issueSession).not.toHaveBeenCalled();
  });
  it("mall resource authentication requires a verified phone even with an App-issued token", async () => {
    vi.stubEnv("ACCESS_TOKEN_SECRET", "synthetic-user-guard-key-longer-than-32");
    vi.stubEnv("LEGACY_SESSION_BRIDGE_ENABLED", "false");
    const findFirst = vi.fn().mockResolvedValue(null);
    const token = sign({ sub: "user", sid: "session", typ: "access", jti: "jti" }, process.env.ACCESS_TOKEN_SECRET!, { issuer: "saydianapp-server", audience: "saydian-app" });
    const request = { path: "/api/saidian-mall/v1/storefront/cart", header: () => `Bearer ${token}` };
    await expect(new UserAuthGuard({ userSession: { findFirst } } as any).canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any)).rejects.toThrow("登录已失效");
    expect(findFirst.mock.calls[0]?.[0].where.user).toEqual({ status: "ACTIVE", mobile: { not: null }, mobileVerifiedAt: { not: null } });
  });
});
