import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { IntegrationState, UserStatus } from "@prisma/client";
import { sign } from "jsonwebtoken";
import { AuthService } from "./auth.service";
import { UserAuthGuard } from "../common/user-auth.guard";

type Kind = "mini" | "app";
const memberId = "11111111-1111-4111-8111-111111119909";
const baseUser = () => ({
  id: memberId, legacyMemberId: null, mobile: null as string | null, mobileVerifiedAt: null as Date | null,
  status: UserStatus.ACTIVE as string, nickname: "SYNTHETIC-OAUTH-STATUS-20260909",
  avatarUrl: null, gender: "UNSPECIFIED", birthday: null, heightCm: null, weightKg: null, referralEmployeeId: null,
});
const identity = { openId: "SYNTHETIC-WECHAT-OPENID-20260909", unionId: "SYNTHETIC-WECHAT-UNIONID-20260909",
  nickname: "SYNTHETIC-WECHAT-USER", avatarUrl: null, gender: "UNSPECIFIED" };
const input = { code: "SYNTHETIC-ONE-TIME-CODE", consentVersion: "synthetic-legal-v1", consentSource: "pure-unit-test",
  state: "SYNTHETIC-STATE", platform: "android", consentAccepted: true };
const secret = "synthetic-auth-boundary-test-key-not-a-real-secret";
async function fixture(
  options: { kind: Kind; byOpenId?: any; byUnionId?: any; configured?: boolean },
  run: (h: any) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const oldSecret = process.env.ACCESS_TOKEN_SECRET, oldBridge = process.env.LEGACY_SESSION_BRIDGE_ENABLED;
  process.env.ACCESS_TOKEN_SECRET = secret;
  process.env.LEGACY_SESSION_BRIDGE_ENABLED = "false";
  const calls = { updates: [] as any[], creates: [] as any[], consents: [] as any[], sessions: [] as string[], exchanges: 0, fetches: 0 };
  let saved: any = options.byUnionId ?? options.byOpenId ?? baseUser();
  // No original fetch is ever called, including a failed or unconfigured case.
  globalThis.fetch = (async (url: any) => {
    assert.equal(new URL(String(url)).origin, "https://api.weixin.qq.com");
    calls.fetches++;
    return { ok: true, json: async () => ({ openid: identity.openId, unionid: identity.unionId }) } as Response;
  }) as typeof fetch;
  const tx = {
    user: {
      findUnique: async ({ where }: any) => "wechatUnionId" in where ? options.byUnionId ?? null : options.byOpenId ?? null,
      update: async (args: any) => { calls.updates.push(args); saved = { ...saved, ...args.data }; return saved; },
      create: async (args: any) => { calls.creates.push(args); saved = { ...baseUser(), ...args.data }; return saved; },
    },
    consentRecord: { upsert: async (args: any) => { calls.consents.push(args); return {}; } },
  };
  const prisma = {
    $transaction: async (operation: any) => operation(tx),
    integrationConfig: {
      findUnique: async () => ({ state: options.configured === false ? IntegrationState.UNCONFIGURED : IntegrationState.CONFIGURED, publicConfig: {} }),
      updateMany: async () => ({ count: 1 }),
    },
  };
  const auth = new AuthService(prisma as any, {} as any,
    { resolve: async () => ({ appIdMini: "wxSynthetic20260909", appSecretMini: "synthetic-test-only-secret" }) } as any,
    { exchange: async () => { calls.exchanges++; return identity; } } as any);
  (auth as any).issueSession = async (id: string) => {
    calls.sessions.push(id);
    return {
      accessToken: sign({ sub: id, sid: "synthetic-session", typ: "access", jti: "synthetic-jti" }, secret,
        { issuer: "saydianapp-server", audience: "saydian-app", expiresIn: 300 }),
      refreshToken: "SYNTHETIC-REFRESH-NOT-A-REAL-CREDENTIAL",
      expiresAt: "2099-01-01T00:00:00.000Z",
      member: { id, nickname: saved.nickname, gender: "unspecified" },
    };
  };
  async function guard(session: any, mall: boolean) {
    let checked: any;
    const token = options.kind === "mini" ? session.token : session.accessToken;
    const request: any = { path: mall ? "/api/saidian-mall/v1/storefront/cart" : "/api/saydian-app/v2/me", header: () => "Bearer " + token };
    const userAuth = new UserAuthGuard({ userSession: { findFirst: async ({ where }: any) => {
      checked = where.user;
      assert.equal(where.user.status, "ACTIVE");
      if (saved.status !== "ACTIVE" || where.user.mobile && !saved.mobile || where.user.mobileVerifiedAt && !saved.mobileVerifiedAt) return null;
      return { id: "synthetic-session" };
    } } } as any);
    const pending = userAuth.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any);
    if (mall && (!saved.mobile || !saved.mobileVerifiedAt)) {
      await assert.rejects(pending, (error: any) => error.getStatus?.() === 401);
      assert.deepEqual(checked, { status: "ACTIVE", mobile: { not: null }, mobileVerifiedAt: { not: null } });
      assert.equal(request.authUser, undefined);
    } else {
      assert.equal(await pending, true);
      assert.equal(request.authUser.id, saved.id);
    }
  }
  try {
    await run({ auth, calls, user: () => saved, guard,
      login: () => options.kind === "mini" ? auth.loginWechatMini(input) : auth.loginWechatApp(input) });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldSecret === undefined) delete process.env.ACCESS_TOKEN_SECRET; else process.env.ACCESS_TOKEN_SECRET = oldSecret;
    if (oldBridge === undefined) delete process.env.LEGACY_SESSION_BRIDGE_ENABLED; else process.env.LEGACY_SESSION_BRIDGE_ENABLED = oldBridge;
  }
}
describe("WeChat sign-in cannot reactivate inactive consumer identities", () => {
  for (const kind of ["mini", "app"] as Kind[]) {
    for (const status of [UserStatus.DISABLED, UserStatus.DELETION_PENDING, UserStatus.DELETED, "FUTURE_RESTRICTED"]) {
      for (const mapping of ["byOpenId", "byUnionId"]) {
        it(kind + " rejects " + status + " found through " + mapping + " before any identity, consent or session write", async () => {
          const existing = { ...baseUser(), status };
          await fixture({ kind, [mapping]: existing }, async h => {
            await assert.rejects(h.login(), (error: any) => error.getStatus?.() === 401 && /账号不可用/.test(error.message));
            assert.deepEqual(h.calls.updates, []); assert.deepEqual(h.calls.creates, []);
            assert.deepEqual(h.calls.consents, []); assert.deepEqual(h.calls.sessions, []);
            assert.equal(existing.status, status);
          });
        });
      }
    }
    for (const mapping of ["byOpenId", "byUnionId"]) {
      it(kind + " retains verified ACTIVE account ID and session shape without writing status via " + mapping, async () => {
        const user = { ...baseUser(), mobile: "19900009909", mobileVerifiedAt: new Date("2026-09-09T00:00:00Z") };
        await fixture({ kind, [mapping]: user }, async h => {
          const session = await h.login();
          assert.equal(h.calls.creates.length, 0); assert.equal(h.calls.updates.length, 1);
          assert.equal(Object.hasOwn(h.calls.updates[0].data, "status"), false);
          assert.deepEqual(h.calls.sessions, [memberId]); assert.equal(h.calls.consents.length, 2);
          assert.equal(kind === "mini" ? session.user.id : session.member.id, memberId);
          assert.deepEqual(Object.keys(session).sort(), (kind === "mini"
            ? ["token", "refreshToken", "expiresAt", "user"] : ["accessToken", "refreshToken", "expiresAt", "member"]).sort());
          await h.guard(session, true);
        });
      });
    }
    it(kind + " keeps new unverified identity compatibility but its token cannot authenticate protected mall resources", async () => {
      await fixture({ kind }, async h => {
        const session = await h.login();
        assert.equal(h.calls.creates.length, 1);
        assert.equal(Object.hasOwn(h.calls.creates[0].data, "mobile"), false);
        assert.equal(Object.hasOwn(h.calls.creates[0].data, "mobileVerifiedAt"), false);
        await h.guard(session, true);
        await h.guard(session, false);
      });
    });
    it(kind + " does not treat an existing but unverified phone number as shopping authority", async () => {
      await fixture({ kind, byOpenId: { ...baseUser(), mobile: "19900009909" } }, async h => {
        const session = await h.login(); assert.equal(h.user().mobileVerifiedAt, null);
        await h.guard(session, true);
      });
    });
    it(kind + " keeps conflicting OpenID and UnionID owners blocked instead of overwriting either account", async () => {
      await fixture({ kind, byOpenId: baseUser(), byUnionId: { ...baseUser(), id: "synthetic-other-owner", status: "DISABLED" } }, async h => {
        await assert.rejects(h.login(), (error: any) => error.getStatus?.() === 409);
        assert.equal(h.calls.updates.length + h.calls.creates.length + h.calls.consents.length + h.calls.sessions.length, 0);
      });
    });
  }
  it("unconfigured mini login makes no provider request and does not create a local identity", async () => {
    await fixture({ kind: "mini", configured: false }, async h => {
      await assert.rejects(h.login(), (error: any) => error.getStatus?.() === 503);
      assert.equal(h.calls.fetches + h.calls.exchanges + h.calls.creates.length + h.calls.sessions.length, 0);
    });
  });
});
