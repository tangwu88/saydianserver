-- CreateEnum
CREATE TYPE "CouponGiftStatus" AS ENUM ('RESERVED', 'CLAIMED', 'EXPIRED', 'REVOKED');

-- AlterTable
ALTER TABLE "CommerceCouponClaim"
ALTER COLUMN "sourceGiftId" TYPE UUID USING "sourceGiftId"::UUID;

-- CreateTable
CREATE TABLE "IntegrationSecret" (
    "integrationKey" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSecret_pkey" PRIMARY KEY ("integrationKey")
);

-- CreateTable
CREATE TABLE "CommerceEmployeeCouponGrant" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL DEFAULT 0,
    "redeemedQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceEmployeeCouponGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCouponGift" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CouponGiftStatus" NOT NULL DEFAULT 'RESERVED',
    "couponId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedByUserId" UUID,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCouponGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEmployeeCouponGrant_employeeId_couponId_key"
ON "CommerceEmployeeCouponGrant"("employeeId", "couponId");

-- CreateIndex
CREATE INDEX "CommerceEmployeeCouponGrant_couponId_idx"
ON "CommerceEmployeeCouponGrant"("couponId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCouponGift_tokenHash_key"
ON "CommerceCouponGift"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCouponGift_code_key"
ON "CommerceCouponGift"("code");

-- CreateIndex
CREATE INDEX "CommerceCouponGift_employeeId_couponId_status_idx"
ON "CommerceCouponGift"("employeeId", "couponId", "status");

-- CreateIndex
CREATE INDEX "CommerceCouponGift_status_expiresAt_idx"
ON "CommerceCouponGift"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCouponClaim_sourceGiftId_key"
ON "CommerceCouponClaim"("sourceGiftId");

-- AddForeignKey
ALTER TABLE "CommerceEmployeeCouponGrant"
ADD CONSTRAINT "CommerceEmployeeCouponGrant_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEmployeeCouponGrant"
ADD CONSTRAINT "CommerceEmployeeCouponGrant_couponId_fkey"
FOREIGN KEY ("couponId") REFERENCES "CommerceCoupon"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponGift"
ADD CONSTRAINT "CommerceCouponGift_couponId_fkey"
FOREIGN KEY ("couponId") REFERENCES "CommerceCoupon"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponGift"
ADD CONSTRAINT "CommerceCouponGift_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponGift"
ADD CONSTRAINT "CommerceCouponGift_grantId_fkey"
FOREIGN KEY ("grantId") REFERENCES "CommerceEmployeeCouponGrant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponGift"
ADD CONSTRAINT "CommerceCouponGift_redeemedByUserId_fkey"
FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponClaim"
ADD CONSTRAINT "CommerceCouponClaim_sourceGiftId_fkey"
FOREIGN KEY ("sourceGiftId") REFERENCES "CommerceCouponGift"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSecret"
ADD CONSTRAINT "IntegrationSecret_integrationKey_fkey"
FOREIGN KEY ("integrationKey") REFERENCES "IntegrationConfig"("key")
ON DELETE CASCADE ON UPDATE CASCADE;
