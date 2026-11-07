-- AlterTable
ALTER TABLE "ReportCreditLedger" ADD COLUMN     "memberHealthAnalysisId" UUID;

-- CreateTable
CREATE TABLE "MemberHealthAnalysis" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "consentBypass" BOOLEAN NOT NULL DEFAULT false,
    "consentSnapshot" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "period" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "evidenceIndex" JSONB NOT NULL,
    "scoreSnapshot" JSONB NOT NULL,
    "ruleVersion" INTEGER,
    "templateVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "content" JSONB,
    "aiModel" TEXT,
    "generationAttempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberHealthAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthScoreRuleVersion" (
    "id" UUID NOT NULL,
    "version" SERIAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rules" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "publishedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "HealthScoreRuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberHealthAnalysis_requestKey_key" ON "MemberHealthAnalysis"("requestKey");

-- CreateIndex
CREATE INDEX "MemberHealthAnalysis_userId_windowDays_createdAt_idx" ON "MemberHealthAnalysis"("userId", "windowDays", "createdAt");

-- CreateIndex
CREATE INDEX "MemberHealthAnalysis_userId_inputDigest_status_idx" ON "MemberHealthAnalysis"("userId", "inputDigest", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HealthScoreRuleVersion_version_key" ON "HealthScoreRuleVersion"("version");

-- CreateIndex
CREATE INDEX "HealthScoreRuleVersion_status_version_idx" ON "HealthScoreRuleVersion"("status", "version");

-- AddForeignKey
ALTER TABLE "ReportCreditLedger" ADD CONSTRAINT "ReportCreditLedger_memberHealthAnalysisId_fkey" FOREIGN KEY ("memberHealthAnalysisId") REFERENCES "MemberHealthAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberHealthAnalysis" ADD CONSTRAINT "MemberHealthAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
