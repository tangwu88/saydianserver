ALTER TABLE "Feedback"
  ADD COLUMN "replyContent" TEXT,
  ADD COLUMN "repliedAt" TIMESTAMP(3),
  ADD COLUMN "repliedBy" UUID;
