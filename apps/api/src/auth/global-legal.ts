import type { Prisma } from "@prisma/client";
import { globalError, globalLocale } from "./global-identity";

export const defaultGlobalLegalProduct = "saydian-global" as const;
export type GlobalLegalProduct = typeof defaultGlobalLegalProduct | "say-ring";
export const sayRingMinimumAge = 14;

const documentTypesByProduct = {
  "saydian-global": {
    userAgreement: "user_agreement",
    privacyPolicy: "privacy_policy",
  },
  "say-ring": {
    userAgreement: "say_ring_user_agreement",
    privacyPolicy: "say_ring_privacy_policy",
  },
} as const satisfies Record<GlobalLegalProduct, Record<string, string>>;

export function globalLegalProduct(input: unknown): GlobalLegalProduct {
  const product = String(input ?? "").trim();
  if (!product || product === defaultGlobalLegalProduct) return defaultGlobalLegalProduct;
  if (product === "say-ring") return product;
  throw globalError(400, "invalid_product", "Choose a supported product.");
}

export async function globalLegalReference(prisma: Pick<Prisma.TransactionClient, "globalLegalDocument">, documentType: string, localeInput: unknown) {
  const preferred = globalLocale(localeInput);
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const rows = await prisma.globalLegalDocument.findMany({ where: { documentType, locale: { in: locales }, active: true, reviewed: true, publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" } });
  const document = locales.map(locale => rows.find(row => row.locale === locale && row.contentHtml.trim())).find(Boolean);
  if (!document) return null;
  return { version: document.version, locale: document.locale, path: `/api/saydian-app/v2/content/legal/${encodeURIComponent(documentType)}?version=${encodeURIComponent(document.version)}&locale=${encodeURIComponent(document.locale)}` };
}

export async function globalLegalBundle(prisma: Pick<Prisma.TransactionClient, "globalLegalDocument">, localeInput: unknown, productInput?: unknown) {
  const product = globalLegalProduct(productInput);
  const documentTypes = documentTypesByProduct[product];
  const preferred = globalLocale(localeInput);
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const rows = await prisma.globalLegalDocument.findMany({ where: { locale: { in: locales }, documentType: { in: [documentTypes.userAgreement, documentTypes.privacyPolicy] }, active: true, reviewed: true, publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" } });
  for (const locale of locales) {
    const terms = rows.find(row => row.locale === locale && row.documentType === documentTypes.userAgreement);
    const privacy = rows.find(row => row.locale === locale && row.documentType === documentTypes.privacyPolicy);
    if (terms?.version && privacy?.version === terms.version && terms.contentHtml.trim() && privacy.contentHtml.trim()) {
      const path = (type: string) => `/api/saydian-app/v2/content/legal/${type}?version=${encodeURIComponent(terms.version)}&locale=${encodeURIComponent(locale)}`;
      return {
        product,
        consentVersion: terms.version,
        locale,
        documentTypes,
        documents: {
          userAgreement: { path: path(documentTypes.userAgreement), locale, version: terms.version },
          privacyPolicy: { path: path(documentTypes.privacyPolicy), locale, version: terms.version },
        },
      };
    }
  }
  return null;
}

export function globalConsentSource(base: string, legal: { product: GlobalLegalProduct; locale: string }) {
  return `${base}${legal.product === defaultGlobalLegalProduct ? "" : `:${legal.product}`}:${legal.locale}`;
}

export function sayRingMinimumAgeConsent(product: GlobalLegalProduct, ageConfirmed: unknown) {
  if (product !== "say-ring") return null;
  if (ageConfirmed !== true) {
    throw globalError(400, "minimum_age_confirmation_required", `Say Ring is available only to people aged ${sayRingMinimumAge} or older.`);
  }
  return { documentType: "say_ring_minimum_age", version: "14-plus-v1" };
}

export async function recordSayRingMinimumAgeConsent(
  db: Pick<Prisma.TransactionClient, "consentRecord">,
  userId: string,
  consent: ReturnType<typeof sayRingMinimumAgeConsent>,
  source: string,
) {
  if (!consent) return;
  await db.consentRecord.upsert({
    where: { userId_documentType_version: { userId, ...consent } },
    create: { userId, ...consent, source },
    update: { withdrawnAt: null, source },
  });
}
