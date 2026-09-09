ALTER TABLE "User" ADD COLUMN "email" TEXT, ADD COLUMN "emailVerifiedAt" TIMESTAMP(3), ADD COLUMN "locale" TEXT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "GlobalVerificationChallenge" (
  "id" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "locale" TEXT NOT NULL DEFAULT 'en',
  "codeHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "sentAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalVerificationChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GlobalVerificationChallenge_identifier_channel_createdAt_idx" ON "GlobalVerificationChallenge"("identifier", "channel", "createdAt");
CREATE TABLE "GlobalVerificationThrottle" ("key" TEXT NOT NULL, "reservedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "GlobalVerificationThrottle_pkey" PRIMARY KEY ("key"));
CREATE TABLE "GlobalLegalDocument" (
  "id" UUID NOT NULL, "documentType" TEXT NOT NULL, "version" TEXT NOT NULL, "locale" TEXT NOT NULL DEFAULT 'en',
  "title" TEXT NOT NULL, "contentHtml" TEXT NOT NULL, "reviewed" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT false,
  "publishedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalLegalDocument_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GlobalLegalDocument_documentType_version_locale_key" ON "GlobalLegalDocument"("documentType", "version", "locale");
CREATE INDEX "GlobalLegalDocument_locale_active_reviewed_idx" ON "GlobalLegalDocument"("locale", "active", "reviewed");
ALTER TABLE "CommerceAddress" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "CommerceOrder" ADD COLUMN "countryCode" TEXT, ADD COLUMN "postalCode" TEXT;
ALTER TABLE "ArticleCategory" ADD COLUMN "locale" TEXT;
ALTER TABLE "Article" ADD COLUMN "locale" TEXT;
ALTER TABLE "AiConversation" ADD COLUMN "locale" TEXT;
