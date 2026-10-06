ALTER TABLE "Article"
ADD COLUMN "product" TEXT NOT NULL DEFAULT 'shared';

ALTER TABLE "Article"
ADD CONSTRAINT "Article_product_check"
CHECK ("product" IN ('shared', 'saidian', 'saydian-global', 'say-ring'));

CREATE INDEX "Article_product_status_publishedAt_idx"
ON "Article"("product", "status", "publishedAt");
