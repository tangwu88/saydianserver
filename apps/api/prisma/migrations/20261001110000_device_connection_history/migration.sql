ALTER TABLE "DeviceBinding"
  ADD COLUMN "macAddress" VARCHAR(17);

ALTER TABLE "DeviceBinding"
  ADD CONSTRAINT "DeviceBinding_mac_address_check" CHECK (
    "macAddress" IS NULL OR "macAddress" ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'
  );

CREATE TABLE "DeviceConnectionEvent" (
  "id" UUID NOT NULL,
  "deviceBindingId" UUID NOT NULL,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vendor" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "macAddress" VARCHAR(17),
  "firmware" TEXT,
  CONSTRAINT "DeviceConnectionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceConnectionEvent_mac_address_check" CHECK (
    "macAddress" IS NULL OR "macAddress" ~ '^([0-9A-F]{2}:){5}[0-9A-F]{2}$'
  ),
  CONSTRAINT "DeviceConnectionEvent_deviceBindingId_fkey"
    FOREIGN KEY ("deviceBindingId") REFERENCES "DeviceBinding"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DeviceConnectionEvent_deviceBindingId_connectedAt_idx"
  ON "DeviceConnectionEvent"("deviceBindingId", "connectedAt");
