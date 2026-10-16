-- Additive, nullable display overrides. Existing prices and SKU/ERP bindings stay intact.
ALTER TABLE "PartnerSkuPrice"
  ADD COLUMN "productName" TEXT,
  ADD COLUMN "specification" TEXT,
  ADD COLUMN "retailPriceCents" INTEGER;
ALTER TABLE "PartnerSkuPrice" ADD CONSTRAINT "PartnerSkuPrice_retailPriceCents_check"
  CHECK ("retailPriceCents" IS NULL OR "retailPriceCents" BETWEEN 0 AND 2147483647);
