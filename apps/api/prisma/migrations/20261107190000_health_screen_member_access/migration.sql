ALTER TABLE "HealthProfile" ADD COLUMN "screenName" VARCHAR(40);

CREATE TABLE "HealthScreenLogin" (
  "scanHash" TEXT NOT NULL PRIMARY KEY,
  "pollHash" TEXT NOT NULL UNIQUE,
  "viewHash" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "sessionId" UUID REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "HealthScreenLogin_expiresAt_idx" ON "HealthScreenLogin"("expiresAt");
