import {
  NotificationCampaignStatus,
  OutboxStatus,
  Prisma,
  PrismaClient,
  UserStatus,
} from "@prisma/client";
import { buildSafePushPayload } from "@saydian/app-contracts";
import type { PushProvider } from "./push-provider";

export class NotificationCampaignWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly push: PushProvider,
  ) {}

  async dispatch(campaignId: string): Promise<void> {
    const campaign = await this.prisma.notificationCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) throw new PermanentCampaignError("Notification campaign not found");
    if (campaign.transactional) {
      throw new PermanentCampaignError("Transactional notifications cannot be broadcast");
    }
    if (campaign.status === NotificationCampaignStatus.COMPLETED) return;
    if (
      campaign.status !== NotificationCampaignStatus.SCHEDULED &&
      campaign.status !== NotificationCampaignStatus.SENDING
    ) {
      throw new PermanentCampaignError("Notification campaign is not scheduled");
    }

    await this.prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: {
        status: NotificationCampaignStatus.SENDING,
        startedAt: campaign.startedAt ?? new Date(),
      },
    });

    const userIds = await this.resolveRecipients(campaign.audience);
    let failed = 0;
    for (const userId of userIds) {
      const eventId = `notification-campaign:${campaignId}:${userId}`;
      const existing = await this.prisma.notificationCampaignDelivery.findUnique({
        where: { campaignId_userId: { campaignId, userId } },
      });
      if (existing?.status === OutboxStatus.DELIVERED) continue;
      await this.prisma.$transaction(async (tx) => {
        await tx.notification.upsert({
          where: { userId_eventId: { userId, eventId } },
          create: {
            userId,
            eventId,
            type: campaign.type,
            title: campaign.title,
            body: campaign.body,
            deepLink: campaign.deepLink,
            metadata: {
              campaignId,
              marketing: true,
            },
          },
          update: {
            title: campaign.title,
            body: campaign.body,
            deepLink: campaign.deepLink,
          },
        });
        await tx.notificationCampaignDelivery.upsert({
          where: { campaignId_userId: { campaignId, userId } },
          create: { campaignId, userId, eventId },
          update: {
            status: OutboxStatus.PROCESSING,
            failureReason: null,
          },
        });
      });
      try {
        const installations = await this.prisma.pushInstallation.findMany({
          where: { userId, enabled: true },
        });
        if (installations.length) {
          await this.push.deliver(
            installations,
            buildSafePushPayload({
              eventId,
              type: campaign.type.toLowerCase(),
              deepLink: campaign.deepLink,
            }),
          );
        }
        await this.prisma.notificationCampaignDelivery.update({
          where: { campaignId_userId: { campaignId, userId } },
          data: {
            status: OutboxStatus.DELIVERED,
            deliveredAt: new Date(),
            failureReason: null,
          },
        });
      } catch (error) {
        failed += 1;
        await this.prisma.notificationCampaignDelivery.update({
          where: { campaignId_userId: { campaignId, userId } },
          data: {
            status: OutboxStatus.PENDING,
            failureReason: sanitizeError(error),
          },
        });
      }
    }

    const [sentCount, failedCount] = await Promise.all([
      this.prisma.notificationCampaignDelivery.count({
        where: { campaignId, status: OutboxStatus.DELIVERED },
      }),
      this.prisma.notificationCampaignDelivery.count({
        where: { campaignId, status: { not: OutboxStatus.DELIVERED } },
      }),
    ]);
    await this.prisma.notificationCampaign.update({
      where: { id: campaignId },
      data: {
        sentCount,
        failedCount,
        ...(failed === 0
          ? {
              status: NotificationCampaignStatus.COMPLETED,
              completedAt: new Date(),
            }
          : {}),
      },
    });
    if (failed) throw new Error(`${failed} campaign deliveries failed`);
  }

  async failPermanently(campaignId: string, error: unknown): Promise<void> {
    await this.prisma.notificationCampaign.updateMany({
      where: {
        id: campaignId,
        status: { in: [NotificationCampaignStatus.SCHEDULED, NotificationCampaignStatus.SENDING] },
      },
      data: {
        status: NotificationCampaignStatus.FAILED,
        completedAt: new Date(),
        failedCount: {
          increment: 1,
        },
      },
    });
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        event: "notification_campaign_failed",
        campaignId,
        message: sanitizeError(error),
      })}\n`,
    );
  }

  private async resolveRecipients(audienceValue: Prisma.JsonValue): Promise<string[]> {
    const audience = asObject(audienceValue);
    const requestedIds = Array.isArray(audience.userIds)
      ? [...new Set(audience.userIds.map(String).filter(Boolean))].slice(0, 10_000)
      : [];
    if (audience.allActive !== true && requestedIds.length === 0) {
      throw new PermanentCampaignError("Notification audience is empty");
    }
    const users = await this.prisma.user.findMany({
      where: {
        status: UserStatus.ACTIVE,
        ...(audience.allActive === true ? {} : { id: { in: requestedIds } }),
        notificationPreference: { is: { marketingEnabled: true } },
      },
      select: { id: true },
      take: 10_000,
    });
    return users.map((user) => user.id);
  }
}

export class PermanentCampaignError extends Error {}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "campaign delivery failed";
  return message.replace(/[\r\n]/g, " ").slice(0, 500);
}
