import { BadRequestException, HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { normalizedMobile, safeObject, sha256 } from "../common/crypto";
import { normalizedEmail } from "../auth/global-identity";

export type CareInvitationTarget =
  | { memberNo: number; key: string }
  | { email: string; key: string }
  | { mobile: string; key: string };

export function careInvitationTarget(input: unknown): CareInvitationTarget {
  const body =
    typeof input === "string" ? { identifier: input } : safeObject(input);
  if (Object.hasOwn(body, "memberNo")) {
    if (
      Object.hasOwn(body, "identifier") ||
      Object.hasOwn(body, "mobile") ||
      typeof body.memberNo !== "string" ||
      !/^[1-9]\d{0,9}$/.test(body.memberNo) ||
      Number(body.memberNo) > 2147483647
    )
      throw new BadRequestException(
        "会员编号须为 1 至 2147483647 的规范整数字符串，且不能同时填写联系方式",
      );
    return {
      memberNo: Number(body.memberNo),
      key: `memberNo:${body.memberNo}`,
    };
  }
  const identifier = String(body.identifier ?? body.mobile ?? "");
  const email = normalizedEmail(identifier);
  if (email) return { email, key: `email:${email}` };
  const mobile = normalizedMobile(identifier);
  if (mobile) return { mobile, key: `mobile:${mobile}` };
  throw new BadRequestException("手机号格式不正确");
}

export async function careLock(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export function carePairKey(inviterId: string, recipientId: string) {
  return `care-relationship:${inviterId}:${recipientId}`;
}

// Existing cross-process reservation storage, with a disjoint namespace and no
// raw contacts. Return (don't throw) so rejected attempts retain their cooldown.
export async function reserveCareInvitation(
  tx: Prisma.TransactionClient,
  inviterId: string,
  target: Extract<CareInvitationTarget, { memberNo: number }>,
  recipientId?: string,
) {
  const now = new Date();
  for (const [scope, identity, milliseconds] of [
    ["account", inviterId, 30_000],
    ["target", recipientId ? `member:${recipientId}` : target.key, 60_000],
  ] as const) {
    const key = `care-invite:${scope}:${sha256(identity)}`;
    await careLock(tx, key);
    await tx.globalVerificationThrottle.upsert({
      where: { key },
      create: { key, reservedAt: new Date(0) },
      update: {},
    });
    const reserved = await tx.globalVerificationThrottle.updateMany({
      where: {
        key,
        reservedAt: { lte: new Date(now.valueOf() - milliseconds) },
      },
      data: { reservedAt: now },
    });
    if (reserved.count !== 1) return false;
  }
  return true;
}

export function careInvitationLimited() {
  return new HttpException(
    {
      errorKey: "CARE_INVITATION_RATE_LIMITED",
      message: "Please wait before submitting another care invitation.",
    },
    429,
  );
}
