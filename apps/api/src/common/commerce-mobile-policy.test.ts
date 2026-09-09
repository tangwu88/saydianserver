import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { sign } from "jsonwebtoken";
import { UserAuthGuard } from "./user-auth.guard";
import { legacySessionDigest } from "./legacy-session-bridge";
import { requiresVerifiedCommerceMobile } from "./commerce-mobile-policy";

type CredentialKind = "jwt" | "opaque";
const legacyCommerce = ["/api/inv-shop/v1/member/cart-item/index", "/api/inv-shop/v1/order/order/create",
  "/api/v1/member/address/index", "/api/v1/pay"];
const id = "11111111-1111-4111-8111-111111119909";
const sessionId = "22222222-2222-4222-8222-222222229909";
const secret = "synthetic-commerce-guard-key-not-a-real-secret";
const bridgeKey = "synthetic-legacy-bridge-hash-key-not-a-real-secret";
const opaque = "SYNTHETIC-SOURCE-VERIFIED-OPAQUE-20260909";
const user = () => ({ status: "ACTIVE", mobile: "19900009909" as string | null, mobileVerifiedAt: new Date("2026-09-08T00:00:00Z") as Date | null });
async function fixture(
  kind: CredentialKind, path: string, member: any,
  run: (h: any) => Promise<void>,
  options: { badCredential?: boolean; invalidSession?: boolean; phoneLostBeforeCas?: boolean; originalUrl?: string; bridgeDisabled?: boolean } = {},
) {
  const values = { ACCESS_TOKEN_SECRET: secret, LEGACY_SESSION_BRIDGE_ENABLED: options.bridgeDisabled ? "false" : "true",
    LEGACY_SESSION_BRIDGE_DEADLINE: "2099-01-01T00:00:00.000Z", LEGACY_SESSION_HASH_KEY: bridgeKey };
  const old = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  const calls = { jwt: [] as any[], lookup: [] as any[], cas: [] as any[], upsert: [] as any[] };
  const token = options.badCredential ? "SYNTHETIC-UNKNOWN-CREDENTIAL" : kind === "opaque" ? opaque
    : sign({ sub: id, sid: sessionId, typ: "access", jti: "synthetic-access-jti" }, secret,
      { issuer: "saydianapp-server", audience: "saydian-app", expiresIn: 300 });
  const expiresAt = new Date("2098-01-01T00:00:00.000Z");
  const tx = {
    legacySessionCredential: {
      findUnique: async (args: any) => {
        calls.lookup.push(args);
        if (args.where.sourceSystem_tokenDigest.tokenDigest !== legacySessionDigest(opaque, bridgeKey)) return null;
        return { id: sessionId, userId: id, sessionId: null, revokedAt: options.invalidSession ? new Date() : null,
          expiresAt, sourceVerifiedAt: new Date("2026-09-08T00:00:00Z"), verificationEvidence: "synthetic-reviewed-source-session",
          user: member };
      },
      updateMany: async (args: any) => {
        calls.cas.push(args);
        if (options.phoneLostBeforeCas && args.where.user.mobileVerifiedAt?.not === null) return { count: 0 };
        return { count: 1 };
      },
    },
    userSession: { upsert: async (args: any) => { calls.upsert.push(args); return { id: sessionId, userId: id, expiresAt, revokedAt: null }; } },
  };
  const prisma = {
    userSession: { findFirst: async (args: any) => {
      calls.jwt.push(args);
      const expected = args.where.user;
      assert.equal(expected.status, "ACTIVE");
      if (options.invalidSession || member.status !== "ACTIVE" || expected.mobile && !member.mobile || expected.mobileVerifiedAt && !member.mobileVerifiedAt) return null;
      return { id: sessionId };
    } },
    $transaction: async (operation: any) => operation(tx),
  };
  const request: any = { path, ...(options.originalUrl ? { originalUrl: options.originalUrl } : {}),
    header: (name: string) => name === "authorization" ? "Bearer " + token : "" };
  const guard = new UserAuthGuard(prisma as any);
  try {
    await run({ calls, request, authenticate: () => guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any) });
  } finally {
    for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
const rejected = (pending: Promise<unknown>) => assert.rejects(pending, (error: any) => error.getStatus?.() === 401);
describe("verified mobile boundaries cover exact legacy shopping routes", () => {
  it("matches only complete commerce prefixes, including case-insensitive Express routes and query-bearing URLs", () => {
    for (const path of [...legacyCommerce, "/api/saidian-mall/v1/storefront/orders", "/API/INV-SHOP/V1/member/cart-item/index",
      "/api/v1/member/address", "/api/v1/pay/?x=1"]) assert.equal(requiresVerifiedCommerceMobile(path), true, path);
    for (const path of ["/api/v1/member/member/my", "/api/v1/site/login", "/api/v1/health/records",
      "/api/saydian-app/v2/health/records", "/api/rf-article/v1/article/view", "/api/v1/pages",
      "/api/v1/payroll", "/api/v1/member/address-book", "/api/inv-shop/v10/order/create",
      "/api/saidian-mall/v10/storefront/cart", "/prefix/api/inv-shop/v1/member/cart-item/index"]) {
      assert.equal(requiresVerifiedCommerceMobile(path), false, path);
    }
  });
  for (const path of legacyCommerce) for (const kind of ["jwt", "opaque"] as CredentialKind[]) {
    it(kind + " refuses unverified or missing phones on " + path + " without creating a bridge session", async () => {
      for (const member of [
        { ...user(), mobileVerifiedAt: null },
        { ...user(), mobile: null },
        { status: "ACTIVE", mobile: "19900009909" }, // imported phone without source verification timestamp
      ]) {
        const before = { ...member };
        await fixture(kind, path, member, async h => {
          await rejected(h.authenticate()); assert.equal(h.request.authUser, undefined);
          assert.equal(h.calls.upsert.length, 0); assert.equal(h.calls.cas.length, 0);
          if (kind === "jwt") assert.deepEqual(h.calls.jwt[0].where.user,
            { status: "ACTIVE", mobile: { not: null }, mobileVerifiedAt: { not: null } });
          else assert.deepEqual(h.calls.lookup[0].include.user.select,
            { status: true, mobile: true, mobileVerifiedAt: true });
          assert.deepEqual(member, before);
        });
      }
    });
    it(kind + " allows a valid session with a source-verified phone on " + path, async () => {
      await fixture(kind, path, user(), async h => {
        assert.equal(await h.authenticate(), true); assert.equal(h.request.authUser.id, id);
        if (kind === "opaque") {
          assert.deepEqual(h.calls.cas[0].where.user, { status: "ACTIVE", mobile: { not: null }, mobileVerifiedAt: { not: null } });
          assert.deepEqual(h.calls.cas[0].data, { sessionId });
          assert.equal(h.calls.upsert.length, 1);
          assert.deepEqual(h.calls.upsert[0].update, {});
        }
      });
    });
  }
  it("new mall JWT still requires verification and legacy opaque tokens are not newly accepted on new mall APIs", async () => {
    for (const kind of ["jwt", "opaque"] as CredentialKind[]) {
      await fixture(kind, "/api/saidian-mall/v1/storefront/cart", { ...user(), mobileVerifiedAt: null }, async h => {
        await rejected(h.authenticate()); assert.equal(h.calls.upsert.length, 0);
      });
    }
    await fixture("opaque", "/api/saidian-mall/v1/storefront/cart", user(), async h => {
      await rejected(h.authenticate()); assert.equal(h.calls.lookup.length, 0);
    });
  });
  it("unverified App JWT retains non-commerce health/profile access without acquiring shopping authority", async () => {
    await fixture("jwt", "/api/saydian-app/v2/health/records", { ...user(), mobile: null, mobileVerifiedAt: null }, async h => {
      assert.equal(await h.authenticate(), true);
      assert.deepEqual(h.calls.jwt[0].where.user, { status: "ACTIVE" });
    });
  });
  it("source-verified legacy opaque session retains old non-commerce member access without fabricating phone proof", async () => {
    const member = { status: "ACTIVE", mobile: null, mobileVerifiedAt: null };
    await fixture("opaque", "/api/v1/member/member/my", member, async h => {
      assert.equal(await h.authenticate(), true);
      assert.deepEqual(h.calls.cas[0].where.user, { status: "ACTIVE" });
      assert.deepEqual(h.calls.cas[0].data, { sessionId }); assert.equal(member.mobileVerifiedAt, null);
    });
  });
  it("a phone-verification change between bridge lookup and CAS prevents any new bridge session", async () => {
    await fixture("opaque", legacyCommerce[0]!, user(), async h => {
      await rejected(h.authenticate()); assert.equal(h.calls.cas.length, 1); assert.equal(h.calls.upsert.length, 0);
      assert.deepEqual(h.calls.cas[0].where.user, { status: "ACTIVE", mobile: { not: null }, mobileVerifiedAt: { not: null } });
    }, { phoneLostBeforeCas: true });
  });
  it("full original URL classification protects commerce even if a router supplies a shortened path", async () => {
    await fixture("jwt", "/member/cart-item/index", { ...user(), mobileVerifiedAt: null }, async h => {
      await rejected(h.authenticate());
      assert.deepEqual(h.calls.jwt[0].where.user, { status: "ACTIVE", mobile: { not: null }, mobileVerifiedAt: { not: null } });
    }, { originalUrl: "/api/inv-shop/v1/member/cart-item/index?from=synthetic" });
  });
  it("verified phone alone cannot authorize unknown, revoked, inactive, or disabled-bridge credentials", async () => {
    for (const kind of ["jwt", "opaque"] as CredentialKind[]) {
      for (const options of [{ badCredential: true }, { invalidSession: true }]) {
        await fixture(kind, legacyCommerce[1]!, user(), async h => { await rejected(h.authenticate()); }, options);
      }
      await fixture(kind, legacyCommerce[1]!, { ...user(), status: "DISABLED" }, async h => { await rejected(h.authenticate()); });
    }
    await fixture("opaque", legacyCommerce[1]!, user(), async h => {
      await rejected(h.authenticate()); assert.equal(h.calls.lookup.length, 0);
    }, { bridgeDisabled: true });
  });
});
