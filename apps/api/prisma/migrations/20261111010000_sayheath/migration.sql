-- CreateTable
CREATE TABLE "SayHeathSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "release" TEXT NOT NULL,
    "legalVersion" TEXT NOT NULL,

    CONSTRAINT "SayHeathSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SayHeathSwitch" (
    "release" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" UUID NOT NULL,

    CONSTRAINT "SayHeathSwitch_pkey" PRIMARY KEY ("release","feature")
);

-- CreateTable
CREATE TABLE "SayHeathGrant" (
    "userId" UUID NOT NULL,
    "release" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "revision" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SayHeathGrant_pkey" PRIMARY KEY ("userId","release","feature")
);

-- CreateTable
CREATE TABLE "SayHeathCapture" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "release" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "deviceKey" TEXT NOT NULL,
    "grantId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observedAt" TIMESTAMP(3),
    "values" JSONB,
    "unit" TEXT,

    CONSTRAINT "SayHeathCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SayHeathFamily" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "activity" BOOLEAN NOT NULL DEFAULT false,
    "sleep" BOOLEAN NOT NULL DEFAULT false,
    "acceptedActivity" BOOLEAN NOT NULL DEFAULT false,
    "acceptedSleep" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SayHeathFamily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SayHeathSession_tokenHash_key" ON "SayHeathSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SayHeathSession_userId_idx" ON "SayHeathSession"("userId");

-- CreateIndex
CREATE INDEX "SayHeathCapture_userId_feature_observedAt_idx" ON "SayHeathCapture"("userId", "feature", "observedAt");

-- CreateIndex
CREATE INDEX "SayHeathFamily_viewerId_idx" ON "SayHeathFamily"("viewerId");

-- CreateIndex
CREATE UNIQUE INDEX "SayHeathFamily_ownerId_viewerId_key" ON "SayHeathFamily"("ownerId", "viewerId");

-- AddForeignKey
ALTER TABLE "SayHeathSession" ADD CONSTRAINT "SayHeathSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SayHeathGrant" ADD CONSTRAINT "SayHeathGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SayHeathCapture" ADD CONSTRAINT "SayHeathCapture_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SayHeathFamily" ADD CONSTRAINT "SayHeathFamily_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SayHeathFamily" ADD CONSTRAINT "SayHeathFamily_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
