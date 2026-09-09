-- Existing parcel rows remain unmapped; never infer historical per-item quantities.
CREATE TABLE "CommerceShipmentItem" (
  "id" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "orderItemId" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "CommerceShipmentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceShipmentItem_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "CommerceShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "CommerceShipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommerceShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "CommerceOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommerceShipmentItem_shipmentId_orderItemId_key" ON "CommerceShipmentItem"("shipmentId","orderItemId");
CREATE INDEX "CommerceShipmentItem_orderItemId_idx" ON "CommerceShipmentItem"("orderItemId");
