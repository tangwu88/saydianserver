import type { Prisma } from "@prisma/client";
import {
  currentSleepAnalysisNotice,
  SLEEP_ANALYSIS_NOTICE,
} from "@saydian/app-contracts";
import { globalLocale } from "../auth/global-identity";

type ConsentDatabase = Pick<
  Prisma.TransactionClient,
  "user" | "consentRecord" | "globalLegalDocument"
>;

/** Sleep consent is product-scoped; never adopt or alter HealthProfile consent. */
export async function readSleepAnalysisConsent(
  db: ConsentDatabase,
  userId: string,
) {
  const [user, record, documents] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { locale: true } }),
    db.consentRecord.findFirst({
      where: { userId, documentType: SLEEP_ANALYSIS_NOTICE },
      orderBy: { acceptedAt: "desc" },
    }),
    db.globalLegalDocument.findMany({
      where: {
        documentType: SLEEP_ANALYSIS_NOTICE,
        active: true,
        reviewed: true,
        publishedAt: { lte: new Date() },
      },
      orderBy: { publishedAt: "desc" },
    }),
  ]);
  const selected = currentSleepAnalysisNotice(
    documents,
    globalLocale(user?.locale),
  );
  const document = selected
    ? {
        version: selected.version,
        locale: selected.locale,
        path: `/api/saydian-app/v2/content/legal/${encodeURIComponent(SLEEP_ANALYSIS_NOTICE)}?version=${encodeURIComponent(selected.version)}&locale=${encodeURIComponent(selected.locale)}`,
      }
    : null;
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
