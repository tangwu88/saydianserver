-- CreateTable
CREATE TABLE "RingShare" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingShareReaction" (
    "shareId" UUID NOT NULL,
    "visitor" TEXT NOT NULL,
    "memberId" UUID,
    "name" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RingShareReaction_pkey" PRIMARY KEY ("shareId","visitor")
);

-- CreateTable
CREATE TABLE "RingCareInvite" (
    "id" UUID NOT NULL,
    "inviterId" UUID NOT NULL,
    "acceptedBy" UUID,
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RingCareInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingCareSetting" (
    "relationshipId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RingCareSetting_pkey" PRIMARY KEY ("relationshipId","userId")
);

-- CreateTable
CREATE TABLE "RingCareMessage" (
    "id" UUID NOT NULL,
    "relationshipId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "keepQuiet" BOOLEAN NOT NULL DEFAULT false,
    "attachment" JSONB,
    "audio" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),

    CONSTRAINT "RingCareMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingCareGoal" (
    "relationshipId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "week" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "days" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "RingCareGoal_pkey" PRIMARY KEY ("relationshipId","userId","week")
);

-- CreateTable
CREATE TABLE "RingFirmwareRelease" (
    "id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "hardware" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "minBuild" INTEGER NOT NULL,
    "minBattery" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "package" BYTEA NOT NULL,
    "evidence" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RingFirmwareRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RingShare_digest_key" ON "RingShare"("digest");

-- CreateIndex
CREATE INDEX "RingShare_ownerId_createdAt_idx" ON "RingShare"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "RingShare_expiresAt_idx" ON "RingShare"("expiresAt");

-- CreateIndex
CREATE INDEX "RingShareReaction_memberId_idx" ON "RingShareReaction"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "RingCareInvite_digest_key" ON "RingCareInvite"("digest");

-- CreateIndex
CREATE INDEX "RingCareInvite_inviterId_expiresAt_idx" ON "RingCareInvite"("inviterId", "expiresAt");

-- CreateIndex
CREATE INDEX "RingCareSetting_userId_idx" ON "RingCareSetting"("userId");

-- CreateIndex
CREATE INDEX "RingCareMessage_relationshipId_createdAt_idx" ON "RingCareMessage"("relationshipId", "createdAt");

-- CreateIndex
CREATE INDEX "RingCareMessage_authorId_idx" ON "RingCareMessage"("authorId");

-- CreateIndex
CREATE INDEX "RingCareMessage_reportedAt_idx" ON "RingCareMessage"("reportedAt");

-- CreateIndex
CREATE INDEX "RingCareGoal_userId_idx" ON "RingCareGoal"("userId");

-- CreateIndex
CREATE INDEX "RingFirmwareRelease_platform_transport_model_hardware_fromV_idx" ON "RingFirmwareRelease"("platform", "transport", "model", "hardware", "fromVersion", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "RingFirmwareRelease_platform_transport_model_hardware_fromV_key" ON "RingFirmwareRelease"("platform", "transport", "model", "hardware", "fromVersion", "version");

-- AddForeignKey
ALTER TABLE "RingShare" ADD CONSTRAINT "RingShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingShareReaction" ADD CONSTRAINT "RingShareReaction_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "RingShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingShareReaction" ADD CONSTRAINT "RingShareReaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareInvite" ADD CONSTRAINT "RingCareInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareInvite" ADD CONSTRAINT "RingCareInvite_acceptedBy_fkey" FOREIGN KEY ("acceptedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareSetting" ADD CONSTRAINT "RingCareSetting_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "CareRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareSetting" ADD CONSTRAINT "RingCareSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareMessage" ADD CONSTRAINT "RingCareMessage_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "CareRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareMessage" ADD CONSTRAINT "RingCareMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareGoal" ADD CONSTRAINT "RingCareGoal_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "CareRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingCareGoal" ADD CONSTRAINT "RingCareGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
