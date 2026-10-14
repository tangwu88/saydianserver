-- AlterTable
ALTER TABLE "BrandPartner" ADD COLUMN     "linkedMemberId" UUID;

-- AlterTable
ALTER TABLE "PartnerSession" ADD COLUMN     "memberSessionId" UUID;

-- CreateTable
CREATE TABLE "PartnerApplication" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "partnerId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerLoginTicket" (
    "tokenHash" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "memberSessionId" UUID NOT NULL,
    "partnerUpdatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLoginTicket_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "PartnerAgreement" (
    "id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerAgreementAcceptance" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "clientIp" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "PartnerAgreementAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApplication_idempotencyKey_key" ON "PartnerApplication"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PartnerApplication_userId_createdAt_idx" ON "PartnerApplication"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerApplication_status_createdAt_idx" ON "PartnerApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PartnerLoginTicket_expiresAt_idx" ON "PartnerLoginTicket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAgreement_version_key" ON "PartnerAgreement"("version");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerAgreementAcceptance_partnerId_agreementId_key" ON "PartnerAgreementAcceptance"("partnerId", "agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPartner_linkedMemberId_key" ON "BrandPartner"("linkedMemberId");

-- AddForeignKey
ALTER TABLE "BrandPartner" ADD CONSTRAINT "BrandPartner_linkedMemberId_fkey" FOREIGN KEY ("linkedMemberId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSession" ADD CONSTRAINT "PartnerSession_memberSessionId_fkey" FOREIGN KEY ("memberSessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLoginTicket" ADD CONSTRAINT "PartnerLoginTicket_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLoginTicket" ADD CONSTRAINT "PartnerLoginTicket_memberSessionId_fkey" FOREIGN KEY ("memberSessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAgreementAcceptance" ADD CONSTRAINT "PartnerAgreementAcceptance_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAgreementAcceptance" ADD CONSTRAINT "PartnerAgreementAcceptance_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "PartnerAgreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PartnerLoginTicket" ADD CONSTRAINT "PartnerLoginTicket_challenge" CHECK ("codeChallenge" ~ '^[A-Za-z0-9_-]{43}$');
-- Only one live application and one published current agreement may exist.
CREATE UNIQUE INDEX "PartnerApplication_live_member" ON "PartnerApplication"("userId") WHERE status IN ('PENDING', 'APPROVED');
CREATE UNIQUE INDEX "PartnerAgreement_current" ON "PartnerAgreement"(active) WHERE active;
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_state" CHECK (
  (status = 'PENDING' AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND "partnerId" IS NULL) OR
  (status = 'APPROVED' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "partnerId" IS NOT NULL) OR
  (status = 'REJECTED' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "partnerId" IS NULL AND length("reviewReason") > 0)
);
ALTER TABLE "PartnerAgreement" ADD CONSTRAINT "PartnerAgreement_state" CHECK (
  (status = 'DRAFT' AND NOT active AND "publishedAt" IS NULL AND "publishedById" IS NULL) OR
  (status = 'PUBLISHED' AND "publishedAt" IS NOT NULL AND "publishedById" IS NOT NULL)
);
ALTER TABLE "PartnerAgreementAcceptance" ADD CONSTRAINT "PartnerAgreementAcceptance_time" CHECK ("acceptedAt" IS NULL OR "acceptedAt" >= "viewedAt");
CREATE FUNCTION protect_partner_published_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' AND (TG_OP = 'DELETE' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.version IS DISTINCT FROM OLD.version OR NEW.title IS DISTINCT FROM OLD.title OR NEW.content IS DISTINCT FROM OLD.content OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256" OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" OR NEW."publishedById" IS DISTINCT FROM OLD."publishedById") THEN
    RAISE EXCEPTION 'Published partner agreement is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PartnerAgreement_immutable" BEFORE UPDATE OR DELETE ON "PartnerAgreement" FOR EACH ROW EXECUTE FUNCTION protect_partner_published_agreement();
CREATE FUNCTION protect_partner_agreement_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."acceptedAt" IS NOT NULL OR NEW."partnerId" IS DISTINCT FROM OLD."partnerId" OR NEW."agreementId" IS DISTINCT FROM OLD."agreementId" OR NEW."viewedAt" IS DISTINCT FROM OLD."viewedAt" THEN
    RAISE EXCEPTION 'Partner agreement receipt is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PartnerAgreementAcceptance_immutable" BEFORE UPDATE OR DELETE ON "PartnerAgreementAcceptance" FOR EACH ROW EXECUTE FUNCTION protect_partner_agreement_acceptance();

-- Preserve existing amounts and channels while enabling the mall's mobile channels.
ALTER TABLE "PartnerRecharge" DROP CONSTRAINT "PartnerRecharge_amount_channel_check";
ALTER TABLE "PartnerRecharge" ADD CONSTRAINT "PartnerRecharge_amount_channel_check"
  CHECK ("amountCents" > 0 AND "channel" IN ('WECHAT_NATIVE', 'WECHAT_JSAPI', 'WECHAT_H5', 'ALIPAY_PAGE', 'ALIPAY_WAP'));
