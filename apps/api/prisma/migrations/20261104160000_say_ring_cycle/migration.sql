-- Additive migration only. No historical value/source backfill, DELETE, DROP or device writes.
ALTER TABLE "HealthRecord" ADD COLUMN "sourceMetadata" JSONB;
CREATE TABLE "CycleState" ("userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,"sequence" INTEGER NOT NULL DEFAULT 0,"epoch" INTEGER NOT NULL DEFAULT 0,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "CycleRecord" ("userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"clientId" VARCHAR(80) NOT NULL,"kind" VARCHAR(16) NOT NULL,"data" JSONB NOT NULL,"revision" INTEGER NOT NULL DEFAULT 1,"deleted" BOOLEAN NOT NULL DEFAULT false,"changeSeq" INTEGER NOT NULL,"updatedAt" TIMESTAMP(3) NOT NULL,PRIMARY KEY("userId","clientId"));
CREATE INDEX "CycleRecord_userId_changeSeq_idx" ON "CycleRecord"("userId","changeSeq");
CREATE TABLE "CycleMutation" ("userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"mutationId" VARCHAR(80) NOT NULL,"inputHash" VARCHAR(64) NOT NULL,"result" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY("userId","mutationId"));
CREATE TABLE "CycleArtifact" ("id" UUID PRIMARY KEY,"userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,"kind" VARCHAR(24) NOT NULL,"inputHash" VARCHAR(64) NOT NULL,"payload" JSONB NOT NULL,"sourceSequence" INTEGER NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "CycleArtifact_userId_kind_inputHash_key" ON "CycleArtifact"("userId","kind","inputHash");
