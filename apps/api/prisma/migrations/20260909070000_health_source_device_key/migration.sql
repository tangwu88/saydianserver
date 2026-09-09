-- Keep historical unknown device identity null; never infer or backfill a device.
ALTER TABLE "HealthRecord" ADD COLUMN "sourceDeviceKey" TEXT;
