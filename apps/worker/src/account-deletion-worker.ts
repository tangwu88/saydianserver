import { AccountDeletionStatus, Prisma, PrismaClient, UserStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { ObjectStorageDeletion } from "./object-storage-deletion";

type FileDeletion = { delete(objectKeys: string[]): Promise<void> };

export class AccountDeletionWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly fileDeletion: FileDeletion = new ObjectStorageDeletion(prisma),
  ) {}

  async runOnce(): Promise<boolean> {
    const request = await this.prisma.accountDeletionRequest.findFirst({
      where: {
        status: AccountDeletionStatus.REQUESTED,
        executeAfter: { lte: new Date() },
      },
      orderBy: { requestedAt: "asc" },
    });
    if (!request) return false;
    const claimed = await this.prisma.accountDeletionRequest.updateMany({
      where: { id: request.id, status: AccountDeletionStatus.REQUESTED },
      data: { status: AccountDeletionStatus.PROCESSING },
    });
    if (claimed.count !== 1) return true;
    try {
      const files = await this.claimOwnedFiles(request.userId);
      await this.fileDeletion.delete(files.map(file => file.objectKey));
      await this.prisma.$transaction(async (tx) => {
        const userId = request.userId;
        await tx.healthRecord.deleteMany({ where: { userId } });
        await tx.healthWarningEvent.deleteMany({ where: { userId } });
        await tx.healthWarningRule.deleteMany({ where: { userId } });
        await tx.careRelationship.deleteMany({
          where: { OR: [{ inviterId: userId }, { recipientId: userId }] },
        });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.notificationCampaignDelivery.deleteMany({ where: { userId } });
        await tx.userNotificationPreference.deleteMany({ where: { userId } });
        await tx.pushInstallation.deleteMany({ where: { userId } });
        await tx.userSession.deleteMany({ where: { userId } });
        await tx.consentRecord.deleteMany({ where: { userId } });
        await tx.activityGoal.deleteMany({ where: { userId } });
        await tx.deviceBinding.deleteMany({ where: { userId } });
        await tx.aiConversation.deleteMany({ where: { userId } });
        await tx.reportCreditLedger.deleteMany({ where: { userId } });
        await tx.healthReport.deleteMany({ where: { userId } });
        await tx.healthMembership.deleteMany({ where: { userId } });
        await tx.healthProfile.deleteMany({ where: { userId } });
        await tx.commerceCart.deleteMany({ where: { userId } });
        await tx.commerceAddress.deleteMany({ where: { userId } });
        await tx.commerceFavorite.deleteMany({ where: { userId } });
        await tx.commerceReview.updateMany({
          where: { userId },
          data: { content: "用户已注销", images: [] },
        });
        await tx.commerceOrder.updateMany({
          where: { userId },
          data: anonymizedOrderData(),
        });
        await tx.legacyOrderProjection.updateMany({
          where: { userId },
          data: { snapshot: { redacted: true, reason: "account_deleted" } },
        });
        await tx.legacyMemberFinanceProjection.updateMany({
          where: { userId },
          data: { snapshot: { redacted: true, reason: "account_deleted" } },
        });
        await tx.legacyCommerceFinanceProjection.updateMany({
          where: { userId },
          data: { snapshot: { redacted: true, reason: "account_deleted" } },
        });
        await tx.commerceIdentityMap.deleteMany({ where: { userId } });
        await tx.idempotencyRecord.deleteMany({ where: { userId } });
        await tx.feedback.updateMany({
          where: { userId },
          data: { userId: null, contact: null },
        });
        await tx.fileObject.deleteMany({
          where: { ownerUserId: userId, status: "DELETION_PENDING", id: { in: files.map(file => file.id) } },
        });
        await tx.wechatOfficialIdentity.deleteMany({ where: { userId } });
        await tx.user.update({
          where: { id: userId },
          data: anonymizedUserData(userId),
        });
        await tx.accountDeletionRequest.update({
          where: { id: request.id },
          data: {
            status: AccountDeletionStatus.COMPLETED,
            completedAt: new Date(),
            failureReason: null,
          },
        });
      });
    } catch (error) {
      await this.prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: AccountDeletionStatus.FAILED,
          failureReason: sanitizeError(error),
        },
      });
    }
    return true;
  }

  private async claimOwnedFiles(userId: string) {
    await this.prisma.fileObject.updateMany({
      where: { ownerUserId: userId },
      data: { status: "DELETION_PENDING" },
    });
    return this.prisma.fileObject.findMany({
      where: { ownerUserId: userId, status: "DELETION_PENDING" },
      select: { id: true, objectKey: true },
      orderBy: { id: "asc" },
    });
  }
}

export function anonymizedUserData(userId: string) {
  const suffix = createHash("sha256").update(userId).digest("hex").slice(0, 12);
  return {
    mobile: null,
    mobileVerifiedAt: null,
    email: null,
    emailVerifiedAt: null,
    wechatUnionId: null,
    wechatOpenId: null,
    wechatAppOpenId: null,
    passwordHash: null,
    status: UserStatus.DELETED,
    nickname: `已注销用户-${suffix}`,
    avatarUrl: null,
    gender: "UNSPECIFIED" as const,
    birthday: null,
    heightCm: null,
    weightKg: null,
    referralEmployeeId: null,
  };
}

export function anonymizedOrderData() {
  return {
    recipientName: "已注销用户",
    recipientMobile: "",
    province: "",
    city: "",
    district: "",
    addressDetail: "",
    buyerRemark: null,
    invoiceJson: Prisma.DbNull,
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "deletion failed";
  return message.replace(/[\r\n]/g, " ").slice(0, 500);
}
