-- Preserve capture metadata without rewriting historical/unknown origins.
ALTER TABLE "HealthRecord"
  ADD COLUMN "sourceOrigin" TEXT,
  ADD COLUMN "sourceMeasurementSource" TEXT,
  ADD COLUMN "sourceRawVersion" INTEGER;
