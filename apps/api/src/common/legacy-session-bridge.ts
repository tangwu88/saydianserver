import { createHmac, randomUUID } from "node:crypto";
import { cutoverFlag } from "@saydian/app-contracts";
import type { PrismaService } from "./prisma.service";
import { requiresVerifiedCommerceMobile } from "./commerce-mobile-policy";

const legacyPaths = /^\/api\/(?:v1|rf-article|inv-shop\/v1)(?:\/|$)/;

export function legacySessionDigest(token: string, key: string): string {
  if (key.length < 32) throw new Error("Legacy session digest key must contain at least 32 characters");
  return createHmac("sha256", key).update(`legacy_app\0${token}`).digest("hex");
}

/** Accept only source-verified, imported opaque sessions, never an unknown JWT
 * algorithm, a user-supplied identity claim or a token merely present in a header. */
export async function resolveLegacySession(
  prisma: PrismaService,
  token: string,
  requestPath: string,
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<{ id: string; sessionId: string } | null> {
  if (!legacyPaths.test(requestPath) || !cutoverFlag(environment.LEGACY_SESSION_BRIDGE_ENABLED)) return null;
  const deadline = new Date(environment.LEGACY_SESSION_BRIDGE_DEADLINE ?? "");
  const key = environment.LEGACY_SESSION_HASH_KEY?.trim() ?? "";
  if (!Number.isFinite(deadline.valueOf()) || deadline <= now || key.length < 32 || token.length < 16 || token.length > 8192) return null;
  const commerce = requiresVerifiedCommerceMobile(requestPath);
  return prisma.$transaction(async (tx) => {
    const credential = await tx.legacySessionCredential.findUnique({
      where: { sourceSystem_tokenDigest: { sourceSystem: "legacy_app", tokenDigest: legacySessionDigest(token, key) } },
      include: { user: { select: { status: true, mobile: true, mobileVerifiedAt: true } } },
    });
    if (!credential || credential.revokedAt || credential.expiresAt <= now || credential.sourceVerifiedAt > now ||
      !credential.verificationEvidence.trim() || credential.user.status !== "ACTIVE" ||
      (commerce && (!credential.user.mobile || !credential.user.mobileVerifiedAt))) return null;
    const expiresAt = new Date(Math.min(credential.expiresAt.valueOf(), deadline.valueOf()));
    // Lock/revalidate the credential before creating a session. A revocation
    // committed between lookup and binding must fail closed, not revive it.
    const bound = await tx.legacySessionCredential.updateMany({
      where: { id: credential.id, revokedAt: null, expiresAt: { gt: now }, sourceVerifiedAt: { lte: now },
        user: { status: "ACTIVE", ...(commerce ? { mobile: { not: null }, mobileVerifiedAt: { not: null } } : {}) }, OR: [{ sessionId: null }, { sessionId: credential.sessionId ?? credential.id }] },
      data: { sessionId: credential.sessionId ?? credential.id },
    });
    if (bound.count !== 1) return null;
    // The imported UUID is a deterministic bridge-session ID, so concurrent
    // first requests do not create several independent sessions.
    const saved = await tx.userSession.upsert({
      where: { id: credential.sessionId ?? credential.id },
      create: {
        id: credential.id,
        userId: credential.userId,
        accessJti: randomUUID(),
        refreshTokenHash: createHmac("sha256", key).update(`bridge-session\0${credential.id}`).digest("hex"),
        expiresAt,
      },
      update: {},
    });
    if (saved.userId !== credential.userId || saved.revokedAt || saved.expiresAt <= now) return null;
    return { id: credential.userId, sessionId: saved.id };
  });
}
