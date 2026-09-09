ALTER TABLE "CommerceCommissionPlan"
  ADD COLUMN "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "minimumWithdrawCents" INTEGER,
  ADD COLUMN "dailyWithdrawLimitCents" INTEGER,
  ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "CommerceCommissionPlan"
  ADD CONSTRAINT "CommerceCommissionPlan_minimumWithdrawCents_check" CHECK ("minimumWithdrawCents" IS NULL OR "minimumWithdrawCents" >= 0),
  ADD CONSTRAINT "CommerceCommissionPlan_dailyWithdrawLimitCents_check" CHECK ("dailyWithdrawLimitCents" IS NULL OR "dailyWithdrawLimitCents" >= 0);
