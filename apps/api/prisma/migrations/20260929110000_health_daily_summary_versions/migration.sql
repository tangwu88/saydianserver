ALTER TABLE "HealthRecord"
  ADD COLUMN "aggregationKind" VARCHAR(32),
  ADD COLUMN "aggregationLocalDate" VARCHAR(10),
  ADD COLUMN "aggregationActive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "HealthRecord"
  ADD CONSTRAINT "HealthRecord_daily_summary_shape_check" CHECK (
    (
      "aggregationKind" IS NULL
      AND "aggregationLocalDate" IS NULL
      AND "aggregationActive" = false
    )
    OR
    (
      "aggregationKind" = 'daily_summary'
      AND "aggregationLocalDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND to_char(to_date("aggregationLocalDate", 'YYYY-MM-DD'), 'YYYY-MM-DD') = "aggregationLocalDate"
      AND "sourceDeviceKey" IS NOT NULL
    )
  );

CREATE INDEX "HealthRecord_userId_aggregationKind_aggregationActive_aggregationLocalDate_idx"
  ON "HealthRecord"("userId", "aggregationKind", "aggregationActive", "aggregationLocalDate");

CREATE UNIQUE INDEX "HealthRecord_one_active_daily_summary_per_fold_key"
  ON "HealthRecord"(
    "userId",
    "metric",
    "sourceDeviceKey",
    "aggregationKind",
    "aggregationLocalDate"
  )
  WHERE "aggregationKind" = 'daily_summary' AND "aggregationActive" = true;
