-- Keep the compatible expansion atomic and bound lock waits on live tables.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

-- DropForeignKey
ALTER TABLE "CommerceOrder" DROP CONSTRAINT "CommerceOrder_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "partnerId" UUID;

-- AlterTable
ALTER TABLE "CommerceOAuthState" ADD COLUMN     "partnerCode" TEXT;

-- AlterTable
ALTER TABLE "CommerceWechatBindTicket" ADD COLUMN     "partnerCode" TEXT;

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "partnerId" UUID,
ADD COLUMN     "partnerRechargeId" UUID,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CommerceOrder" ADD COLUMN     "partnerId" UUID,
ADD COLUMN     "partnerLevelSnapshot" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PartnerLevel" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandPartner" (
    "id" UUID NOT NULL,
    "partnerNo" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "promotionCode" TEXT NOT NULL,
    "levelId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSession" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerSkuPrice" (
    "levelId" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerSkuPrice_pkey" PRIMARY KEY ("levelId","skuId")
);

-- CreateTable
CREATE TABLE "PartnerWallet" (
    "partnerId" UUID NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerWallet_pkey" PRIMARY KEY ("partnerId")
);

-- CreateTable
CREATE TABLE "PartnerLedger" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "deltaCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "referenceId" TEXT,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerRecharge" (
    "id" UUID NOT NULL,
    "rechargeNo" TEXT NOT NULL,
    "partnerId" UUID NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creditedAt" TIMESTAMP(3),

    CONSTRAINT "PartnerRecharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerLevel_code_key" ON "PartnerLevel"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPartner_partnerNo_key" ON "BrandPartner"("partnerNo");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPartner_username_key" ON "BrandPartner"("username");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPartner_promotionCode_key" ON "BrandPartner"("promotionCode");

-- CreateIndex
CREATE INDEX "BrandPartner_levelId_active_idx" ON "BrandPartner"("levelId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerSession_tokenHash_key" ON "PartnerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PartnerSession_partnerId_expiresAt_idx" ON "PartnerSession"("partnerId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerLedger_idempotencyKey_key" ON "PartnerLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PartnerLedger_partnerId_account_createdAt_idx" ON "PartnerLedger"("partnerId", "account", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRecharge_rechargeNo_key" ON "PartnerRecharge"("rechargeNo");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRecharge_idempotencyKey_key" ON "PartnerRecharge"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PartnerRecharge_partnerId_createdAt_idx" ON "PartnerRecharge"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "User_partnerId_createdAt_idx" ON "User"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_partnerId_businessType_createdAt_idx" ON "PaymentIntent"("partnerId", "businessType", "createdAt");

-- CreateIndex
CREATE INDEX "CommerceOrder_partnerId_status_createdAt_idx" ON "CommerceOrder"("partnerId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandPartner" ADD CONSTRAINT "BrandPartner_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "PartnerLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSession" ADD CONSTRAINT "PartnerSession_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSkuPrice" ADD CONSTRAINT "PartnerSkuPrice_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "PartnerLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerSkuPrice" ADD CONSTRAINT "PartnerSkuPrice_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "CommerceSku"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerWallet" ADD CONSTRAINT "PartnerWallet_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLedger" ADD CONSTRAINT "PartnerLedger_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRecharge" ADD CONSTRAINT "PartnerRecharge_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_partnerRechargeId_fkey" FOREIGN KEY ("partnerRechargeId") REFERENCES "PartnerRecharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "BrandPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing member transactions retain their owners; new partner transactions
-- must have exactly one authenticated owner, never an invented member account.
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_owner_check"
  CHECK (("userId" IS NULL) <> ("partnerId" IS NULL));
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_owner_check"
  CHECK (("userId" IS NULL) <> ("partnerId" IS NULL));
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_partner_price_check"
  CHECK ("partnerId" IS NULL OR ("referralEmployeeId" IS NULL AND "discountCents" = 0 AND "pointDiscountCents" = 0 AND "currency" = 'CNY'));
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_partner_business_check"
  CHECK (("businessType" <> 'PARTNER_RECHARGE' OR ("partnerId" IS NOT NULL AND "partnerRechargeId" IS NOT NULL AND "commerceOrderId" IS NULL AND "amountCents" > 0 AND "currency" = 'CNY'))
    AND ("channel" <> 'PARTNER_BALANCE' OR ("partnerId" IS NOT NULL AND "businessType" = 'COMMERCE_ORDER' AND "commerceOrderId" IS NOT NULL)));
ALTER TABLE "PartnerWallet" ADD CONSTRAINT "PartnerWallet_nonnegative_check" CHECK ("balanceCents" >= 0 AND "depositCents" >= 0);
ALTER TABLE "PartnerSkuPrice" ADD CONSTRAINT "PartnerSkuPrice_positive_check" CHECK ("priceCents" > 0);
ALTER TABLE "PartnerRecharge" ADD CONSTRAINT "PartnerRecharge_amount_channel_check"
  CHECK ("amountCents" > 0 AND "channel" IN ('WECHAT_NATIVE', 'ALIPAY_PAGE', 'ALIPAY_WAP'));
ALTER TABLE "PartnerLedger" ADD CONSTRAINT "PartnerLedger_account_amount_check"
  CHECK ("account" IN ('BALANCE', 'DEPOSIT') AND "deltaCents" <> 0 AND "balanceAfterCents" >= 0);

-- Append-only accounting: corrections are new entries rather than rewrites.
CREATE FUNCTION prevent_partner_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PartnerLedger is append-only'; END;
$$;
CREATE TRIGGER "PartnerLedger_immutable" BEFORE UPDATE OR DELETE ON "PartnerLedger"
  FOR EACH ROW EXECUTE FUNCTION prevent_partner_ledger_mutation();

INSERT INTO "PartnerLevel" (id, code, name, sort, "updatedAt") VALUES
  ('d7100000-0000-4000-8000-000000000001', 'distribution-1', '一级分销', 1, CURRENT_TIMESTAMP),
  ('d7100000-0000-4000-8000-000000000002', 'distribution-2', '二级分销', 2, CURRENT_TIMESTAMP),
  ('d7100000-0000-4000-8000-000000000003', 'distribution-3', '三级分销', 3, CURRENT_TIMESTAMP);

COMMIT;
