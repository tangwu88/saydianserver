-- Additive only. Historical allocations deliberately remain NULL until verified.
ALTER TABLE "User" ADD COLUMN "mobileVerifiedAt" TIMESTAMP(3);
CREATE TABLE "WechatOfficialIdentity" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "appId" TEXT NOT NULL,
  "openId" TEXT NOT NULL, "unionId" TEXT, "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WechatOfficialIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WechatOfficialIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WechatOfficialIdentity_appId_openId_key" ON "WechatOfficialIdentity"("appId","openId");
CREATE UNIQUE INDEX "WechatOfficialIdentity_userId_appId_key" ON "WechatOfficialIdentity"("userId","appId");
CREATE TABLE "CommerceOAuthState" (
  "stateHash" TEXT NOT NULL, "codeChallenge" TEXT NOT NULL, "appId" TEXT NOT NULL,
  "returnTo" TEXT NOT NULL, "referralCode" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceOAuthState_pkey" PRIMARY KEY ("stateHash")
);
CREATE INDEX "CommerceOAuthState_expiresAt_idx" ON "CommerceOAuthState"("expiresAt");
CREATE TABLE "CommerceWechatBindTicket" (
  "tokenHash" TEXT NOT NULL, "appId" TEXT NOT NULL, "openId" TEXT NOT NULL, "unionId" TEXT,
  "returnTo" TEXT NOT NULL, "referralCode" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceWechatBindTicket_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "CommerceWechatBindTicket_expiresAt_idx" ON "CommerceWechatBindTicket"("expiresAt");
ALTER TABLE "CommerceOrder" ADD COLUMN "pricingVersion" INTEGER, ADD COLUMN "pricingVerifiedAt" TIMESTAMP(3), ADD COLUMN "requestHash" TEXT;
ALTER TABLE "CommerceOrderItem" ADD COLUMN "couponDiscountCentsSnapshot" INTEGER, ADD COLUMN "pointDiscountCentsSnapshot" INTEGER, ADD COLUMN "cashPaidCentsSnapshot" INTEGER;
ALTER TABLE "CommerceAfterSale" ADD COLUMN "pricingVersion" INTEGER, ADD COLUMN "pointReturnCents" INTEGER, ADD COLUMN "shippingRefundCents" INTEGER, ADD COLUMN "settledAt" TIMESTAMP(3);
ALTER TABLE "CommerceAfterSaleItem" ADD COLUMN "pointReturnCents" INTEGER;
ALTER TABLE "PaymentRefund" ADD COLUMN "merchandiseRefundCents" INTEGER, ADD COLUMN "shippingRefundCents" INTEGER;
ALTER TABLE "CommercePointLedger" ADD COLUMN "afterSaleId" UUID, ADD COLUMN "refundId" UUID;
