import {
  CareIdentityDisclosure,
  type CareRelationship,
  type Prisma,
} from "@prisma/client";

// Unaccepted numbered invitations must not turn an acknowledgement into an
// account-existence lookup, including rejected/revoked requests and V1 aliases.
export function visibleCareRelationships(
  userId: string,
): Prisma.CareRelationshipWhereInput {
  return {
    OR: [
      { recipientId: userId },
      {
        inviterId: userId,
        identityDisclosure: { not: CareIdentityDisclosure.MEMBER_NO_PENDING },
      },
    ],
  };
}

export function careIdentityVisible(
  userId: string,
  relationship: Pick<
    CareRelationship,
    "inviterId" | "recipientId" | "identityDisclosure"
  >,
) {
  return (
    relationship.recipientId === userId ||
    (relationship.inviterId === userId &&
      relationship.identityDisclosure !==
        CareIdentityDisclosure.MEMBER_NO_PENDING)
  );
}
