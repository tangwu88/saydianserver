"use strict";
// Mounted read-only into the US API container; Node resolution must use the
// installed API's Prisma client. Never seed sample records or create accounts.
const { readFileSync } = require("node:fs"),
  { join } = require("node:path"),
  { createHash } = require("node:crypto");
const { createRequire } = require("node:module");
const manifest = JSON.parse(
  readFileSync(join(__dirname, "approved.json"), "utf8"),
);
if (
  process.env.DEPLOYMENT_SITE !== "us" ||
  process.env.PUBLIC_BASE_URL !== "https://app.saydian.com" ||
  process.argv[2] !== "--apply" ||
  process.argv[3] !== manifest.version ||
  manifest.reviewed !== true
)
  throw Error("Explicit approved US publication required.");
const types = new Set(["sayheath_privacy_policy", "sayheath_user_agreement"]);
const docs = manifest.documents.map((d) => {
  if (
    !types.delete(d.documentType) ||
    !["terms-en.txt", "privacy-en.txt"].includes(d.file)
  )
    throw Error("Unexpected document.");
  const bytes = readFileSync(join(__dirname, d.file));
  if (createHash("sha256").update(bytes).digest("hex") !== d.sha256)
    throw Error("Reviewed text mismatch.");
  const contentHtml = bytes
    .toString("utf8")
    .trim()
    .split(/\n\s*\n/)
    .map(
      (p) =>
        "<p>" +
        p
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>") +
        "</p>",
    )
    .join("\n");
  return {
    documentType: d.documentType,
    locale: "en",
    title: d.title,
    version: manifest.version,
    contentHtml,
  };
});
if (types.size) throw Error("Incomplete pair.");
const { PrismaClient } = createRequire(join(process.cwd(), "package.json"))(
    "@prisma/client",
  ),
  db = new PrismaClient();
(async () => {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('sayheath-legal-pair',0))`;
    for (const data of docs) {
      const old = await tx.globalLegalDocument.findUnique({
        where: {
          documentType_version_locale: {
            documentType: data.documentType,
            version: data.version,
            locale: "en",
          },
        },
      });
      if (
        old &&
        (!old.active || !old.reviewed || old.contentHtml !== data.contentHtml)
      )
        throw Error("Existing document requires administrator review.");
      const previous = await tx.globalLegalDocument.findFirst({
        where: {
          documentType: data.documentType,
          locale: "en",
          active: true,
          version: { not: data.version },
        },
      });
      if (previous)
        throw Error(
          "Another approved version is active; use the legal administrator.",
        );
      if (!old)
        await tx.globalLegalDocument.create({
          data: {
            ...data,
            reviewed: true,
            active: true,
            publishedAt: new Date(),
          },
        });
    }
  });
  console.log(
    "Published or verified the exact reviewed SayHeath document pair.",
  );
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
