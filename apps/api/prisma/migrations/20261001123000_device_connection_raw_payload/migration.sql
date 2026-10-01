ALTER TABLE "DeviceConnectionEvent"
  ADD COLUMN "rawPayload" TEXT NOT NULL DEFAULT '';

ALTER TABLE "DeviceConnectionEvent"
  ALTER COLUMN "rawPayload" DROP DEFAULT;
