-- Isolate reference-only vocabulary from the existing wearable HealthMetric contract.
-- Preserve all existing reference values. No changes to HealthRecord or device ingestion.
CREATE TYPE "HealthReferenceMetric" AS ENUM ('BLOOD_GLUCOSE', 'BLOOD_PRESSURE', 'HEART_RATE', 'BLOOD_OXYGEN', 'TEMPERATURE', 'URIC_ACID', 'BLOOD_LIPIDS');
ALTER TABLE "MemberHealthReference" ALTER COLUMN "metric" TYPE "HealthReferenceMetric" USING "metric"::text::"HealthReferenceMetric";
