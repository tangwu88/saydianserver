import type { Prisma } from "@prisma/client";
import { SLEEP_ANALYSIS_NOTICE } from "@saydian/app-contracts";
import { globalLegalReference } from "../auth/global-legal";

type ConsentDatabase = Pick<
  Prisma.TransactionClient,
  "user" | "consentRecord" | "globalLegalDocument"
>;

/** Sleep consent is product-scoped; never adopt or alter HealthProfile consent. */
export async function readSleepAnalysisConsent(
  db: ConsentDatabase,
  userId: string,
) {
  const [user, record] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { locale: true } }),
    db.consentRecord.findFirst({
      where: { userId, documentType: SLEEP_ANALYSIS_NOTICE },
      orderBy: { acceptedAt: "desc" },
    }),
  ]);
  const document = await globalLegalReference(
    db,
    SLEEP_ANALYSIS_NOTICE,
    user?.locale,
  );
  return {
    availableVersion: document?.version ?? null,
    document,
    granted: Boolean(
      record &&
      !record.withdrawnAt &&
      document &&
      record.version === document.version,
    ),
    version: record?.version ?? null,
    grantedAt: record?.acceptedAt.toISOString() ?? null,
    withdrawnAt: record?.withdrawnAt?.toISOString() ?? null,
  };
}
