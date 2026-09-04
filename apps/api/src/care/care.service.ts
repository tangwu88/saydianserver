import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CareStatus,
  HealthMetric as PrismaHealthMetric,
  NotificationType,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { HealthMetric } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { normalizedMobile, safeObject } from "../common/crypto";

const metricMap: Record<HealthMetric, PrismaHealthMetric> = {
  sleep: PrismaHealthMetric.SLEEP,
  steps: PrismaHealthMetric.STEPS,
  distance: PrismaHealthMetric.DISTANCE,
  calories: PrismaHealthMetric.CALORIES,
  heart_rate: PrismaHealthMetric.HEART_RATE,
  blood_oxygen: PrismaHealthMetric.BLOOD_OXYGEN,
  blood_pressure: PrismaHealthMetric.BLOOD_PRESSURE,
  blood_glucose: PrismaHealthMetric.BLOOD_GLUCOSE,
  temperature: PrismaHealthMetric.TEMPERATURE,
  hrv: PrismaHealthMetric.HRV,
  ecg: PrismaHealthMetric.ECG,
  body_composition: PrismaHealthMetric.BODY_COMPOSITION,
  blood_composition: PrismaHealthMetric.BLOOD_COMPOSITION,
};

const metricReverse = Object.fromEntries(
  Object.entries(metricMap).map(([key, value]) => [value, key]),
) as Record<PrismaHealthMetric, HealthMetric>;

@Injectable()
export class CareService {
  constructor(private readonly prisma: PrismaService) {}

  async invite(inviterId: string, mobileInput: string) {
    const mobile = normalizedMobile(mobileInput);
    if (!mobile) throw new BadRequestException("手机号格式不正确");
    const recipient = await this.prisma.user.findUnique({ where: { mobile } });
    if (!recipient) throw new NotFoundException("未找到该用户");
    if (recipient.id === inviterId) throw new BadRequestException("不能关爱自己");
    const invitationId = `care_${randomUUID()}`;
    const eventId = `care-invitation-${invitationId}`;
    const relationship = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.careRelationship.findUnique({
        where: { inviterId_recipientId: { inviterId, recipientId: recipient.id } },
      });
      if (existing?.status === CareStatus.ACTIVE) {
        throw new ConflictException("已建立关爱关系，无需重复邀请");
      }
      if (existing?.status === CareStatus.PENDING) return existing;
      const relation = await tx.careRelationship.upsert({
        where: { inviterId_recipientId: { inviterId, recipientId: recipient.id } },
        create: {
          invitationId,
          inviterId,
          recipientId: recipient.id,
          status: CareStatus.PENDING,
        },
        update: {
          invitationId,
          status: CareStatus.PENDING,
          respondedAt: null,
          revokedAt: null,
          expiresAt: null,
        },
      });
      await tx.carePermission.deleteMany({ where: { relationshipId: relation.id } });
      const notification = await tx.notification.upsert({
        where: { userId_eventId: { userId: recipient.id, eventId } },
        create: {
          userId: recipient.id,
          eventId,
          type: NotificationType.CARE_INVITATION,
          title: "新的关爱邀请",
          body: "有人希望查看你授权共享的健康数据",
          deepLink: `/care/invitations/${relation.id}`,
          metadata: { relationshipId: relation.id },
        },
        update: { readAt: null, createdAt: new Date() },
      });
      await tx.outboxEvent.upsert({
        where: { eventId },
        create: {
          eventId,
          eventType: "care_invitation",
          aggregateType: "care_relationship",
          aggregateId: relation.id,
          payload: {
            notificationId: notification.id,
            userId: recipient.id,
            eventId,
            type: "care_invitation",
            deepLink: `/care/invitations/${relation.id}`,
          },
        },
        update: {
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: new Date(),
          lastError: null,
        },
      });
      return relation;
    });
    return this.contract(relationship, []);
  }

  async relationships(userId: string) {
    const relationships = await this.prisma.careRelationship.findMany({
      where: { OR: [{ inviterId: userId }, { recipientId: userId }] },
      include: { permissions: true, inviter: true, recipient: true },
      orderBy: { updatedAt: "desc" },
    });
    return relationships.map((relationship) => ({
      ...this.contract(relationship, relationship.permissions),
      direction: relationship.inviterId === userId ? "sent" : "received",
      inviter: {
        id: relationship.inviter.id,
        nickname: relationship.inviter.nickname,
        avatarUrl: relationship.inviter.avatarUrl,
      },
      recipient: {
        id: relationship.recipient.id,
        nickname: relationship.recipient.nickname,
        avatarUrl: relationship.recipient.avatarUrl,
      },
    }));
  }

  async respond(userId: string, id: string, accepted: boolean) {
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { id },
    });
    if (!relationship || relationship.recipientId !== userId) {
      throw new NotFoundException("未找到待处理的关爱邀请");
    }
    if (relationship.status !== CareStatus.PENDING) {
      throw new BadRequestException("该邀请已经处理");
    }
    const updated = await this.prisma.careRelationship.update({
      where: { id },
      data: {
        status: accepted ? CareStatus.ACTIVE : CareStatus.REJECTED,
        respondedAt: new Date(),
      },
    });
    return this.contract(updated, []);
  }

  async savePermissions(userId: string, id: string, input: unknown) {
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { id },
    });
    if (!relationship || relationship.recipientId !== userId) {
      throw new ForbiddenException("只能管理自己共享的健康数据");
    }
    if (relationship.status !== CareStatus.ACTIVE) {
      throw new BadRequestException("关爱关系尚未生效");
    }
    const body = safeObject(input);
    const rawMetrics = Array.isArray(body.metrics) ? body.metrics : [];
    const metrics = [...new Set(rawMetrics.map(String))].map(
      (value) => metricMap[value as HealthMetric],
    );
    if (metrics.some((metric) => !metric)) {
      throw new BadRequestException("共享指标不正确");
    }
    const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
    if (expiresAt && (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date())) {
      throw new BadRequestException("共享到期时间不正确");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.carePermission.deleteMany({ where: { relationshipId: id } });
      if (metrics.length) {
        await tx.carePermission.createMany({
          data: metrics.map((metric) => ({
            relationshipId: id,
            metric,
            expiresAt,
          })),
        });
      }
      await tx.careRelationship.update({
        where: { id },
        data: { expiresAt },
      });
    });
    const updated = await this.prisma.careRelationship.findUniqueOrThrow({
      where: { id },
      include: { permissions: true },
    });
    return this.contract(updated, updated.permissions);
  }

  async revoke(userId: string, id: string) {
    const relationship = await this.prisma.careRelationship.findUnique({ where: { id } });
    if (
      !relationship ||
      (relationship.inviterId !== userId && relationship.recipientId !== userId)
    ) {
      throw new NotFoundException("未找到关爱关系");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.carePermission.deleteMany({ where: { relationshipId: id } });
      return tx.careRelationship.update({
        where: { id },
        data: { status: CareStatus.REVOKED, revokedAt: new Date() },
      });
    });
    return this.contract(updated, []);
  }

  async preview(
    viewerId: string,
    relationshipId: string,
    metricInput: string,
    fromInput?: string,
    toInput?: string,
    requestId = "unknown",
    page?: number,
  ) {
    const metric = metricMap[metricInput as HealthMetric];
    if (!metric) throw new BadRequestException("健康指标不正确");
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { id: relationshipId },
      include: { permissions: true },
    });
    const permission = relationship?.permissions.find(
      (item) => item.metric === metric && item.enabled,
    );
    const now = new Date();
    const allowed = Boolean(
      relationship &&
        relationship.inviterId === viewerId &&
        relationship.status === CareStatus.ACTIVE &&
        (!relationship.expiresAt || relationship.expiresAt > now) &&
        permission &&
        (!permission.expiresAt || permission.expiresAt > now),
    );
    if (relationship) {
      await this.prisma.careAccessAudit.create({
        data: {
          relationshipId,
          viewerUserId: viewerId,
          subjectUserId: relationship.recipientId,
          metric,
          result: allowed ? "ALLOWED" : "DENIED",
          requestId,
        },
      });
    }
    if (!allowed || !relationship) {
      throw new ForbiddenException("对方尚未授权查看这项健康数据");
    }
    const from = fromInput ? new Date(fromInput) : page ? new Date(0) : new Date(Date.now() - 7 * 86400_000);
    const to = toInput ? new Date(toInput) : now;
    if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf()) || from >= to) {
      throw new BadRequestException("查询时间范围不正确");
    }
    const records = await this.prisma.healthRecord.findMany({
      where: {
        userId: relationship.recipientId,
        metric,
        observedAt: { gte: from, lt: to },
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      skip: page ? (page - 1) * 30 : 0,
      take: page ? 30 : 20_001,
    });
    if (records.length > 20_000) throw new BadRequestException("记录较多，请缩小查询时间范围");
    return records.map((record) => ({
      id: record.clientRecordId,
      metric: metricReverse[record.metric],
      observedAt: record.observedAt.toISOString(),
      timezoneOffsetMinutes: record.timezoneOffsetMinutes,
      values: record.values,
      unit: record.unit,
      quality: record.quality.toLowerCase(),
    }));
  }

  private contract(
    relationship: {
      id: string;
      invitationId: string;
      inviterId: string;
      recipientId: string;
      status: CareStatus;
      expiresAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    permissions: Array<{
      metric: PrismaHealthMetric;
      enabled: boolean;
      expiresAt: Date | null;
    }>,
  ) {
    return {
      id: relationship.id,
      invitationId: relationship.invitationId,
      inviterMemberId: relationship.inviterId,
      recipientMemberId: relationship.recipientId,
      status: relationship.status.toLowerCase(),
      metrics: permissions
        .filter((item) => item.enabled)
        .map((item) => metricReverse[item.metric]),
      expiresAt: relationship.expiresAt?.toISOString() ?? null,
      createdAt: relationship.createdAt.toISOString(),
      updatedAt: relationship.updatedAt.toISOString(),
    };
  }
}
