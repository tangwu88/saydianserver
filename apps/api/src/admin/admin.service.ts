import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminRole,
  FeedbackStatus,
  IntegrationState,
  Prisma,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { maskMobile, safeObject } from "../common/crypto";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard() {
    const [members, records, care, warnings, feedback, outboxPending] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { status: "ACTIVE" } }),
        this.prisma.healthRecord.count(),
        this.prisma.careRelationship.count({ where: { status: "ACTIVE" } }),
        this.prisma.healthWarningEvent.count(),
        this.prisma.feedback.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        this.prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
      ]);
    return { members, healthRecords: records, activeCare: care, warnings, openFeedback: feedback, outboxPending };
  }

  async members(search = "", pageInput = 1, pageSizeInput = 30) {
    const page = Math.max(Number(pageInput) || 1, 1);
    const pageSize = Math.min(Math.max(Number(pageSizeInput) || 30, 1), 100);
    const where = search
      ? {
          OR: [
            { nickname: { contains: search, mode: "insensitive" as const } },
            { mobile: { contains: search } },
            { legacyMemberId: { contains: search } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { healthRecords: true, devices: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        legacyMemberId: item.legacyMemberId,
        mobileMasked: maskMobile(item.mobile),
        nickname: item.nickname,
        avatarUrl: item.avatarUrl,
        status: item.status,
        healthRecordCount: item._count.healthRecords,
        deviceCount: item._count.devices,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  async healthSummary(userId: string) {
    const grouped = await this.prisma.healthRecord.groupBy({
      by: ["metric"],
      where: { userId },
      _count: { _all: true },
      _min: { observedAt: true },
      _max: { observedAt: true },
    });
    return grouped.map((item) => ({
      metric: item.metric.toLowerCase(),
      count: item._count._all,
      firstObservedAt: item._min.observedAt?.toISOString() ?? null,
      lastObservedAt: item._max.observedAt?.toISOString() ?? null,
    }));
  }

  async rawHealth(
    adminId: string,
    userId: string,
    requestId: string,
    limitInput = 100,
  ) {
    const limit = Math.min(Math.max(Number(limitInput) || 100, 1), 500);
    const records = await this.prisma.healthRecord.findMany({
      where: { userId },
      orderBy: { observedAt: "desc" },
      take: limit,
    });
    await this.prisma.auditLog.create({
      data: {
        actorType: "ADMIN",
        actorId: adminId,
        action: "HEALTH_RAW_READ",
        entityType: "USER",
        entityId: userId,
        requestId,
        afterJson: { recordCount: records.length },
      },
    });
    return records;
  }

  care() {
    return this.prisma.careRelationship.findMany({
      include: {
        inviter: { select: { id: true, nickname: true } },
        recipient: { select: { id: true, nickname: true } },
        permissions: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
  }

  devices() {
    return this.prisma.deviceBinding.findMany({
      select: {
        id: true,
        vendor: true,
        model: true,
        displayName: true,
        firmware: true,
        capabilities: true,
        lastSeenAt: true,
        unboundAt: true,
        user: { select: { id: true, nickname: true } },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 500,
    });
  }

  feedback(status?: string) {
    const normalized = status?.toUpperCase() as FeedbackStatus | undefined;
    return this.prisma.feedback.findMany({
      where: normalized && Object.values(FeedbackStatus).includes(normalized) ? { status: normalized } : {},
      include: { user: { select: { id: true, nickname: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async updateFeedback(id: string, input: unknown) {
    const body = safeObject(input);
    const status = String(body.status ?? "").toUpperCase() as FeedbackStatus;
    if (!Object.values(FeedbackStatus).includes(status)) {
      throw new BadRequestException("反馈状态不正确");
    }
    return this.prisma.feedback.update({
      where: { id },
      data: { status, assignedTo: body.assignedTo ? String(body.assignedTo) : null },
    });
  }

  articles() {
    return this.prisma.article.findMany({
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
  }

  articleCategories() {
    return this.prisma.articleCategory.findMany({
      orderBy: [{ sort: "desc" }, { name: "asc" }],
    });
  }

  async saveArticleCategory(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 80) {
      throw new BadRequestException("分类名称不正确");
    }
    const data = {
      name,
      parentId: body.parentId ? String(body.parentId) : null,
      sort: Math.trunc(Number(body.sort ?? 0)) || 0,
      enabled: body.enabled !== false,
    };
    if (id && data.parentId === id) {
      throw new BadRequestException("分类不能作为自己的上级");
    }
    return id
      ? this.prisma.articleCategory.update({ where: { id }, data })
      : this.prisma.articleCategory.create({ data });
  }

  async saveArticle(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const title = String(body.title ?? "").trim();
    const contentHtml = String(body.contentHtml ?? body.content ?? "").trim();
    if (!title || !contentHtml) throw new BadRequestException("文章标题和正文不能为空");
    const data = {
      title,
      contentHtml,
      summary: body.summary ? String(body.summary) : null,
      coverUrl: body.coverUrl ? String(body.coverUrl) : null,
      categoryId: body.categoryId ? String(body.categoryId) : null,
      status: String(body.status ?? "DRAFT").toUpperCase(),
      publishedAt: body.publishedAt ? new Date(String(body.publishedAt)) : null,
    };
    if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(data.status)) {
      throw new BadRequestException("文章状态不正确");
    }
    if (data.status === "PUBLISHED" && !data.publishedAt) {
      data.publishedAt = new Date();
    }
    return id
      ? this.prisma.article.update({ where: { id }, data })
      : this.prisma.article.create({ data });
  }

  integrations() {
    return this.prisma.integrationConfig.findMany({
      select: {
        key: true,
        state: true,
        publicConfig: true,
        lastCheckedAt: true,
        lastError: true,
        updatedAt: true,
      },
      orderBy: { key: "asc" },
    });
  }

  async updateIntegration(key: string, input: unknown) {
    const body = safeObject(input);
    const state = String(body.state ?? "UNCONFIGURED").toUpperCase() as IntegrationState;
    if (!Object.values(IntegrationState).includes(state)) {
      throw new BadRequestException("集成状态不正确");
    }
    return this.prisma.integrationConfig.upsert({
      where: { key },
      create: {
        key,
        state,
        publicConfig: safeObject(body.publicConfig) as Prisma.InputJsonValue,
        secretRef: body.secretRef ? String(body.secretRef) : null,
      },
      update: {
        state,
        publicConfig: safeObject(body.publicConfig) as Prisma.InputJsonValue,
        ...(body.secretRef !== undefined
          ? { secretRef: body.secretRef ? String(body.secretRef) : null }
          : {}),
      },
      select: { key: true, state: true, publicConfig: true, updatedAt: true },
    });
  }

  audits(pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 100,
      take: 100,
    });
  }

  warnings(pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    return this.prisma.healthWarningEvent.findMany({
      orderBy: { observedAt: "desc" },
      skip: (page - 1) * 100,
      take: 100,
      select: {
        id: true,
        userId: true,
        metric: true,
        observedAt: true,
        source: true,
        createdAt: true,
      },
    });
  }

  notifications(pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    return this.prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 100,
      take: 100,
      select: {
        id: true,
        eventId: true,
        userId: true,
        type: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    });
  }

  legalDocuments() {
    return this.prisma.legalDocument.findMany({
      orderBy: [{ documentType: "asc" }, { publishedAt: "desc" }],
    });
  }

  async saveLegalDocument(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const data = {
      documentType: String(body.documentType ?? "").trim(),
      version: String(body.version ?? "").trim(),
      title: String(body.title ?? "").trim(),
      contentHtml: String(body.contentHtml ?? "").trim(),
      active: body.active === true,
      publishedAt: body.publishedAt
        ? new Date(String(body.publishedAt))
        : new Date(),
    };
    if (!data.documentType || !data.version || !data.title || !data.contentHtml) {
      throw new BadRequestException("协议内容不完整");
    }
    if (Number.isNaN(data.publishedAt.valueOf())) {
      throw new BadRequestException("协议发布时间不正确");
    }
    return this.prisma.$transaction(async (tx) => {
      if (data.active) {
        await tx.legalDocument.updateMany({
          where: { documentType: data.documentType, ...(id ? { id: { not: id } } : {}) },
          data: { active: false },
        });
      }
      return id
        ? tx.legalDocument.update({ where: { id }, data })
        : tx.legalDocument.create({ data });
    });
  }

  adminUsers() {
    return this.prisma.adminUser.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createAdmin(input: unknown) {
    const body = safeObject(input);
    const username = String(body.username ?? "").trim();
    const displayName = String(body.displayName ?? "").trim();
    const password = String(body.password ?? "");
    const role = String(body.role ?? "READ_ONLY").toUpperCase() as AdminRole;
    if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username)) {
      throw new BadRequestException("后台账号格式不正确");
    }
    if (!displayName || displayName.length > 50 || password.length < 12) {
      throw new BadRequestException("显示名称或密码不正确");
    }
    if (!Object.values(AdminRole).includes(role)) {
      throw new BadRequestException("后台角色不正确");
    }
    return this.prisma.adminUser.create({
      data: {
        username,
        displayName,
        passwordHash: await hash(password, 12),
        role,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
      },
    });
  }

  async updateAdmin(id: string, input: unknown) {
    const body = safeObject(input);
    const role = body.role
      ? (String(body.role).toUpperCase() as AdminRole)
      : undefined;
    if (role && !Object.values(AdminRole).includes(role)) {
      throw new BadRequestException("后台角色不正确");
    }
    return this.prisma.adminUser.update({
      where: { id },
      data: {
        ...(role ? { role } : {}),
        ...(body.active !== undefined ? { active: body.active === true } : {}),
        ...(body.displayName
          ? { displayName: String(body.displayName).trim().slice(0, 50) }
          : {}),
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
      },
    });
  }

  deletionRequests() {
    return this.prisma.accountDeletionRequest.findMany({
      include: {
        user: {
          select: { id: true, compatibilityId: true, mobile: true, nickname: true },
        },
      },
      orderBy: { requestedAt: "desc" },
    }).then((items) =>
      items.map((item) => ({
        ...item,
        user: { ...item.user, mobile: maskMobile(item.user.mobile) },
      })),
    );
  }

  settings() {
    return this.prisma.appSetting.findMany({
      where: { key: { in: ["support", "app_update"] } },
      orderBy: { key: "asc" },
    });
  }

  updateSetting(key: string, input: unknown) {
    if (!["support", "app_update"].includes(key)) {
      throw new NotFoundException("设置项不存在");
    }
    const body = safeObject(input);
    const value = safeObject(body.value);
    if (!Object.keys(value).length) {
      throw new BadRequestException("设置内容不能为空");
    }
    return this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, public: body.public !== false },
      update: { value: value as Prisma.InputJsonValue, public: body.public !== false },
    });
  }
}
