import { Prisma } from "@prisma/client";
import { globalError } from "../auth/global-identity";

export function normalizedPartnerCode(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return null;
  const code = String(input).trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code))
    throw globalError(
      400,
      "partner_unavailable",
      "品牌伙伴推广链接已失效，您可以选择普通注册。",
    );
  return code;
}

/** Resolve only when creating a new verified member, in that creation transaction. */
export async function partnerRegistrationData(
  tx: Prisma.TransactionClient,
  input: unknown,
  noticeVersion?: unknown,
) {
  const promotionCode = normalizedPartnerCode(input);
  if (!promotionCode) return {};
  if (noticeVersion !== "partner-service-v1")
    throw globalError(
      409,
      "partner_notice_required",
      "请先确认品牌伙伴信息，或选择普通注册。",
    );
  const partner = await tx.brandPartner.findFirst({
    where: { promotionCode, active: true },
    select: { id: true },
  });
  if (!partner)
    throw globalError(
      409,
      "partner_unavailable",
      "品牌伙伴推广链接已失效，您可以选择普通注册。",
    );
  // Serialize account disabling against creation/attribution.
  await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partner.id}::uuid FOR SHARE`;
  const current = await tx.brandPartner.findFirst({
    where: { id: partner.id, active: true },
    select: { id: true },
  });
  if (!current)
    throw globalError(
      409,
      "partner_unavailable",
      "品牌伙伴推广链接已失效，您可以选择普通注册。",
    );
  return { partnerId: current.id };
}

export async function auditPartnerRegistration(
  tx: Prisma.TransactionClient,
  user: { id: string; partnerId: string | null },
) {
  if (!user.partnerId) return;
  await tx.auditLog.create({
    data: {
      actorType: "MEMBER",
      actorId: user.id,
      action: "PARTNER_REGISTRATION",
      entityType: "USER",
      entityId: user.id,
      afterJson: {
        partnerId: user.partnerId,
        noticeVersion: "partner-service-v1",
        source: "H5_VERIFIED_REGISTRATION",
      },
    },
  });
}
