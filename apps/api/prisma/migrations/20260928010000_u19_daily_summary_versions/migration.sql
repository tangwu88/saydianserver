ALTER TABLE "HealthRecord"
  ADD COLUMN "aggregationKind" TEXT,
  ADD COLUMN "aggregationLocalDate" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE INDEX "HealthRecord_daily_version_idx"
  ON "HealthRecord"("userId", "sourceDeviceKey", "metric", "aggregationLocalDate", "observedAt");

CREATE INDEX "HealthRecord_effective_daily_idx"
  ON "HealthRecord"("userId", "aggregationKind", "supersededAt", "observedAt");
