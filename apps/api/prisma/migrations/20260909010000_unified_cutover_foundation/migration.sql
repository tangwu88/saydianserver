-- Additive cutover foundations. Existing imported transactions are locked until
-- an independently verified ownership handover; this migration never enables writes.
ALTER TABLE "LegacyIdMap" ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'legacy_app',
  ADD COLUMN "sourceHash" TEXT, ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3), ADD COLUMN "sourceDeletedAt" TIMESTAMP(3);
UPDATE "LegacyIdMap" SET "sourceSystem" = 'legacy_mall' WHERE "entityType" LIKE 'mall\_%' ESCAPE '\';
DROP INDEX "LegacyIdMap_entityType_legacyId_key";
CREATE UNIQUE INDEX "LegacyIdMap_sourceSystem_entityType_legacyId_key" ON "LegacyIdMap"("sourceSystem", "entityType", "legacyId");

CREATE TABLE "LegacySessionCredential" (
  "id" UUID NOT NULL, "sourceSystem" TEXT NOT NULL, "tokenDigest" TEXT NOT NULL,
  "userId" UUID NOT NULL, "sourceSessionId" TEXT NOT NULL, "sourceVerifiedAt" TIMESTAMP(3) NOT NULL,
  "verificationEvidence" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "sessionId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacySessionCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacySessionCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LegacySessionCredential_sourceSystem_tokenDigest_key" ON "LegacySessionCredential"("sourceSystem", "tokenDigest");
CREATE UNIQUE INDEX "LegacySessionCredential_sessionId_key" ON "LegacySessionCredential"("sessionId");
CREATE INDEX "LegacySessionCredential_userId_expiresAt_idx" ON "LegacySessionCredential"("userId", "expiresAt");

CREATE TABLE "MigrationCheckpoint" (
  "id" UUID NOT NULL, "runId" UUID NOT NULL, "sourceSystem" TEXT NOT NULL, "sourceTable" TEXT NOT NULL,
  "cursor" TEXT NOT NULL, "rowCount" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MigrationCheckpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MigrationCheckpoint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MigrationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MigrationCheckpoint_runId_sourceTable_key" ON "MigrationCheckpoint"("runId", "sourceTable");

ALTER TABLE "CommerceOrder" ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'canonical',
  ADD COLUMN "executionOwner" TEXT NOT NULL DEFAULT 'NEW_SYSTEM', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pointDiscountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CommerceAfterSale" ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'canonical',
  ADD COLUMN "executionOwner" TEXT NOT NULL DEFAULT 'NEW_SYSTEM', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PaymentIntent" ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'canonical',
  ADD COLUMN "executionOwner" TEXT NOT NULL DEFAULT 'NEW_SYSTEM', ADD COLUMN "providerMerchantId" TEXT, ADD COLUMN "providerAppId" TEXT;
ALTER TABLE "PaymentRefund" ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'canonical',
  ADD COLUMN "executionOwner" TEXT NOT NULL DEFAULT 'NEW_SYSTEM';
UPDATE "CommerceOrder" SET "sourceSystem" = 'legacy_mall', "executionOwner" = 'LEGACY_SYSTEM' WHERE "legacyId" IS NOT NULL;
UPDATE "CommerceAfterSale" SET "sourceSystem" = 'legacy_mall', "executionOwner" = 'LEGACY_SYSTEM' WHERE "legacyId" IS NOT NULL;
UPDATE "PaymentIntent" SET "sourceSystem" = 'legacy_mall', "executionOwner" = 'LEGACY_SYSTEM' WHERE "idempotencyKey" LIKE 'mall-payment:%';
UPDATE "PaymentRefund" SET "sourceSystem" = 'legacy_mall', "executionOwner" = 'LEGACY_SYSTEM' WHERE "idempotencyKey" LIKE 'mall-refund:%';

ALTER TABLE "ProviderEvent" ADD COLUMN "sourceSystem" TEXT NOT NULL DEFAULT 'canonical',
  ADD COLUMN "verifiedAt" TIMESTAMP(3), ADD COLUMN "processingState" TEXT NOT NULL DEFAULT 'RECEIVED';
UPDATE "ProviderEvent" SET "processingState" = 'PROCESSED' WHERE "processedAt" IS NOT NULL;
ALTER TABLE "CommerceCommissionAccrual" ADD COLUMN "settlementDaysSnapshot" INTEGER;

CREATE TABLE "CommerceAfterSaleItem" (
  "id" UUID NOT NULL, "afterSaleId" UUID NOT NULL, "orderItemId" UUID NOT NULL, "quantity" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  CONSTRAINT "CommerceAfterSaleItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceAfterSaleItem_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "CommerceAfterSale"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommerceAfterSaleItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "CommerceOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommerceAfterSaleItem_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "CommerceAfterSaleItem_amountCents_check" CHECK ("amountCents" >= 0)
);
CREATE UNIQUE INDEX "CommerceAfterSaleItem_afterSaleId_orderItemId_key" ON "CommerceAfterSaleItem"("afterSaleId", "orderItemId");
CREATE TABLE "CommercePointAccount" (
  "userId" UUID NOT NULL, "balanceCents" INTEGER NOT NULL DEFAULT 0, "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercePointAccount_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "CommercePointAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommercePointAccount_balanceCents_check" CHECK ("balanceCents" >= 0)
);
CREATE TABLE "CommercePointLedger" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "orderId" UUID, "deltaCents" INTEGER NOT NULL,
  "type" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercePointLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercePointLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommercePointLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommercePointLedger_idempotencyKey_key" ON "CommercePointLedger"("idempotencyKey");
CREATE INDEX "CommercePointLedger_userId_createdAt_idx" ON "CommercePointLedger"("userId", "createdAt");

CREATE TABLE "CommerceEmployeePayoutIdentity" (
  "employeeId" UUID NOT NULL, "openId" TEXT NOT NULL, "authorizationId" TEXT, "outAuthorizationNo" TEXT,
  "authorizationStatus" TEXT NOT NULL DEFAULT 'NONE', "authorizedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3), "verificationEvidence" TEXT,
  CONSTRAINT "CommerceEmployeePayoutIdentity_pkey" PRIMARY KEY ("employeeId"),
  CONSTRAINT "CommerceEmployeePayoutIdentity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommerceEmployeePayoutIdentity_openId_key" ON "CommerceEmployeePayoutIdentity"("openId");
CREATE TABLE "CommerceWithdrawal" (
  "id" UUID NOT NULL, "legacyId" TEXT, "withdrawalNo" TEXT NOT NULL, "sourceSystem" TEXT NOT NULL DEFAULT 'canonical',
  "executionOwner" TEXT NOT NULL DEFAULT 'NEW_SYSTEM', "employeeId" UUID NOT NULL, "amountCents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED', "providerTransferId" TEXT, "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 0, "payoutIdentitySnapshot" JSONB,
  "providerPayload" JSONB, "failureReason" TEXT, "packageInfo" TEXT,
  "verificationEvidence" TEXT, "reviewedById" UUID, "reviewNote" TEXT, "receiptReference" TEXT,
  "reviewedAt" TIMESTAMP(3), "paidAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommerceWithdrawal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceWithdrawal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommerceWithdrawal_amountCents_check" CHECK ("amountCents" > 0)
);
CREATE UNIQUE INDEX "CommerceWithdrawal_legacyId_key" ON "CommerceWithdrawal"("legacyId");
CREATE UNIQUE INDEX "CommerceWithdrawal_withdrawalNo_key" ON "CommerceWithdrawal"("withdrawalNo");
CREATE UNIQUE INDEX "CommerceWithdrawal_providerTransferId_key" ON "CommerceWithdrawal"("providerTransferId");
CREATE UNIQUE INDEX "CommerceWithdrawal_idempotencyKey_key" ON "CommerceWithdrawal"("idempotencyKey");
CREATE INDEX "CommerceWithdrawal_employeeId_status_createdAt_idx" ON "CommerceWithdrawal"("employeeId", "status", "createdAt");
ALTER TABLE "CommerceCommissionLedger" ADD COLUMN "withdrawingDeltaCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paidDeltaCents" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "withdrawalId" UUID;
ALTER TABLE "CommerceCommissionLedger" ADD CONSTRAINT "CommerceCommissionLedger_withdrawalId_fkey"
  FOREIGN KEY ("withdrawalId") REFERENCES "CommerceWithdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
