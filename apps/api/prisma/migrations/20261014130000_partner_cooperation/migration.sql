BEGIN;
-- Preserve tier IDs, codes, prices, accounts and historic order snapshots.
UPDATE "PartnerLevel" SET "name" = CASE "code"
  WHEN 'distribution-1' THEN '战略合作'
  WHEN 'distribution-2' THEN '核心合作'
  WHEN 'distribution-3' THEN '优选合作' END, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN ('distribution-1', 'distribution-2', 'distribution-3');
ALTER TABLE "CommerceOrder" ADD COLUMN "erpProcessLogJson" JSONB;
ALTER TABLE "CommerceOrder" ADD COLUMN "erpProcessLogSyncedAt" TIMESTAMP(3);
COMMIT;
