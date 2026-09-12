ALTER TABLE "PaymentIntent"
ADD COLUMN "integrationKey" TEXT;

CREATE INDEX "PaymentIntent_integrationKey_status_idx"
ON "PaymentIntent"("integrationKey", "status");
