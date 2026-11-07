CREATE TABLE "MemberHealthReference" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "metric" "HealthMetric" NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "unit" TEXT NOT NULL,
  "values" JSONB NOT NULL,
  "method" TEXT NOT NULL,
  "context" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" UUID NOT NULL,
  "requestKey" TEXT NOT NULL,
  "inputDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" UUID,
  "voidReason" TEXT,
  CONSTRAINT "MemberHealthReference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MemberHealthReference_requestKey_key" ON "MemberHealthReference"("requestKey");
CREATE INDEX "MemberHealthReference_userId_observedAt_idx" ON "MemberHealthReference"("userId", "observedAt");
CREATE INDEX "MemberHealthReference_userId_updatedAt_idx" ON "MemberHealthReference"("userId", "updatedAt");
ALTER TABLE "MemberHealthReference" ADD CONSTRAINT "MemberHealthReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
