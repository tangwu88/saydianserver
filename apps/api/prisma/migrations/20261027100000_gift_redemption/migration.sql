
-- AlterTable
ALTER TABLE "CommerceOrder" ADD COLUMN     "giftCardSerial" TEXT,
ADD COLUMN     "giftDiscountCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CommerceOrderItem" ADD COLUMN     "giftDiscountCentsSnapshot" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CommerceGiftBatch" (
    "id" UUID NOT NULL,
    "batchNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "activatedById" UUID,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceGiftBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceGiftCard" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "serialNo" TEXT NOT NULL,
    "cardNo" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "productId" UUID NOT NULL,
    "allowedSkuIds" UUID[],
    "expiresAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceGiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceGiftSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "cardId" UUID NOT NULL,
    "userId" UUID,
    "userSessionId" UUID,
    "mobile" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceGiftSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceGiftRedemption" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "memberNoSnapshot" INTEGER NOT NULL,
    "verifiedMobile" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientIp" TEXT,
    "requestId" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "productSnapshot" JSONB NOT NULL,
    "addressSnapshot" JSONB NOT NULL,

    CONSTRAINT "CommerceGiftRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceGiftThrottle" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceGiftThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CommerceGiftProductCode" (
    "productId" UUID NOT NULL,
    "code" INTEGER NOT NULL,
    "lastSerial" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommerceGiftProductCode_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftBatch_batchNo_key" ON "CommerceGiftBatch"("batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftBatch_requestKey_key" ON "CommerceGiftBatch"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftCard_serialNo_key" ON "CommerceGiftCard"("serialNo");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftCard_cardNo_key" ON "CommerceGiftCard"("cardNo");

-- CreateIndex
CREATE INDEX "CommerceGiftCard_batchId_status_idx" ON "CommerceGiftCard"("batchId", "status");

-- CreateIndex
CREATE INDEX "CommerceGiftCard_status_expiresAt_idx" ON "CommerceGiftCard"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftSession_tokenHash_key" ON "CommerceGiftSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CommerceGiftSession_expiresAt_idx" ON "CommerceGiftSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftRedemption_cardId_key" ON "CommerceGiftRedemption"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftRedemption_orderId_key" ON "CommerceGiftRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftRedemption_requestKey_key" ON "CommerceGiftRedemption"("requestKey");

-- CreateIndex
CREATE INDEX "CommerceGiftRedemption_userId_redeemedAt_idx" ON "CommerceGiftRedemption"("userId", "redeemedAt");

-- CreateIndex
CREATE INDEX "CommerceGiftRedemption_verifiedMobile_redeemedAt_idx" ON "CommerceGiftRedemption"("verifiedMobile", "redeemedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceGiftProductCode_code_key" ON "CommerceGiftProductCode"("code");

-- AddForeignKey
ALTER TABLE "CommerceGiftCard" ADD CONSTRAINT "CommerceGiftCard_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "CommerceGiftBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftCard" ADD CONSTRAINT "CommerceGiftCard_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftSession" ADD CONSTRAINT "CommerceGiftSession_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CommerceGiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftSession" ADD CONSTRAINT "CommerceGiftSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftSession" ADD CONSTRAINT "CommerceGiftSession_userSessionId_fkey" FOREIGN KEY ("userSessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftRedemption" ADD CONSTRAINT "CommerceGiftRedemption_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CommerceGiftCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftRedemption" ADD CONSTRAINT "CommerceGiftRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftRedemption" ADD CONSTRAINT "CommerceGiftRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceGiftProductCode" ADD CONSTRAINT "CommerceGiftProductCode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only new gift rows use these invariants. Existing mall orders remain valid.
ALTER TABLE "CommerceGiftCard" ADD CONSTRAINT "gift_card_status_check" CHECK (status IN ('DRAFT','ACTIVE','REDEEMED','VOID')),
  ADD CONSTRAINT "gift_card_skus_check" CHECK (cardinality("allowedSkuIds") BETWEEN 1 AND 200);
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "gift_order_amount_check" CHECK (
  ("giftCardSerial" IS NULL AND "giftDiscountCents" = 0) OR
  ("giftCardSerial" IS NOT NULL AND "userId" IS NOT NULL AND "partnerId" IS NULL AND "giftDiscountCents" = "subtotalCents" AND "giftDiscountCents" >= 0 AND "discountCents" = 0 AND "pointDiscountCents" = 0 AND "shippingCents" = 0 AND "payableCents" = 0)
);
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "gift_payment_amount_check" CHECK ("channel" <> 'GIFT_REDEMPTION' OR ("businessType" = 'COMMERCE_ORDER' AND "commerceOrderId" IS NOT NULL AND "userId" IS NOT NULL AND "partnerId" IS NULL AND "amountCents" = 0 AND "currency" = 'CNY'));
ALTER TABLE "CommerceGiftThrottle" ADD CONSTRAINT "gift_throttle_count_check" CHECK (count > 0);

ALTER TABLE "CommerceGiftProductCode" ADD CONSTRAINT "gift_product_code_range" CHECK (code BETWEEN 1 AND 99 AND "lastSerial" BETWEEN 0 AND 99999);
ALTER TABLE "CommerceGiftCard" ADD CONSTRAINT "gift_card_number_format" CHECK ("cardNo" ~ '^8[0-9]{7}$');
