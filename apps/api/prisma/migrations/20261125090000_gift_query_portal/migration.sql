-- Additive only: no changes to existing gift cards, redemptions, orders or identities.
CREATE TABLE "GiftQueryAccount" (
  "id" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftQueryAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftQueryAccount_username_key" ON "GiftQueryAccount"("username");
CREATE TABLE "GiftQuerySession" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftQuerySession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GiftQuerySession_tokenHash_key" ON "GiftQuerySession"("tokenHash");
CREATE INDEX "GiftQuerySession_accountId_expiresAt_idx" ON "GiftQuerySession"("accountId", "expiresAt");
CREATE INDEX "GiftQuerySession_expiresAt_idx" ON "GiftQuerySession"("expiresAt");
CREATE TABLE "GiftQueryLog" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "cardCount" INTEGER NOT NULL,
  "redeemedCount" INTEGER NOT NULL,
  "missingCount" INTEGER NOT NULL,
  "results" JSONB NOT NULL,
  "requestId" TEXT,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftQueryLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GiftQueryLog_accountId_createdAt_idx" ON "GiftQueryLog"("accountId", "createdAt");
CREATE INDEX "GiftQueryLog_createdAt_idx" ON "GiftQueryLog"("createdAt");
ALTER TABLE "GiftQuerySession" ADD CONSTRAINT "GiftQuerySession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GiftQueryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GiftQueryLog" ADD CONSTRAINT "GiftQueryLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GiftQueryAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
