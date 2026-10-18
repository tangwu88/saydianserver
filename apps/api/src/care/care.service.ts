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
  UserStatus,
  type CareRelationship,
  type Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import type {
  CareInvitationSubmissionContract,
  CareRelationshipContract,
  HealthMetric,
} from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { safeObject } from "../common/crypto";
import {
  careInvitationLimited,
  careInvitationTarget,
  careLock,
  carePairKey,
  reserveCareInvitation,
} from "./care-invitation";
import {
  foldedHealthRecordPeriodWhere,
  healthAggregationContract,
} from "../health/health-record-scope";

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

  async invite(
    inviterId: string,
    input: string,
  ): Promise<CareRelationshipContract>;
  async invite(
    inviterId: string,
    input: unknown,
  ): Promise<CareRelationshipContract | CareInvitationSubmissionContract>;
  async invite(inviterId: string, input: unknown) {
    const target = careInvitationTarget(input);
    type Outcome =
      | { kind: "created"; relationship: CareRelationship }
      | { kind: "self" }
      | { kind: "active" }
      | { kind: "unavailable" }
      | { kind: "limited" };
    const result = await this.prisma.$transaction(
      async (tx): Promise<Outcome> => {
        await careLock(tx, `care-invitation-account:${inviterId}`);
        let recipient = await tx.user.findUnique({
          where:
            "memberNo" in target
              ? { compatibilityId: target.memberNo }
              : "email" in target
                ? { email: target.email }
                : { mobile: target.mobile },
          select: { id: true, status: true },
        });
        if (recipient?.id === inviterId) return { kind: "self" };
        if (recipient?.status === UserStatus.ACTIVE) {
          // Account deactivation must not race a newly created invitation.
          const rows = await tx.$queryRaw<Array<{ status: UserStatus }>>`
          SELECT "status" FROM "User" WHERE "id" = ${recipient.id}::uuid FOR SHARE`;
          if (rows[0]?.status !== UserStatus.ACTIVE) recipient = null;
        }
        if (recipient?.status === UserStatus.ACTIVE) {
          await careLock(tx, carePairKey(inviterId, recipient.id));
          const existing = await tx.careRelationship.findUnique({
            where: {
              inviterId_recipientId: { inviterId, recipientId: recipient.id },
            },
          });
          if (existing?.status === CareStatus.ACTIVE) return { kind: "active" };
          if (existing?.status === CareStatus.PENDING)
            return { kind: "created", relationship: existing };
        }
        if ("memberNo" in target &&
            !(await reserveCareInvitation(tx, inviterId, target, recipient?.id)))
          return { kind: "limited" };
        // Returning this outcome commits the attempt's reservation even though no
        // invitation is created. Throwing here would undo anti-enumeration limits.
        if (!recipient || recipient.status !== UserStatus.ACTIVE)
          return { kind: "unavailable" };
        const invitationId = `care_${randomUUID()}`;
        const eventId = `care-invitation-${invitationId}`;
        const relation = await tx.careRelationship.upsert({
          where: {
            inviterId_recipientId: { inviterId, recipientId: recipient.id },
          },
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
        await tx.carePermission.deleteMany({
          where: { relationshipId: relation.id },
        });
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
        return { kind: "created", relationship: relation };
      },
    );
    if (result.kind === "limited") throw careInvitationLimited();
    if (result.kind === "self") throw new BadRequestException("不能关爱自己");
    if ("memberNo" in target) return { invitationSubmitted: true as const };
    if (result.kind === "unavailable")
      throw new NotFoundException("未找到该用户");
    if (result.kind === "active")
      throw new ConflictException("已建立关爱关系，无需重复邀请");
    return this.contract(result.relationship, []);
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
        ...(Number.isInteger(relationship.inviter.compatibilityId)
          ? { memberNo: String(relationship.inviter.compatibilityId) }
          : {}),
        nickname: relationship.inviter.nickname,
        avatarUrl: relationship.inviter.avatarUrl,
      },
      recipient: {
        id: relationship.recipient.id,
        ...(Number.isInteger(relationship.recipient.compatibilityId)
          ? { memberNo: String(relationship.recipient.compatibilityId) }
          : {}),
        nickname: relationship.recipient.nickname,
        avatarUrl: relationship.recipient.avatarUrl,
      },
    }));
  }

  private async lockedRelationship(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.careRelationship.findUnique({ where: { id } });
    if (!row) return null;
    await careLock(tx, carePairKey(row.inviterId, row.recipientId));
    return tx.careRelationship.findUnique({ where: { id } });
  }

  async respond(userId: string, id: string, accepted: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const relationship = await this.lockedRelationship(tx, id);
      if (!relationship || relationship.recipientId !== userId) {
        throw new NotFoundException("未找到待处理的关爱邀请");
      }
      if (relationship.status !== CareStatus.PENDING) {
        throw new BadRequestException("该邀请已经处理");
      }
      // Acceptance is not metric consent, including legacy/raced pending rows.
      await tx.carePermission.deleteMany({ where: { relationshipId: id } });
      const updated = await tx.careRelationship.update({
        where: { id },
        data: {
          status: accepted ? CareStatus.ACTIVE : CareStatus.REJECTED,
          respondedAt: new Date(),
        },
      });
      return this.contract(updated, []);
    });
  }

  async savePermissions(userId: string, id: string, input: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const relationship = await this.lockedRelationship(tx, id);
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
      const expiresAt = body.expiresAt
        ? new Date(String(body.expiresAt))
        : null;
      if (
        expiresAt &&
        (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date())
      ) {
        throw new BadRequestException("共享到期时间不正确");
      }
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
      const updated = await tx.careRelationship.findUniqueOrThrow({
        where: { id },
        include: { permissions: true },
      });
      return this.contract(updated, updated.permissions);
    });
  }

  async revoke(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const relationship = await this.lockedRelationship(tx, id);
      if (
        !relationship ||
        (relationship.inviterId !== userId &&
          relationship.recipientId !== userId)
      ) {
        throw new NotFoundException("未找到关爱关系");
      }
      await tx.carePermission.deleteMany({ where: { relationshipId: id } });
      const updated = await tx.careRelationship.update({
        where: { id },
        data: { status: CareStatus.REVOKED, revokedAt: new Date() },
      });
      return this.contract(updated, []);
    });
  }

  async authorizedSubject(
    viewerId: string, relationshipId: string,
    metric: PrismaHealthMetric, requestId = "unknown",
  ) {
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
    return relationship.recipientId;
  }

  async summary(viewerId: string, relationshipId: string, requestId = "unknown") {
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { id: relationshipId }, include: { permissions: true },
    });
    if (!relationship || relationship.inviterId !== viewerId ||
        relationship.status !== CareStatus.ACTIVE ||
        (relationship.expiresAt && relationship.expiresAt <= new Date())) {
      throw new ForbiddenException("对方尚未授权查看健康数据");
    }
    const metrics = relationship.permissions.filter(p => p.enabled &&
      (!p.expiresAt || p.expiresAt > new Date())).map(p => metricReverse[p.metric]);
    const records = [];
    for (const metric of metrics) {
      const rows = await this.preview(viewerId, relationshipId, metric,
        undefined, undefined, requestId, 1);
      if (rows[0]) records.push(rows[0]);
    }
    return { metrics, records };
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
    const subjectUserId = await this.authorizedSubject(viewerId, relationshipId, metric, requestId);
    const now = new Date();
    const from = fromInput
      ? new Date(fromInput)
      : page
        ? new Date(0)
        : new Date(Date.now() - 7 * 86400_000);
    const to = toInput ? new Date(toInput) : now;
    if (
      Number.isNaN(from.valueOf()) ||
      Number.isNaN(to.valueOf()) ||
      from >= to
    ) {
      throw new BadRequestException("查询时间范围不正确");
    }
    const records = await this.prisma.healthRecord.findMany({
      where: {
        userId: subjectUserId,
        metric,
        // A historical summary belongs to aggregationLocalDate even when it
        // was read from the watch and uploaded much later.
        AND: [foldedHealthRecordPeriodWhere(from, to)],
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      skip: page ? (page - 1) * 30 : 0,
      take: page ? 30 : 20_001,
      include: { ecgArtifact: true },
    });
    if (records.length > 20_000)
      throw new BadRequestException("记录较多，请缩小查询时间范围");
    return records.map((record) => ({
      id: record.clientRecordId,
      metric: metricReverse[record.metric],
      observedAt: record.observedAt.toISOString(),
      timezoneOffsetMinutes: record.timezoneOffsetMinutes,
      values: record.values,
      unit: record.unit,
      quality: record.quality.toLowerCase(),
      ecgArtifact: record.ecgArtifact ? {
        sampleRateHz: record.ecgArtifact.sampleRateHz,
        sampleCount: record.ecgArtifact.sampleCount,
        sha256: record.ecgArtifact.sha256,
      } : null,
      ...(healthAggregationContract(record)
        ? { aggregation: healthAggregationContract(record) }
        : {}),
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
  ): CareRelationshipContract {
    return {
      id: relationship.id,
      invitationId: relationship.invitationId,
      inviterMemberId: relationship.inviterId,
      recipientMemberId: relationship.recipientId,
      status:
        relationship.status.toLowerCase() as CareRelationshipContract["status"],
      metrics: permissions
        .filter((item) => item.enabled)
        .map((item) => metricReverse[item.metric]),
      expiresAt: relationship.expiresAt?.toISOString() ?? null,
      createdAt: relationship.createdAt.toISOString(),
      updatedAt: relationship.updatedAt.toISOString(),
    };
  }
}
