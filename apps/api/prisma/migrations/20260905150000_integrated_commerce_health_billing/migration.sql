-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('COMMERCE_ORDER', 'HEALTH_REPORT', 'HEALTH_MEMBERSHIP');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('WECHAT_MINI', 'WECHAT_JSAPI', 'WECHAT_H5', 'WECHAT_NATIVE', 'WECHAT_APP', 'ALIPAY_WAP', 'ALIPAY_PAGE', 'ALIPAY_APP', 'APPLE_IAP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CLOSED', 'REFUNDING', 'PARTIAL_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('AWAITING_PAYMENT', 'QUEUED', 'GENERATING', 'READY', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ReportEntitlementType" AS ENUM ('SINGLE_REPORT', 'MEMBERSHIP');

-- CreateEnum
CREATE TYPE "CreditLedgerType" AS ENUM ('GRANT', 'CONSUME', 'EXPIRE', 'REFUND_REVOKE', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApiDocumentationStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'OFF_SHELF');

-- CreateEnum
CREATE TYPE "CommerceOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'WAITING_FULFILLMENT', 'SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED', 'CLOSED', 'AFTER_SALE', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AfterSaleType" AS ENUM ('REFUND_ONLY', 'RETURN_REFUND', 'EXCHANGE');

-- CreateEnum
CREATE TYPE "AfterSaleStatus" AS ENUM ('APPLIED', 'REVIEWING', 'APPROVED', 'REJECTED', 'WAITING_RETURN', 'RETURNED', 'REFUNDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('CASH');

-- CreateEnum
CREATE TYPE "CouponStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommerceJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "NotificationCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'COMMERCE_OPERATIONS';
ALTER TYPE "AdminRole" ADD VALUE 'FINANCE';
ALTER TYPE "AdminRole" ADD VALUE 'INTEGRATION_ADMIN';
ALTER TYPE "AdminRole" ADD VALUE 'API_DOC_EDITOR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "referralEmployeeId" UUID,
ADD COLUMN     "wechatOpenId" TEXT;

-- CreateTable
CREATE TABLE "UserNotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "transactionalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "marketingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "analysisConsentVersion" TEXT,
    "analysisConsentedAt" TIMESTAMP(3),
    "analysisConsentWithdrawn" TIMESTAMP(3),
    "lastAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthReportOffer" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "entitlement" "ReportEntitlementType" NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "creditCount" INTEGER NOT NULL DEFAULT 1,
    "durationDays" INTEGER,
    "platforms" TEXT[],
    "appleProductId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthReportOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthReport" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "distinctDays" INTEGER NOT NULL,
    "validRecordCount" INTEGER NOT NULL,
    "metricSummary" JSONB NOT NULL,
    "evidenceIndex" JSONB NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "freePreview" JSONB NOT NULL,
    "fullContent" JSONB,
    "templateVersion" TEXT NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT,
    "aiModel" TEXT,
    "aiLabelVersion" TEXT,
    "generationAttempts" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "generatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthMembership" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "creditsGranted" INTEGER NOT NULL,
    "remainingCredits" INTEGER NOT NULL,
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportCreditLedger" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "CreditLedgerType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "healthReportId" UUID,
    "membershipId" UUID,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" UUID NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "businessId" TEXT NOT NULL,
    "commerceOrderId" UUID,
    "healthReportId" UUID,
    "healthMembershipId" UUID,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "appleOriginalTransactionId" TEXT,
    "providerPayload" JSONB,
    "paidAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" UUID NOT NULL,
    "refundNo" TEXT NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "afterSaleId" UUID,
    "status" "RefundStatus" NOT NULL DEFAULT 'CREATED',
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "providerPayload" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "headers" JSONB,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCart" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCartItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceAddress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "legacyId" TEXT,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "provinceCode" TEXT,
    "city" TEXT NOT NULL,
    "cityCode" TEXT,
    "district" TEXT NOT NULL,
    "districtCode" TEXT,
    "detail" TEXT NOT NULL,
    "postalCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCategory" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "erpCategoryId" TEXT,
    "name" TEXT NOT NULL,
    "iconUrl" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceProduct" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "erpItemId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ERP',
    "localArchived" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "subtitle" TEXT,
    "brand" TEXT,
    "coverImage" TEXT,
    "gallery" TEXT[],
    "detailHtml" TEXT,
    "tags" TEXT[],
    "categoryId" UUID,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "sales" INTEGER NOT NULL DEFAULT 0,
    "erpModifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceSku" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "erpSkuId" TEXT NOT NULL,
    "erpItemId" TEXT NOT NULL,
    "productId" UUID NOT NULL,
    "specification" TEXT,
    "barcode" TEXT,
    "image" TEXT,
    "salePriceCents" INTEGER NOT NULL,
    "marketPriceCents" INTEGER,
    "costPriceCents" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "weightGrams" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "erpModifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceFavorite" (
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceFavorite_pkey" PRIMARY KEY ("userId","productId")
);

-- CreateTable
CREATE TABLE "CommerceReview" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "images" TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceOrder" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "orderNo" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "status" "CommerceOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "referralEmployeeId" UUID,
    "referralCodeSnapshot" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "payableCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "recipientName" TEXT NOT NULL,
    "recipientMobile" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "addressDetail" TEXT NOT NULL,
    "buyerRemark" TEXT,
    "adminRemark" TEXT,
    "invoiceJson" JSONB,
    "erpShopId" TEXT,
    "erpOrderId" TEXT,
    "erpStatus" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceOrderItem" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "erpSkuIdSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "specificationSnapshot" TEXT,
    "imageSnapshot" TEXT,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,

    CONSTRAINT "CommerceOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceShipment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "logisticsCompany" TEXT NOT NULL,
    "logisticsCode" TEXT,
    "trackingNo" TEXT NOT NULL,
    "traceJson" JSONB,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceAfterSale" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "afterSaleNo" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "type" "AfterSaleType" NOT NULL,
    "status" "AfterSaleStatus" NOT NULL DEFAULT 'APPLIED',
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "evidenceImages" TEXT[],
    "requestedCents" INTEGER NOT NULL,
    "erpAfterSaleId" TEXT,
    "erpStatus" TEXT,
    "returnLogisticsCompany" TEXT,
    "returnTrackingNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceAfterSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCoupon" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "name" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "status" "CouponStatus" NOT NULL DEFAULT 'DRAFT',
    "value" INTEGER NOT NULL,
    "minimumSpendCents" INTEGER NOT NULL DEFAULT 0,
    "totalQuantity" INTEGER,
    "claimedQuantity" INTEGER NOT NULL DEFAULT 0,
    "employeeDistributable" BOOLEAN NOT NULL DEFAULT false,
    "perEmployeeLimit" INTEGER NOT NULL DEFAULT 0,
    "employeeClaimBatchSize" INTEGER NOT NULL DEFAULT 1,
    "employeeClaimUntil" TIMESTAMP(3),
    "reservedGiftQuantity" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCouponClaim" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderId" UUID,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "sourceEmployeeId" UUID,
    "sourceGiftId" TEXT,

    CONSTRAINT "CommerceCouponClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceEmployee" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "wecomUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT,
    "departmentNames" TEXT[],
    "referralCode" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCommissionPlan" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rateBps" INTEGER NOT NULL DEFAULT 0,
    "settlementDays" INTEGER NOT NULL DEFAULT 7,
    "enabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCommissionAccrual" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "refundedBaseCents" INTEGER NOT NULL DEFAULT 0,
    "rateBps" INTEGER NOT NULL,
    "grossBonusCents" INTEGER NOT NULL,
    "reversedBonusCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'FROZEN',
    "availableAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceCommissionAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceEmployeeWallet" (
    "employeeId" UUID NOT NULL,
    "frozenCents" INTEGER NOT NULL DEFAULT 0,
    "availableCents" INTEGER NOT NULL DEFAULT 0,
    "withdrawingCents" INTEGER NOT NULL DEFAULT 0,
    "debtCents" INTEGER NOT NULL DEFAULT 0,
    "totalPaidCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceEmployeeWallet_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "CommerceCommissionLedger" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "orderId" UUID,
    "refundId" UUID,
    "type" TEXT NOT NULL,
    "frozenDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "availableDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "debtDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceCommissionLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyMemberFinanceProjection" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "migratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyMemberFinanceProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyCommerceFinanceProjection" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "employeeId" UUID,
    "sourceType" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "migratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyCommerceFinanceProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceBusinessConfig" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceBusinessConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CommerceBanner" (
    "id" UUID NOT NULL,
    "legacyId" TEXT,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "targetUrl" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceBanner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceIntegrationJob" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" "CommerceJobStatus" NOT NULL DEFAULT 'PENDING',
    "aggregateType" TEXT,
    "aggregateId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceIntegrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "templateKey" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deepLink" TEXT,
    "audience" JSONB NOT NULL,
    "transactional" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "status" "NotificationCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationCampaignDelivery" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationCampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiDocumentationAnnotation" (
    "id" UUID NOT NULL,
    "routeKey" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "businessExample" JSONB,
    "errorGuidance" JSONB,
    "tags" TEXT[],
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "deprecationNote" TEXT,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "publishedRevision" INTEGER,
    "createdById" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiDocumentationAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiDocumentationRelease" (
    "id" UUID NOT NULL,
    "version" SERIAL NOT NULL,
    "status" "ApiDocumentationStatus" NOT NULL DEFAULT 'DRAFT',
    "routeDigest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeNote" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "reviewedById" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiDocumentationRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNotificationPreference_userId_key" ON "UserNotificationPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthProfile_userId_key" ON "HealthProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HealthReportOffer_code_key" ON "HealthReportOffer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HealthReportOffer_appleProductId_key" ON "HealthReportOffer"("appleProductId");

-- CreateIndex
CREATE INDEX "HealthReportOffer_active_entitlement_idx" ON "HealthReportOffer"("active", "entitlement");

-- CreateIndex
CREATE UNIQUE INDEX "HealthReportOffer_offerKey_version_key" ON "HealthReportOffer"("offerKey", "version");

-- CreateIndex
CREATE INDEX "HealthReport_userId_createdAt_idx" ON "HealthReport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthReport_status_createdAt_idx" ON "HealthReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "HealthMembership_userId_status_expiresAt_idx" ON "HealthMembership"("userId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportCreditLedger_idempotencyKey_key" ON "ReportCreditLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ReportCreditLedger_userId_createdAt_idx" ON "ReportCreditLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportCreditLedger_userId_expiresAt_idx" ON "ReportCreditLedger"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_paymentNo_key" ON "PaymentIntent"("paymentNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_idempotencyKey_key" ON "PaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_providerTransactionId_key" ON "PaymentIntent"("providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentIntent_userId_businessType_createdAt_idx" ON "PaymentIntent"("userId", "businessType", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_createdAt_idx" ON "PaymentIntent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_appleOriginalTransactionId_idx" ON "PaymentIntent"("appleOriginalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_refundNo_key" ON "PaymentRefund"("refundNo");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentIntentId_status_idx" ON "PaymentRefund"("paymentIntentId", "status");

-- CreateIndex
CREATE INDEX "ProviderEvent_provider_eventType_createdAt_idx" ON "ProviderEvent"("provider", "eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_provider_eventKey_key" ON "ProviderEvent"("provider", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCart_userId_key" ON "CommerceCart"("userId");

-- CreateIndex
CREATE INDEX "CommerceCartItem_skuId_idx" ON "CommerceCartItem"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCartItem_cartId_skuId_key" ON "CommerceCartItem"("cartId", "skuId");

-- CreateIndex
CREATE INDEX "CommerceAddress_userId_isDefault_idx" ON "CommerceAddress"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceAddress_userId_legacyId_key" ON "CommerceAddress"("userId", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCategory_legacyId_key" ON "CommerceCategory"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCategory_erpCategoryId_key" ON "CommerceCategory"("erpCategoryId");

-- CreateIndex
CREATE INDEX "CommerceCategory_parentId_enabled_sort_idx" ON "CommerceCategory"("parentId", "enabled", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceProduct_legacyId_key" ON "CommerceProduct"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceProduct_erpItemId_key" ON "CommerceProduct"("erpItemId");

-- CreateIndex
CREATE INDEX "CommerceProduct_status_sort_idx" ON "CommerceProduct"("status", "sort");

-- CreateIndex
CREATE INDEX "CommerceProduct_localArchived_status_sort_idx" ON "CommerceProduct"("localArchived", "status", "sort");

-- CreateIndex
CREATE INDEX "CommerceProduct_categoryId_idx" ON "CommerceProduct"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceSku_legacyId_key" ON "CommerceSku"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceSku_erpSkuId_key" ON "CommerceSku"("erpSkuId");

-- CreateIndex
CREATE INDEX "CommerceSku_productId_enabled_idx" ON "CommerceSku"("productId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceReview_orderItemId_key" ON "CommerceReview"("orderItemId");

-- CreateIndex
CREATE INDEX "CommerceReview_productId_published_idx" ON "CommerceReview"("productId", "published");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceOrder_legacyId_key" ON "CommerceOrder"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceOrder_orderNo_key" ON "CommerceOrder"("orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceOrder_idempotencyKey_key" ON "CommerceOrder"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommerceOrder_userId_status_createdAt_idx" ON "CommerceOrder"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CommerceOrder_referralEmployeeId_paidAt_idx" ON "CommerceOrder"("referralEmployeeId", "paidAt");

-- CreateIndex
CREATE INDEX "CommerceOrderItem_orderId_idx" ON "CommerceOrderItem"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceShipment_orderId_trackingNo_key" ON "CommerceShipment"("orderId", "trackingNo");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceAfterSale_legacyId_key" ON "CommerceAfterSale"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceAfterSale_afterSaleNo_key" ON "CommerceAfterSale"("afterSaleNo");

-- CreateIndex
CREATE INDEX "CommerceAfterSale_orderId_status_idx" ON "CommerceAfterSale"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCoupon_legacyId_key" ON "CommerceCoupon"("legacyId");

-- CreateIndex
CREATE INDEX "CommerceCoupon_status_validFrom_validUntil_idx" ON "CommerceCoupon"("status", "validFrom", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCouponClaim_orderId_key" ON "CommerceCouponClaim"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCouponClaim_couponId_userId_key" ON "CommerceCouponClaim"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEmployee_legacyId_key" ON "CommerceEmployee"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEmployee_wecomUserId_key" ON "CommerceEmployee"("wecomUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEmployee_referralCode_key" ON "CommerceEmployee"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCommissionAccrual_orderId_key" ON "CommerceCommissionAccrual"("orderId");

-- CreateIndex
CREATE INDEX "CommerceCommissionAccrual_employeeId_status_availableAt_idx" ON "CommerceCommissionAccrual"("employeeId", "status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCommissionLedger_idempotencyKey_key" ON "CommerceCommissionLedger"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommerceCommissionLedger_employeeId_createdAt_idx" ON "CommerceCommissionLedger"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "CommerceCommissionLedger_orderId_createdAt_idx" ON "CommerceCommissionLedger"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "LegacyMemberFinanceProjection_userId_occurredAt_idx" ON "LegacyMemberFinanceProjection"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyMemberFinanceProjection_sourceType_legacyId_key" ON "LegacyMemberFinanceProjection"("sourceType", "legacyId");

-- CreateIndex
CREATE INDEX "LegacyCommerceFinanceProjection_userId_occurredAt_idx" ON "LegacyCommerceFinanceProjection"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "LegacyCommerceFinanceProjection_employeeId_occurredAt_idx" ON "LegacyCommerceFinanceProjection"("employeeId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyCommerceFinanceProjection_sourceType_legacyId_key" ON "LegacyCommerceFinanceProjection"("sourceType", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceBanner_legacyId_key" ON "CommerceBanner"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceIntegrationJob_idempotencyKey_key" ON "CommerceIntegrationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommerceIntegrationJob_status_nextRunAt_idx" ON "CommerceIntegrationJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "NotificationCampaign_status_scheduledAt_idx" ON "NotificationCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCampaignDelivery_eventId_key" ON "NotificationCampaignDelivery"("eventId");

-- CreateIndex
CREATE INDEX "NotificationCampaignDelivery_campaignId_status_idx" ON "NotificationCampaignDelivery"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCampaignDelivery_campaignId_userId_key" ON "NotificationCampaignDelivery"("campaignId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiDocumentationAnnotation_routeKey_key" ON "ApiDocumentationAnnotation"("routeKey");

-- CreateIndex
CREATE INDEX "ApiDocumentationAnnotation_signatureHash_idx" ON "ApiDocumentationAnnotation"("signatureHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApiDocumentationRelease_version_key" ON "ApiDocumentationRelease"("version");

-- CreateIndex
CREATE INDEX "ApiDocumentationRelease_status_createdAt_idx" ON "ApiDocumentationRelease"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_wechatOpenId_key" ON "User"("wechatOpenId");

-- CreateIndex
CREATE INDEX "User_referralEmployeeId_idx" ON "User"("referralEmployeeId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_referralEmployeeId_fkey" FOREIGN KEY ("referralEmployeeId") REFERENCES "CommerceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPreference" ADD CONSTRAINT "UserNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthProfile" ADD CONSTRAINT "HealthProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthReport" ADD CONSTRAINT "HealthReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthMembership" ADD CONSTRAINT "HealthMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthMembership" ADD CONSTRAINT "HealthMembership_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "HealthReportOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCreditLedger" ADD CONSTRAINT "ReportCreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCreditLedger" ADD CONSTRAINT "ReportCreditLedger_healthReportId_fkey" FOREIGN KEY ("healthReportId") REFERENCES "HealthReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportCreditLedger" ADD CONSTRAINT "ReportCreditLedger_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "HealthMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_healthReportId_fkey" FOREIGN KEY ("healthReportId") REFERENCES "HealthReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_healthMembershipId_fkey" FOREIGN KEY ("healthMembershipId") REFERENCES "HealthMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_afterSaleId_fkey" FOREIGN KEY ("afterSaleId") REFERENCES "CommerceAfterSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCart" ADD CONSTRAINT "CommerceCart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCartItem" ADD CONSTRAINT "CommerceCartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "CommerceCart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCartItem" ADD CONSTRAINT "CommerceCartItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "CommerceSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceAddress" ADD CONSTRAINT "CommerceAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCategory" ADD CONSTRAINT "CommerceCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommerceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceProduct" ADD CONSTRAINT "CommerceProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CommerceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceSku" ADD CONSTRAINT "CommerceSku_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceFavorite" ADD CONSTRAINT "CommerceFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceFavorite" ADD CONSTRAINT "CommerceFavorite_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceReview" ADD CONSTRAINT "CommerceReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceReview" ADD CONSTRAINT "CommerceReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceReview" ADD CONSTRAINT "CommerceReview_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "CommerceOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_referralEmployeeId_fkey" FOREIGN KEY ("referralEmployeeId") REFERENCES "CommerceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrderItem" ADD CONSTRAINT "CommerceOrderItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "CommerceSku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceShipment" ADD CONSTRAINT "CommerceShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceAfterSale" ADD CONSTRAINT "CommerceAfterSale_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponClaim" ADD CONSTRAINT "CommerceCouponClaim_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "CommerceCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponClaim" ADD CONSTRAINT "CommerceCouponClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponClaim" ADD CONSTRAINT "CommerceCouponClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCouponClaim" ADD CONSTRAINT "CommerceCouponClaim_sourceEmployeeId_fkey" FOREIGN KEY ("sourceEmployeeId") REFERENCES "CommerceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCommissionAccrual" ADD CONSTRAINT "CommerceCommissionAccrual_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCommissionAccrual" ADD CONSTRAINT "CommerceCommissionAccrual_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEmployeeWallet" ADD CONSTRAINT "CommerceEmployeeWallet_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCommissionLedger" ADD CONSTRAINT "CommerceCommissionLedger_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCommissionLedger" ADD CONSTRAINT "CommerceCommissionLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyMemberFinanceProjection" ADD CONSTRAINT "LegacyMemberFinanceProjection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyCommerceFinanceProjection" ADD CONSTRAINT "LegacyCommerceFinanceProjection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyCommerceFinanceProjection" ADD CONSTRAINT "LegacyCommerceFinanceProjection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "CommerceEmployee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCampaignDelivery" ADD CONSTRAINT "NotificationCampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
