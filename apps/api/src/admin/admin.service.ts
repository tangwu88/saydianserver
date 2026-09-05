import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AdminRole,
  AfterSaleStatus,
  CommerceJobStatus,
  CommerceOrderStatus,
  CouponStatus,
  FeedbackStatus,
  IntegrationState,
  NotificationCampaignStatus,
  NotificationType,
  OutboxStatus,
  PaymentStatus,
  Prisma,
  ProductStatus,
  ReportEntitlementType,
  ReportStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { maskMobile, safeObject } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  async dashboard() {
    const [
      members,
      records,
      care,
      warnings,
      feedback,
      outboxPending,
      products,
      commerceOrders,
      paidCents,
      reports,
      paymentFailures,
    ] =
      await this.prisma.$transaction([
        this.prisma.user.count({ where: { status: "ACTIVE" } }),
        this.prisma.healthRecord.count(),
        this.prisma.careRelationship.count({ where: { status: "ACTIVE" } }),
        this.prisma.healthWarningEvent.count(),
        this.prisma.feedback.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        this.prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
        this.prisma.commerceProduct.count({ where: { localArchived: false } }),
        this.prisma.commerceOrder.count(),
        this.prisma.paymentIntent.aggregate({
          where: { status: PaymentStatus.SUCCEEDED },
          _sum: { amountCents: true },
        }),
        this.prisma.healthReport.count(),
        this.prisma.paymentIntent.count({ where: { status: PaymentStatus.FAILED } }),
      ]);
    return {
      members,
      healthRecords: records,
      activeCare: care,
      warnings,
      openFeedback: feedback,
      outboxPending,
      products,
      commerceOrders,
      paidCents: paidCents._sum.amountCents ?? 0,
      healthReports: reports,
      paymentFailures,
    };
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
    reason: string,
    limitInput = 100,
  ) {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 300) {
      throw new BadRequestException("查看原始健康记录前请填写5至300字的业务原因");
    }
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
        afterJson: { recordCount: records.length, reason: normalizedReason },
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

  async integrations() {
    const rows = await this.prisma.integrationConfig.findMany({
      select: {
        key: true,
        state: true,
        publicConfig: true,
        lastCheckedAt: true,
        lastError: true,
        updatedAt: true,
        secret: { select: { integrationKey: true } },
      },
      orderBy: { key: "asc" },
    });
    return rows.map(({ secret, ...row }) => ({
      ...row,
      hasSecret: Boolean(secret),
      verificationStatus:
        row.state === IntegrationState.DISABLED
          ? "DISABLED"
          : row.state === IntegrationState.CONFIGURED &&
              row.lastCheckedAt &&
              !row.lastError
            ? "VERIFIED"
            : row.state === IntegrationState.CONFIGURED
              ? "PENDING"
              : row.state,
    }));
  }

  async updateIntegration(key: string, input: unknown) {
    const body = safeObject(input);
    if (!/^[a-z0-9_]{2,50}$/.test(key)) {
      throw new BadRequestException("集成项名称不正确");
    }
    const state = String(body.state ?? "UNCONFIGURED").toUpperCase() as IntegrationState;
    if (!Object.values(IntegrationState).includes(state)) {
      throw new BadRequestException("集成状态不正确");
    }
    if (body.secrets !== undefined && body.clearSecrets === true) {
      throw new BadRequestException("不能同时更新并清除密钥");
    }
    const publicConfig = safeObject(body.publicConfig) as Prisma.InputJsonValue;
    await this.prisma.integrationConfig.upsert({
      where: { key },
      create: {
        key,
        state: IntegrationState.UNCONFIGURED,
        publicConfig,
      },
      update: {
        publicConfig,
      },
    });
    if (body.secrets !== undefined) {
      await this.integrationSecrets.save(key, body.secrets);
    }
    if (body.clearSecrets === true) {
      await this.integrationSecrets.remove(key);
    }
    const saved = await this.prisma.integrationConfig.update({
      where: { key },
      data: {
        state,
        publicConfig,
        secretRef: null,
        lastCheckedAt: null,
        lastError: null,
      },
      select: { key: true, state: true, publicConfig: true, updatedAt: true },
    });
    const secret = await this.prisma.integrationSecret.findUnique({
      where: { integrationKey: key },
      select: { integrationKey: true },
    });
    return {
      ...saved,
      hasSecret: Boolean(secret),
      verificationStatus:
        state === IntegrationState.DISABLED
          ? "DISABLED"
          : state === IntegrationState.CONFIGURED
            ? "PENDING"
            : state,
    };
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

  async commerceProducts(search = "", pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    const where: Prisma.CommerceProductWhereInput = {
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { displayName: { contains: search, mode: "insensitive" } },
              { erpItemId: { contains: search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commerceProduct.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          skus: {
            select: {
              id: true,
              erpSkuId: true,
              specification: true,
              salePriceCents: true,
              stock: true,
              enabled: true,
            },
          },
        },
        orderBy: [{ sort: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.commerceProduct.count({ where }),
    ]);
    return { items, total, page, pageSize: 50 };
  }

  async saveCommerceProduct(id: string | undefined, input: unknown) {
    if (!id) {
      throw new BadRequestException("请先从聚水潭同步商品，再维护展示资料");
    }
    const body = safeObject(input);
    const existing = await this.prisma.commerceProduct.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("商品不存在");
    const status = enumValue(
      ProductStatus,
      body.status ?? existing?.status ?? ProductStatus.DRAFT,
      "商品状态",
    );
    const data = {
      displayName: nullableText(body.displayName ?? existing?.displayName),
      subtitle: nullableText(body.subtitle ?? existing?.subtitle),
      brand: nullableText(body.brand ?? existing?.brand),
      coverImage: nullableText(body.coverImage ?? existing?.coverImage),
      gallery: stringList(body.gallery ?? existing?.gallery, 20),
      detailHtml: nullableText(body.detailHtml ?? existing?.detailHtml),
      tags: stringList(body.tags ?? existing?.tags, 30),
      categoryId: nullableText(body.categoryId ?? existing?.categoryId),
      status,
      featured: body.featured === undefined ? existing?.featured ?? false : body.featured === true,
      sort: Math.trunc(Number(body.sort ?? existing?.sort ?? 0)) || 0,
      localArchived:
        body.localArchived === undefined
          ? existing?.localArchived ?? false
          : body.localArchived === true,
    };
    return this.prisma.commerceProduct.update({ where: { id }, data });
  }

  commerceCategories() {
    return this.prisma.commerceCategory.findMany({
      include: { parent: { select: { id: true, name: true } } },
      orderBy: [{ sort: "desc" }, { name: "asc" }],
    });
  }

  async saveCommerceCategory(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const existing = id
      ? await this.prisma.commerceCategory.findUnique({ where: { id } })
      : null;
    const name = String(body.name ?? existing?.name ?? "").trim();
    if (!name) throw new BadRequestException("分类名称不能为空");
    const parentId = nullableText(body.parentId ?? existing?.parentId);
    if (id && parentId === id) throw new BadRequestException("分类不能作为自己的上级");
    const data = {
      name,
      iconUrl: nullableText(body.iconUrl ?? existing?.iconUrl),
      parentId,
      sort: Math.trunc(Number(body.sort ?? existing?.sort ?? 0)) || 0,
      enabled: body.enabled === undefined ? existing?.enabled ?? true : body.enabled === true,
    };
    return id
      ? this.prisma.commerceCategory.update({ where: { id }, data })
      : this.prisma.commerceCategory.create({ data });
  }

  commerceBanners() {
    return this.prisma.commerceBanner.findMany({
      orderBy: [{ sort: "desc" }, { updatedAt: "desc" }],
      take: 500,
    });
  }

  async saveCommerceBanner(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const existing = id
      ? await this.prisma.commerceBanner.findUnique({ where: { id } })
      : null;
    if (id && !existing) throw new NotFoundException("轮播图不存在");
    const title = String(body.title ?? existing?.title ?? "").trim();
    const imageUrl = String(body.imageUrl ?? existing?.imageUrl ?? "").trim();
    if (!title || !imageUrl) {
      throw new BadRequestException("轮播标题和图片地址不能为空");
    }
    const data = {
      title: title.slice(0, 100),
      imageUrl,
      targetUrl: nullableText(body.targetUrl ?? existing?.targetUrl),
      sort: Math.trunc(Number(body.sort ?? existing?.sort ?? 0)) || 0,
      enabled: body.enabled === undefined ? existing?.enabled ?? true : body.enabled === true,
    };
    return id
      ? this.prisma.commerceBanner.update({ where: { id }, data })
      : this.prisma.commerceBanner.create({ data });
  }

  commerceBusinessConfigs() {
    return this.prisma.commerceBusinessConfig.findMany({
      orderBy: { key: "asc" },
    });
  }

  async updateCommerceBusinessConfig(key: string, input: unknown) {
    const body = safeObject(input);
    const label = String(body.label ?? key).trim();
    if (!key.trim() || !label) throw new BadRequestException("配置项不正确");
    const value = body.value === null || body.value === undefined
      ? Prisma.DbNull
      : (body.value as Prisma.InputJsonValue);
    return this.prisma.commerceBusinessConfig.upsert({
      where: { key },
      create: { key, label, value, enabled: body.enabled === true },
      update: {
        ...(body.label !== undefined ? { label } : {}),
        ...(body.value !== undefined ? { value } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled === true } : {}),
      },
    });
  }

  commerceReviews() {
    return this.prisma.commerceReview.findMany({
      include: {
        user: { select: { id: true, nickname: true, mobile: true } },
        product: { select: { id: true, name: true, displayName: true } },
        orderItem: { select: { id: true, orderId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }).then((rows) => rows.map((row) => ({
      ...row,
      user: { ...row.user, mobile: maskMobile(row.user.mobile) },
    })));
  }

  updateCommerceReview(id: string, input: unknown) {
    const body = safeObject(input);
    if (body.published === undefined) {
      throw new BadRequestException("请明确选择是否展示该评价");
    }
    return this.prisma.commerceReview.update({
      where: { id },
      data: { published: body.published === true },
    });
  }

  async commerceOrders(statusInput?: string, pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    const status = statusInput
      ? enumValue(CommerceOrderStatus, statusInput, "订单状态")
      : undefined;
    const where: Prisma.CommerceOrderWhereInput = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commerceOrder.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true, mobile: true } },
          items: true,
          shipments: true,
          paymentIntents: {
            select: { id: true, paymentNo: true, channel: true, status: true, paidAt: true },
          },
          afterSales: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.commerceOrder.count({ where }),
    ]);
    return {
      items: items.map((order) => ({
        ...order,
        recipientMobile: maskMobile(order.recipientMobile),
        user: { ...order.user, mobile: maskMobile(order.user.mobile) },
      })),
      total,
      page,
      pageSize: 50,
    };
  }

  async updateCommerceOrder(id: string, input: unknown) {
    const body = safeObject(input);
    const adminRemark = nullableText(body.adminRemark);
    if (body.status !== undefined) {
      throw new BadRequestException("订单状态由支付、履约或售后流程更新，不能手工改写");
    }
    return this.prisma.commerceOrder.update({
      where: { id },
      data: { adminRemark },
    });
  }

  commerceAfterSales(statusInput?: string) {
    const status = statusInput
      ? enumValue(AfterSaleStatus, statusInput, "售后状态")
      : undefined;
    return this.prisma.commerceAfterSale.findMany({
      where: status ? { status } : {},
      include: {
        order: {
          select: { id: true, orderNo: true, userId: true, payableCents: true },
        },
        refunds: {
          select: { id: true, refundNo: true, status: true, amountCents: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async updateCommerceAfterSale(id: string, input: unknown) {
    const body = safeObject(input);
    const status = enumValue(AfterSaleStatus, body.status, "售后状态");
    const allowed = [
      AfterSaleStatus.REVIEWING,
      AfterSaleStatus.APPROVED,
      AfterSaleStatus.REJECTED,
      AfterSaleStatus.WAITING_RETURN,
      AfterSaleStatus.RETURNED,
      AfterSaleStatus.CANCELLED,
    ] as AfterSaleStatus[];
    if (!allowed.includes(status)) {
      throw new BadRequestException("该售后状态必须由退款回调完成");
    }
    const updated = await this.prisma.commerceAfterSale.update({
      where: { id },
      data: {
        status,
        ...(body.returnLogisticsCompany !== undefined
          ? { returnLogisticsCompany: nullableText(body.returnLogisticsCompany) }
          : {}),
        ...(body.returnTrackingNo !== undefined
          ? { returnTrackingNo: nullableText(body.returnTrackingNo) }
          : {}),
      },
    });
    if (status === AfterSaleStatus.APPROVED) {
      await this.prisma.commerceIntegrationJob.upsert({
        where: { idempotencyKey: `jushuitan-after-sale:${id}` },
        create: {
          type: "JUSHUITAN_AFTER_SALE_PUSH",
          aggregateType: "commerce_after_sale",
          aggregateId: id,
          idempotencyKey: `jushuitan-after-sale:${id}`,
          payload: { afterSaleId: id },
        },
        update: {
          status: CommerceJobStatus.PENDING,
          nextRunAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    }
    return updated;
  }

  commerceCoupons() {
    return this.prisma.commerceCoupon.findMany({
      include: { _count: { select: { claims: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async saveCommerceCoupon(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const existing = id
      ? await this.prisma.commerceCoupon.findUnique({ where: { id } })
      : null;
    const name = String(body.name ?? existing?.name ?? "").trim();
    if (!name) throw new BadRequestException("优惠券名称不能为空");
    const validFrom = dateValue(body.validFrom ?? existing?.validFrom, "生效时间");
    const validUntil = dateValue(body.validUntil ?? existing?.validUntil, "失效时间");
    if (validFrom >= validUntil) throw new BadRequestException("优惠券失效时间必须晚于生效时间");
    const data = {
      name,
      type: "CASH" as const,
      status: enumValue(CouponStatus, body.status ?? existing?.status ?? "DRAFT", "优惠券状态"),
      value: positiveInteger(body.value ?? existing?.value, "优惠金额"),
      minimumSpendCents: nonNegativeInteger(
        body.minimumSpendCents ?? existing?.minimumSpendCents,
        "最低消费金额",
      ),
      totalQuantity:
        body.totalQuantity === null
          ? null
          : positiveInteger(body.totalQuantity ?? existing?.totalQuantity ?? 1, "发行数量"),
      validFrom,
      validUntil,
      employeeDistributable:
        body.employeeDistributable === undefined
          ? existing?.employeeDistributable ?? false
          : body.employeeDistributable === true,
      perEmployeeLimit: nonNegativeInteger(
        body.perEmployeeLimit ?? existing?.perEmployeeLimit ?? 0,
        "员工领取上限",
      ),
    };
    return id
      ? this.prisma.commerceCoupon.update({ where: { id }, data })
      : this.prisma.commerceCoupon.create({ data });
  }

  async commerceEmployees() {
    const employees = await this.prisma.commerceEmployee.findMany({
      include: { wallet: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return employees.map((employee) => ({
      ...employee,
      mobile: maskMobile(employee.mobile),
    }));
  }

  async commerceCommissions() {
    const [plan, accruals, ledger] = await Promise.all([
      this.prisma.commerceCommissionPlan.findUnique({ where: { id: "default" } }),
      this.prisma.commerceCommissionAccrual.findMany({
        include: {
          employee: { select: { id: true, name: true, referralCode: true } },
          order: { select: { id: true, orderNo: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      this.prisma.commerceCommissionLedger.findMany({
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);
    return { plan, items: accruals, ledger, withdrawals: "历史只读档案" };
  }

  commerceJobs(statusInput?: string) {
    const status = statusInput
      ? enumValue(CommerceJobStatus, statusInput, "任务状态")
      : undefined;
    return this.prisma.commerceIntegrationJob.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async retryCommerceJob(id: string) {
    const changed = await this.prisma.commerceIntegrationJob.updateMany({
      where: {
        id,
        status: { in: [CommerceJobStatus.FAILED, CommerceJobStatus.DEAD_LETTER] },
      },
      data: {
        status: CommerceJobStatus.PENDING,
        attempt: 0,
        nextRunAt: new Date(),
        lockedAt: null,
        finishedAt: null,
        lastError: null,
      },
    });
    if (!changed.count) throw new BadRequestException("当前任务不需要重试");
    return this.prisma.commerceIntegrationJob.findUniqueOrThrow({ where: { id } });
  }

  async queueCommerceProductSync(input: unknown) {
    const body = safeObject(input);
    const modifiedEnd = optionalDate(body.modifiedEnd) ?? new Date();
    const modifiedBegin = optionalDate(body.modifiedBegin) ?? new Date(
      modifiedEnd.valueOf() - 24 * 3_600_000,
    );
    if (
      modifiedBegin >= modifiedEnd ||
      modifiedEnd.valueOf() - modifiedBegin.valueOf() > 31 * 86_400_000
    ) {
      throw new BadRequestException("商品同步时间范围应在1到31天内");
    }
    const slot = `${modifiedBegin.toISOString()}:${modifiedEnd.toISOString()}`;
    return this.prisma.commerceIntegrationJob.upsert({
      where: { idempotencyKey: `jushuitan-product-sync:${slot}` },
      create: {
        type: "JUSHUITAN_PRODUCT_SYNC",
        aggregateType: "commerce_catalog",
        idempotencyKey: `jushuitan-product-sync:${slot}`,
        payload: {
          modifiedBegin: modifiedBegin.toISOString(),
          modifiedEnd: modifiedEnd.toISOString(),
        },
      },
      update: {},
    });
  }

  queueCommerceFulfillmentSync() {
    const slot = new Date().toISOString().slice(0, 13);
    return this.prisma.commerceIntegrationJob.upsert({
      where: { idempotencyKey: `jushuitan-fulfillment:${slot}` },
      create: {
        type: "JUSHUITAN_FULFILLMENT_SYNC",
        aggregateType: "commerce_order",
        idempotencyKey: `jushuitan-fulfillment:${slot}`,
        payload: {},
      },
      update: {},
    });
  }

  payments(statusInput?: string, pageInput = 1) {
    const page = Math.max(Number(pageInput) || 1, 1);
    const status = statusInput
      ? enumValue(PaymentStatus, statusInput, "支付状态")
      : undefined;
    return this.prisma.paymentIntent.findMany({
      where: status ? { status } : {},
      select: {
        id: true,
        paymentNo: true,
        userId: true,
        businessType: true,
        businessId: true,
        channel: true,
        status: true,
        amountCents: true,
        currency: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 100,
      take: 100,
    });
  }

  healthReports(statusInput?: string) {
    const status = statusInput
      ? enumValue(ReportStatus, statusInput, "报告状态")
      : undefined;
    return this.prisma.healthReport.findMany({
      where: status ? { status } : {},
      select: {
        id: true,
        userId: true,
        status: true,
        windowStart: true,
        windowEnd: true,
        distinctDays: true,
        validRecordCount: true,
        templateVersion: true,
        aiGenerated: true,
        aiProvider: true,
        aiModel: true,
        generationAttempts: true,
        failureReason: true,
        generatedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async retryHealthReport(id: string) {
    const report = await this.prisma.healthReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException("健康报告不存在");
    if (report.status !== ReportStatus.FAILED) {
      throw new BadRequestException("当前报告不需要重试");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.healthReport.update({
        where: { id },
        data: { status: ReportStatus.QUEUED, failureReason: null },
      });
      await tx.outboxEvent.upsert({
        where: { eventId: `health-report-generate:${id}` },
        create: {
          eventId: `health-report-generate:${id}`,
          eventType: "health_report_generate",
          aggregateType: "health_report",
          aggregateId: id,
          payload: { userId: report.userId, reportId: id },
        },
        update: {
          status: OutboxStatus.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    });
    return this.prisma.healthReport.findUniqueOrThrow({ where: { id } });
  }

  healthReportOffers() {
    return this.prisma.healthReportOffer.findMany({
      orderBy: [{ offerKey: "asc" }, { version: "desc" }],
    });
  }

  async saveHealthReportOffer(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const previous = id
      ? await this.prisma.healthReportOffer.findUnique({ where: { id } })
      : null;
    if (id && !previous) throw new NotFoundException("报告方案不存在");
    const offerKey = String(body.offerKey ?? previous?.offerKey ?? "").trim();
    const title = String(body.title ?? previous?.title ?? "").trim();
    const description = String(body.description ?? previous?.description ?? "").trim();
    if (!/^[a-z0-9-]{3,60}$/.test(offerKey) || !title || !description) {
      throw new BadRequestException("方案标识、标题或说明不正确");
    }
    const entitlement = enumValue(
      ReportEntitlementType,
      body.entitlement ?? previous?.entitlement,
      "权益类型",
    );
    const priceCents = positiveInteger(body.priceCents ?? previous?.priceCents, "价格");
    const creditCount = positiveInteger(body.creditCount ?? previous?.creditCount, "报告次数");
    const durationDays =
      entitlement === ReportEntitlementType.MEMBERSHIP
        ? positiveInteger(body.durationDays ?? previous?.durationDays ?? 30, "有效天数")
        : null;
    const platforms = stringList(body.platforms ?? previous?.platforms, 8).filter((item) =>
      ["android", "ios", "h5", "mini_program", "web"].includes(item),
    );
    if (!platforms.length) throw new BadRequestException("请至少选择一个客户端平台");
    const latest = await this.prisma.healthReportOffer.findFirst({
      where: { offerKey },
      orderBy: { version: "desc" },
    });
    const version = previous ? Math.max(previous.version + 1, (latest?.version ?? 0) + 1) : 1;
    const active = body.active === true;
    return this.prisma.$transaction(async (tx) => {
      if (previous) {
        await tx.healthReportOffer.update({
          where: { id: previous.id },
          data: { active: false },
        });
      }
      if (active) {
        await tx.healthReportOffer.updateMany({
          where: { offerKey },
          data: { active: false },
        });
      }
      return tx.healthReportOffer.create({
        data: {
          code: `${offerKey}-v${version}`,
          offerKey,
          title,
          description,
          entitlement,
          priceCents,
          currency: String(body.currency ?? previous?.currency ?? "CNY").toUpperCase(),
          creditCount,
          durationDays,
          platforms,
          appleProductId: nullableText(body.appleProductId ?? previous?.appleProductId),
          version,
          active,
          effectiveFrom: optionalDate(body.effectiveFrom ?? previous?.effectiveFrom),
          effectiveUntil: optionalDate(body.effectiveUntil ?? previous?.effectiveUntil),
        },
      });
    });
  }

  notificationCampaigns() {
    return this.prisma.notificationCampaign.findMany({
      include: { _count: { select: { deliveries: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async saveNotificationCampaign(
    adminId: string,
    id: string | undefined,
    input: unknown,
  ) {
    const body = safeObject(input);
    const previous = id
      ? await this.prisma.notificationCampaign.findUnique({ where: { id } })
      : null;
    if (previous && previous.status !== NotificationCampaignStatus.DRAFT) {
      throw new BadRequestException("只有草稿通知可以修改");
    }
    const name = String(body.name ?? previous?.name ?? "").trim();
    const title = String(body.title ?? previous?.title ?? "").trim();
    const content = String(body.body ?? previous?.body ?? "").trim();
    if (!name || !title || !content) throw new BadRequestException("通知名称、标题和内容不能为空");
    if (body.transactional === true) {
      throw new BadRequestException("事务通知由业务事件发送，不能通过群发入口创建");
    }
    const audience = safeObject(body.audience ?? previous?.audience ?? {});
    if (audience.allActive !== true && !Array.isArray(audience.userIds)) {
      throw new BadRequestException("请选择通知对象");
    }
    const data = {
      name,
      type: enumValue(NotificationType, body.type ?? previous?.type ?? "SYSTEM", "通知类型"),
      title,
      body: content,
      deepLink: nullableText(body.deepLink ?? previous?.deepLink),
      audience: audience as Prisma.InputJsonValue,
      transactional: false,
      scheduledAt: optionalDate(body.scheduledAt ?? previous?.scheduledAt),
    };
    return id
      ? this.prisma.notificationCampaign.update({ where: { id }, data })
      : this.prisma.notificationCampaign.create({
          data: { ...data, createdById: adminId },
        });
  }

  async scheduleNotificationCampaign(id: string) {
    const campaign = await this.prisma.notificationCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("通知任务不存在");
    if (campaign.status !== NotificationCampaignStatus.DRAFT) {
      throw new BadRequestException("当前通知任务不能重复安排");
    }
    const scheduledAt = campaign.scheduledAt ?? new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.notificationCampaign.update({
        where: { id },
        data: { status: NotificationCampaignStatus.SCHEDULED, scheduledAt },
      });
      await tx.outboxEvent.create({
        data: {
          eventId: `notification-campaign:${id}`,
          eventType: "notification_campaign_dispatch",
          aggregateType: "notification_campaign",
          aggregateId: id,
          payload: { campaignId: id },
          nextAttemptAt: scheduledAt,
        },
      });
      return updated;
    });
  }
}

function enumValue<T extends Record<string, string>>(
  values: T,
  input: unknown,
  label: string,
): T[keyof T] {
  const value = String(input ?? "").trim().toUpperCase();
  if (!Object.values(values).includes(value)) {
    throw new BadRequestException(`${label}不正确`);
  }
  return value as T[keyof T];
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function stringList(value: unknown, maximum: number): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，\n]/)
      : [];
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].slice(
    0,
    maximum,
  );
}

function dateValue(value: unknown, label: string): Date {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(date.valueOf())) throw new BadRequestException(`${label}不正确`);
  return date;
}

function optionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  return dateValue(value, "时间");
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new BadRequestException(`${label}必须是正整数`);
  }
  return number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) {
    throw new BadRequestException(`${label}必须是非负整数`);
  }
  return number;
}
