import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { CareStatus, HealthMetric, Prisma } from "@prisma/client";
import { businessWritesPaused } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { legacyCareNames } from "./legacy-care-mapper";
import { isUuid } from "../common/crypto";
import { parseLegacyAppUpdate, selectLegacyAppUpdate } from "./legacy-update-contract";

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

  async appUpdate(platform: string, build?: string) {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: "legacy_app_update" } });
    if (!setting?.public) throw new NotFoundException("暂未发布正式更新信息");
    let config;
    try { config = parseLegacyAppUpdate(setting.value); }
    catch { throw new ServiceUnavailableException("正式更新配置无效，请联系管理员"); }
    return selectLegacyAppUpdate(config, platform, build);
  }

  async member(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.assertMemberIdAvailable(user);
    const points = await this.prisma.commercePointAccount.findUnique({ where: { userId } });
    return { ...this.memberContract(user), money1: points ? points.balanceCents / 100 : null };
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
    return Promise.all(relationships.map(async (relationship) => {
      await this.assertMemberIdAvailable(relationship.inviter);
      await this.assertMemberIdAvailable(relationship.recipient);
      return {
        id: await this.relationshipPublicId(relationship),
        member_id: legacyMemberPublicId(relationship.inviter),
        to_member_id: legacyMemberPublicId(relationship.recipient),
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
        setting: legacyCareNames(relationship.permissions
          .filter((permission) => permission.enabled)
          .map((permission) => legacyMetricName[permission.metric])),
      };
    }));
  }

  async relationshipByCompatibilityId(idInput: unknown) {
    const compatibilityId = Number(idInput);
    if (!Number.isInteger(compatibilityId) || compatibilityId <= 0) {
      throw new NotFoundException("未找到关爱关系");
    }
    const imported = await this.prisma.legacyIdMap.findUnique({
      where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_app", entityType: "care_relationship", legacyId: String(compatibilityId) } },
    });
    const relationship = await this.prisma.careRelationship.findUnique({
      where: imported ? { id: imported.targetId } : { compatibilityId },
      include: { inviter: true, recipient: true, permissions: true },
    });
    if (!relationship) throw new NotFoundException("未找到关爱关系");
    if (await this.relationshipPublicId(relationship) !== compatibilityId) throw new NotFoundException("未找到关爱关系");
    return relationship;
  }

  async relationshipForSettings(userId: string, memberIdInput: unknown) {
    const memberCompatibilityId = Number(memberIdInput);
    if (!Number.isInteger(memberCompatibilityId) || memberCompatibilityId <= 0) {
      throw new NotFoundException("未找到关爱关系");
    }
    const member = await this.userByCompatibilityId(memberCompatibilityId);
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
    const oldUser = await this.prisma.user.findUnique({ where: { legacyMemberId: String(compatibilityId) } });
    const user = oldUser ?? await this.prisma.user.findFirst({ where: { compatibilityId, legacyMemberId: null } });
    if (!user) throw new NotFoundException("未找到成员");
    return user;
  }

  async notificationId(userId: string, identifier: string): Promise<string> {
    const numeric = Number(identifier);
    const notification = await this.prisma.notification.findFirst({
      where: {
        userId,
        OR: [
          ...(isUuid(identifier) ? [{ id: identifier }] : []),
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

  async notificationStatistics(userId: string) {
    const [announcements, reminders] = await this.prisma.$transaction([
      this.prisma.notification.count({ where: { userId, readAt: null, type: "SYSTEM" } }),
      this.prisma.notification.count({ where: { userId, readAt: null, type: { not: "SYSTEM" } } }),
    ]);
    return { announce_count: announcements, remind_count: reminders, unread_count: announcements + reminders };
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
      where: { OR: [...(isUuid(legacyOrId) ? [{ id: legacyOrId }] : []), { legacyId: legacyOrId }] },
      select: { id: true },
    });
    return category?.id;
  }

  async compatibilityId(entityType: string, externalIdInput: unknown): Promise<number> {
    const externalId = String(externalIdInput ?? "").trim();
    if (!externalId) throw new NotFoundException("资源标识不正确");
    const imported = await this.prisma.legacyIdMap.findMany({
      where: { sourceSystem: "legacy_app", entityType, targetId: externalId }, take: 2,
    });
    if (imported.length > 1) throw new ConflictException("旧资源编号存在冲突，请先完成迁移复核");
    if (imported[0]) {
      const id = positivePublicId(imported[0].legacyId);
      if (id === null) throw new ConflictException("旧资源编号不能供当前客户端使用");
      return id;
    }
    const where = { entityType_externalId: { entityType, externalId } };
    let mapping = await this.prisma.compatibilityId.findUnique({ where });
    if (!mapping) {
      if (businessWritesPaused(process.env)) throw new ServiceUnavailableException("迁移维护中，资源编号尚未完成映射");
      mapping = await this.prisma.compatibilityId.upsert({ where, create: { entityType, externalId }, update: {} });
    }
    const collision = await this.prisma.legacyIdMap.findUnique({
      where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_app", entityType, legacyId: String(mapping.id) } },
    });
    if (collision && collision.targetId !== externalId) throw new ConflictException("兼容编号与旧资源冲突，请先完成迁移复核");
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
    const imported = await this.prisma.legacyIdMap.findUnique({
      where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_app", entityType, legacyId: String(compatibilityId) } },
    });
    if (imported) return imported.targetId;
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
      id: legacyMemberPublicId(user),
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

  private async assertMemberIdAvailable(user: { id: string; legacyMemberId: string | null; compatibilityId: number }) {
    if (user.legacyMemberId !== null) return;
    const collision = await this.prisma.user.findUnique({ where: { legacyMemberId: String(user.compatibilityId) }, select: { id: true } });
    if (collision && collision.id !== user.id) throw new ConflictException("会员兼容编号存在冲突，请先完成迁移复核");
  }

  private async relationshipPublicId(relationship: { id: string; compatibilityId: number }) {
    const mappings = await this.prisma.legacyIdMap.findMany({
      where: { sourceSystem: "legacy_app", entityType: "care_relationship", targetId: relationship.id }, take: 2,
    });
    if (mappings.length > 1) throw new ConflictException("关爱关系旧编号存在冲突");
    if (mappings[0]) {
      const id = positivePublicId(mappings[0].legacyId);
      if (id === null) throw new ConflictException("关爱关系旧编号无效");
      return id;
    }
    const collision = await this.prisma.legacyIdMap.findUnique({
      where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_app", entityType: "care_relationship", legacyId: String(relationship.compatibilityId) } },
    });
    if (collision) throw new ConflictException("关爱关系兼容编号存在冲突");
    return relationship.compatibilityId;
  }
}

function positivePublicId(input: unknown): number | null {
  const raw = String(input ?? "");
  const value = Number(raw);
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(value) && value <= 2_147_483_647 ? value : null;
}

function legacyMemberPublicId(user: { compatibilityId: number; legacyMemberId: string | null }): number {
  if (user.legacyMemberId !== null) {
    const id = positivePublicId(user.legacyMemberId);
    if (id === null) throw new ConflictException("旧会员编号无效，请先完成迁移复核");
    return id;
  }
  return user.compatibilityId;
}
