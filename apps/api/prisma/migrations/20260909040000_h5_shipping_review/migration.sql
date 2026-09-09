ALTER TYPE "AfterSaleType" ADD VALUE 'SHIPPING_ONLY';
ALTER TABLE "CommerceAfterSale"
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestedByAdminId" UUID,
  ADD COLUMN "reviewedByAdminId" UUID,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "CommerceAfterSale_requestKey_key" ON "CommerceAfterSale"("requestKey");
