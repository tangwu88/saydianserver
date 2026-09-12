type MemberIdentity = {
  id: string;
  mobile?: string | null;
  mobileVerifiedAt?: Date | null;
};

type PromoterIdentity = {
  wecomUserId: string;
  mobile?: string | null;
};

export function memberPromoterExternalId(userId: string): string {
  return `member:${userId}`;
}

export function isOwnPromoter(
  member: MemberIdentity,
  promoter: PromoterIdentity,
): boolean {
  if (promoter.wecomUserId === memberPromoterExternalId(member.id)) return true;
  const memberMobile = member.mobileVerifiedAt
    ? comparableMobile(member.mobile)
    : "";
  return Boolean(
    memberMobile && memberMobile === comparableMobile(promoter.mobile),
  );
}

function comparableMobile(value: unknown): string {
  return String(value ?? "").trim().replace(/[\s-]/g, "");
}
