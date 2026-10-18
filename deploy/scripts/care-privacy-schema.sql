-- care-privacy-schema: presence, not current row count, sets the rollback floor.
WITH state AS (
  SELECT
    EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261018070000_care_identity_disclosure') AS seen_migration,
    EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261018070000_care_identity_disclosure'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
      AND checksum = 'e089194340cb328121788dfd9b308ca72dbd87c96c5d0c82dfd9a299cfb0c2ab') AS completed,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public."CareRelationship"')
      AND attname = 'identityDisclosure' AND NOT attisdropped) AS seen_column,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public."CareRelationship"')
      AND attname = 'identityDisclosure' AND NOT attisdropped AND attnotnull
      AND atttypid = to_regtype('public."CareIdentityDisclosure"')) AS valid_column,
    to_regtype('public."CareIdentityDisclosure"') IS NOT NULL AS seen_type,
    ARRAY(SELECT enumlabel::text FROM pg_enum WHERE enumtypid = to_regtype('public."CareIdentityDisclosure"') ORDER BY enumsortorder)
      = ARRAY['CONTACT', 'MEMBER_NO_PENDING', 'MEMBER_NO_ACCEPTED'] AS valid_type
)
SELECT CASE
  WHEN NOT seen_migration AND NOT seen_column AND NOT seen_type THEN 'legacy'
  WHEN completed AND valid_column AND valid_type THEN 'protected'
  ELSE 'unknown'
END AS schema_state FROM state;
