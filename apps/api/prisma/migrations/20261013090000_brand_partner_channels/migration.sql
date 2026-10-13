-- Commit enum additions before using them in subsequent constraints.
-- AlterEnum
ALTER TYPE "BusinessType" ADD VALUE 'PARTNER_RECHARGE';

-- AlterEnum
ALTER TYPE "PaymentChannel" ADD VALUE 'PARTNER_BALANCE';
