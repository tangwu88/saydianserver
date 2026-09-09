import { describe, expect, it, vi } from "vitest";
import { legacySessionDigest, resolveLegacySession } from "./legacy-session-bridge";
import type { PrismaService } from "./prisma.service";

const now = new Date("2026-09-09T00:00:00Z");
const environment = {
  LEGACY_SESSION_BRIDGE_ENABLED: "true",
  LEGACY_SESSION_BRIDGE_DEADLINE: "2026-10-09T00:00:00Z",
  LEGACY_SESSION_HASH_KEY: "only-a-test-key-with-more-than-32-characters",
};
const token = "opaque-source-session-token-for-test";
const credential = {
  id: "65e23d0a-78da-4294-9e50-449a98db1099", userId: "e3cf122d-d7dd-4816-8de6-a84d9d2f93db",
  sessionId: null, revokedAt: null, expiresAt: new Date("2026-09-20T00:00:00Z"),
  sourceVerifiedAt: new Date("2026-09-08T00:00:00Z"), verificationEvidence: "reviewed-session-schema-1", user: { status: "ACTIVE" },
};
function database(value: unknown = credential, revoked = false) {
  const session = { id: credential.id, userId: credential.userId, expiresAt: credential.expiresAt, revokedAt: revoked ? now : null };
  const findUnique = vi.fn(async () => value);
  const tx = { userSession: { upsert: vi.fn(async () => session) }, legacySessionCredential: { findUnique, updateMany: vi.fn(async () => ({ count: 1 })) } };
  return { prisma: { legacySessionCredential: { findUnique }, $transaction: async (fn: (value: unknown) => unknown) => fn(tx) } as unknown as PrismaService, findUnique, tx };
}
describe("controlled legacy-session bridge", () => {
  it("is disabled by default and never accepts a legacy token on the v2 API", async () => {
    const db = database();
    expect(await resolveLegacySession(db.prisma, token, "/api/v1/member/member/my", {}, now)).toBeNull();
    expect(await resolveLegacySession(db.prisma, token, "/api/saydian-app/v2/members/me", environment, now)).toBeNull();
    expect(db.findUnique).not.toHaveBeenCalled();
  });
  it("accepts only an imported source-verified token hash and binds one revocable session", async () => {
    const db = database();
    expect(await resolveLegacySession(db.prisma, token, "/api/v1/member/member/my", environment, now)).toEqual({ id: credential.userId, sessionId: credential.id });
    expect(db.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { sourceSystem_tokenDigest: { sourceSystem: "legacy_app", tokenDigest: legacySessionDigest(token, environment.LEGACY_SESSION_HASH_KEY) } } }));
  });
  it.each([
    null, { ...credential, revokedAt: now }, { ...credential, expiresAt: now },
    { ...credential, verificationEvidence: "" }, { ...credential, user: { status: "DISABLED" } },
  ])("rejects missing, expired, revoked, unverified or disabled source sessions", async (value) => {
    const db = database(value);
    expect(await resolveLegacySession(db.prisma, token, "/api/v1/member/member/my", environment, now)).toBeNull();
    expect(db.tx.userSession.upsert).not.toHaveBeenCalled();
  });
  it("does not revive a session after logout and expires at the bridge deadline", async () => {
    expect(await resolveLegacySession(database(credential, true).prisma, token, "/api/v1/member/member/my", environment, now)).toBeNull();
    const db = database();
    expect(await resolveLegacySession(db.prisma, token, "/api/v1/member/member/my", { ...environment, LEGACY_SESSION_BRIDGE_DEADLINE: now.toISOString() }, now)).toBeNull();
    expect(db.findUnique).not.toHaveBeenCalled();
  });
  it("does not bind a credential revoked concurrently after lookup", async () => {
    const db = database();
    db.tx.legacySessionCredential.updateMany.mockResolvedValue({ count: 0 });
    expect(await resolveLegacySession(db.prisma, token, "/api/v1/member/member/my", environment, now)).toBeNull();
    expect(db.tx.userSession.upsert).not.toHaveBeenCalled();
  });
});
