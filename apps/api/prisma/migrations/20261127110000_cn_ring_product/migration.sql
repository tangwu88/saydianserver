-- Additive provenance only. Existing records retain the original Say Ring scope.
-- No data rewrite, identifier change, deletion or source-table replacement.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "RingShare" ADD COLUMN "product" TEXT NOT NULL DEFAULT 'say-ring';
ALTER TABLE "RingCareInvite" ADD COLUMN "product" TEXT NOT NULL DEFAULT 'say-ring';
ALTER TABLE "RingCareMessage" ADD COLUMN "product" TEXT NOT NULL DEFAULT 'say-ring';
ALTER TABLE "RingShare" ADD CONSTRAINT "RingShare_product_check"
  CHECK ("product" IN ('say-ring', 'saydian-app-cn'));
ALTER TABLE "RingCareInvite" ADD CONSTRAINT "RingCareInvite_product_check"
  CHECK ("product" IN ('say-ring', 'saydian-app-cn'));
ALTER TABLE "RingCareMessage" ADD CONSTRAINT "RingCareMessage_product_check"
  CHECK ("product" IN ('say-ring', 'saydian-app-cn'));
CREATE INDEX "RingShare_product_ownerId_createdAt_idx" ON "RingShare"("product", "ownerId", "createdAt");
CREATE INDEX "RingCareInvite_product_inviterId_expiresAt_idx" ON "RingCareInvite"("product", "inviterId", "expiresAt");
CREATE INDEX "RingCareMessage_product_relationshipId_createdAt_idx" ON "RingCareMessage"("product", "relationshipId", "createdAt");
COMMIT;
