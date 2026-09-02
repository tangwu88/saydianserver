import { Injectable, NotFoundException } from "@nestjs/common";
import { CareStatus, HealthMetric, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";

const legacyStatus: Record<CareStatus, number> = {
  PENDING: 0,
  ACTIVE: 1,
  REJECTED: 2,
  REVOKED: 3,
  EXPIRED: 4,
};

const legacyMetricName: Record<HealthMetric, string> = {
  SLEEP: "sleep",
  STEPS: "steps",
  DISTANCE: "distance",
  CALORIES: "calories",
  HEART_RATE: "heart_rate",
  BLOOD_OXYGEN: "blood_oxygen",
  BLOOD_PRESSURE: "blood_pressure",
  BLOOD_GLUCOSE: "blood_glucose",
  TEMPERATURE: "temperature",
  HRV: "hrv",
  ECG: "ecg",
  BODY_COMPOSITION: "body_composition",
  BLOOD_COMPOSITION: "blood_composition",
};

@Injectable()
export class LegacyService {
  constructor(private readonly prisma: PrismaService) {}

  async member(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.memberContract(user);
  }

  async careRows(userId: string, observedOnly: boolean) {
    const relationships = await this.prisma.careRelationship.findMany({
      where: observedOnly
        ? { inviterId: userId, status: CareStatus.ACTIVE }
        : { OR: [{ inviterId: userId }, { recipientId: userId }] },
      include: {
        inviter: true,
        recipient: true,
        permissions: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    return relationships.map((relationship) => ({
      id: relationship.compatibilityId,
      member_id: relationship.inviter.compatibilityId,
      to_member_id: relationship.recipient.compatibilityId,
      examine_status: legacyStatus[relationship.status],
      status: relationship.status.toLowerCase(),
      created_at: Math.floor(relationship.createdAt.valueOf() / 1000),
      member: this.memberContract(
        observedOnly || relationship.inviterId === userId
          ? relationship.recipient
          : relationship.inviter,
      ),
      inviter: this.memberContract(relationship.inviter),
      to_member: this.memberContract(relationship.recipient),
      setting: relationship.permissions
        .filter((permission) => permission.enabled)
        .map((permission) => legacyMetricName[permission.metric]),
    }));
  }

  async relationshipByCompatibilityId(idInput: unknown) {
    const compatibilityId = Number(idInput);
    if (!Number.isInteger(compatibilityId) || compatibilityId <= 0) {
      throw new NotFoundException("未找到关爱关系");
    }
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { compatibilityId },
      include: { inviter: true, recipient: true, permissions: true },
    });
    if (!relationship) throw new NotFoundException("未找到关爱关系");
    return relationship;
  }

  async relationshipForSettings(userId: string, memberIdInput: unknown) {
    const memberCompatibilityId = Number(memberIdInput);
    if (!Number.isInteger(memberCompatibilityId) || memberCompatibilityId <= 0) {
      throw new NotFoundException("未找到关爱关系");
    }
    const member = await this.prisma.user.findUnique({
      where: { compatibilityId: memberCompatibilityId },
    });
    if (!member) throw new NotFoundException("未找到关爱关系");
    const relationship = await this.prisma.careRelationship.findFirst({
      where: {
        status: CareStatus.ACTIVE,
        OR: [
          { inviterId: userId, recipientId: member.id },
          { inviterId: member.id, recipientId: userId },
        ],
      },
      include: { permissions: true },
    });
    if (!relationship) throw new NotFoundException("未找到关爱关系");
    return relationship;
  }

  async viewerRelationship(userId: string, memberIdInput: unknown) {
    const subject = await this.userByCompatibilityId(memberIdInput);
    const relationship = await this.prisma.careRelationship.findFirst({
      where: {
        inviterId: userId,
        recipientId: subject.id,
        status: CareStatus.ACTIVE,
      },
      include: { permissions: true },
    });
    if (!relationship) throw new NotFoundException("未找到可查看的关爱关系");
    return { relationship, subject };
  }

  async userByCompatibilityId(idInput: unknown) {
    const compatibilityId = Number(idInput);
    if (!Number.isInteger(compatibilityId) || compatibilityId <= 0) {
      throw new NotFoundException("未找到成员");
    }
    const user = await this.prisma.user.findUnique({ where: { compatibilityId } });
    if (!user) throw new NotFoundException("未找到成员");
    return user;
  }

  async notificationId(userId: string, identifier: string): Promise<string> {
    const numeric = Number(identifier);
    const notification = await this.prisma.notification.findFirst({
      where: {
        userId,
        OR: [
          { id: identifier },
          { eventId: identifier },
          ...(Number.isInteger(numeric) && numeric > 0
            ? [{ compatibilityId: numeric }]
            : []),
        ],
      },
    });
    if (!notification) throw new NotFoundException("消息不存在");
    return notification.id;
  }

  async notifications(userId: string, pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 30,
      take: 30,
    });
    return items.map((item) => ({
      id: item.compatibilityId,
      event_id: item.eventId,
      type: item.type.toLowerCase(),
      title: item.title,
      content: item.body,
      body: item.body,
      url: item.deepLink,
      metadata: item.metadata,
      is_read: item.readAt ? 1 : 0,
      created_at: Math.floor(item.createdAt.valueOf() / 1000),
    }));
  }

  async notification(userId: string, identifier: string) {
    const id = await this.notificationId(userId, identifier);
    const item = await this.prisma.notification.findUniqueOrThrow({ where: { id } });
    return {
      id: item.compatibilityId,
      event_id: item.eventId,
      type: item.type.toLowerCase(),
      title: item.title,
      content: item.body,
      body: item.body,
      url: item.deepLink,
      metadata: item.metadata,
      is_read: item.readAt ? 1 : 0,
      created_at: Math.floor(item.createdAt.valueOf() / 1000),
    };
  }

  async articleCategoryId(legacyOrId?: string): Promise<string | undefined> {
    if (!legacyOrId) return undefined;
    const category = await this.prisma.articleCategory.findFirst({
      where: { OR: [{ id: legacyOrId }, { legacyId: legacyOrId }] },
      select: { id: true },
    });
    return category?.id;
  }

  async compatibilityId(entityType: string, externalIdInput: unknown): Promise<number> {
    const externalId = String(externalIdInput ?? "").trim();
    if (!externalId) throw new NotFoundException("资源标识不正确");
    const mapping = await this.prisma.compatibilityId.upsert({
      where: { entityType_externalId: { entityType, externalId } },
      create: { entityType, externalId },
      update: {},
    });
    return mapping.id;
  }

  async externalId(entityType: string, compatibilityIdInput: unknown): Promise<string> {
    const externalId = await this.externalIdIfMapped(
      entityType,
      compatibilityIdInput,
    );
    if (!externalId) throw new NotFoundException("资源不存在或已失效");
    return externalId;
  }

  async externalIdIfMapped(
    entityType: string,
    compatibilityIdInput: unknown,
  ): Promise<string | null> {
    const compatibilityId = Number(compatibilityIdInput);
    if (!Number.isInteger(compatibilityId) || compatibilityId <= 0) {
      return null;
    }
    const mapping = await this.prisma.compatibilityId.findUnique({
      where: { id: compatibilityId },
    });
    return mapping?.entityType === entityType ? mapping.externalId : null;
  }

  articleContract(article: Record<string, unknown>) {
    return {
      ...article,
      id: article.legacyId ?? article.id,
      cate_id: article.categoryId ?? null,
      cover: article.coverUrl ?? null,
      content: article.contentHtml ?? null,
      created_at: article.publishedAt ?? article.createdAt ?? null,
    };
  }

  memberContract(user: {
    id: string;
    compatibilityId: number;
    legacyMemberId: string | null;
    mobile: string | null;
    nickname: string;
    avatarUrl: string | null;
    gender: string;
    birthday: Date | null;
    heightCm: Prisma.Decimal | null;
    weightKg: Prisma.Decimal | null;
  }) {
    return {
      id: user.compatibilityId,
      uuid: user.id,
      legacy_id: user.legacyMemberId,
      mobile: user.mobile,
      nickname: user.nickname,
      username: user.nickname,
      head_portrait: user.avatarUrl,
      gender: user.gender === "MALE" ? 1 : user.gender === "FEMALE" ? 2 : 0,
      birthday: user.birthday?.toISOString().slice(0, 10) ?? null,
      height: user.heightCm?.toNumber() ?? null,
      weight: user.weightKg?.toNumber() ?? null,
    };
  }
}
