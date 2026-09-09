import type { Prisma } from "@prisma/client";
import { globalLocale } from "./global-identity";

export async function globalLegalReference(prisma: Pick<Prisma.TransactionClient, "globalLegalDocument">, documentType: string, localeInput: unknown) {
  const preferred = globalLocale(localeInput);
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const rows = await prisma.globalLegalDocument.findMany({ where: { documentType, locale: { in: locales }, active: true, reviewed: true, publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" } });
  const document = locales.map(locale => rows.find(row => row.locale === locale && row.contentHtml.trim())).find(Boolean);
  if (!document) return null;
  return { version: document.version, locale: document.locale, path: `/api/saydian-app/v2/content/legal/${encodeURIComponent(documentType)}?version=${encodeURIComponent(document.version)}&locale=${encodeURIComponent(document.locale)}` };
}

export async function globalLegalBundle(prisma: Pick<Prisma.TransactionClient, "globalLegalDocument">, localeInput: unknown) {
  const preferred = globalLocale(localeInput);
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const rows = await prisma.globalLegalDocument.findMany({ where: { locale: { in: locales }, documentType: { in: ["user_agreement", "privacy_policy"] }, active: true, reviewed: true, publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" } });
  for (const locale of locales) {
    const terms = rows.find(row => row.locale === locale && row.documentType === "user_agreement");
    const privacy = rows.find(row => row.locale === locale && row.documentType === "privacy_policy");
    if (terms?.version && privacy?.version === terms.version && terms.contentHtml.trim() && privacy.contentHtml.trim()) {
      const path = (type: string) => `/api/saydian-app/v2/content/legal/${type}?version=${encodeURIComponent(terms.version)}&locale=${encodeURIComponent(locale)}`;
      return { consentVersion: terms.version, locale, documents: { userAgreement: { path: path("user_agreement"), locale, version: terms.version }, privacyPolicy: { path: path("privacy_policy"), locale, version: terms.version } } };
    }
  }
  return null;
}
