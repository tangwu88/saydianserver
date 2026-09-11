import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AdminRole, AfterSaleStatus, BusinessType, CommerceJobStatus, CommerceOrderStatus, CouponStatus, FeedbackStatus, Gender, IntegrationState, NotificationCampaignStatus, NotificationType, OutboxStatus, PaymentChannel, PaymentStatus, Prisma, ProductStatus, ReportEntitlementType, ReportStatus, UserStatus } from "@prisma/client";
import { hash } from "bcryptjs";
import { parseDownloadManifest } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { isUuid, maskMobile, safeObject, sha256 } from "../common/crypto";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { isGlobalRealm } from "../common/deployment-realm";
import { globalLocale, internationalPhone, maskedIdentifier, normalizedEmail } from "../auth/global-identity";
import { randomUUID } from "node:crypto";
import { afterSaleTransitions, assertAfterSaleTransition, expectedVersion, integerCents, requireCommerceOwner } from "../commerce/commerce-policy";
import { parseLegacyAppUpdate } from "../legacy/legacy-update-contract";
import { onCommerceOrderPaid, orderFulfillmentState, priceOrder, shippingRefundCapacity } from "../commerce/commerce-finance";
import { createLocalShipment, localFulfillmentPreview } from "./local-fulfillment";
import { protectLastSuperAdmin } from "./admin-account-policy";
import { parseGlobalDownloadManifest } from "../support/global-download-manifest";
import { withCategoryNumbers } from "./article-category-number";

const adminOrderPaymentSelect = {
  id: true,
  paymentNo: true,
  channel: true,
  status: true,
  amountCents: true,
  currency: true,
  description: true,
  providerTransactionId: true,
  paidAt: true,
  createdAt: true,
} satisfies Prisma.PaymentIntentSelect;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationSecrets: IntegrationSecretsService,
  ) {}

  private assertGlobalMemberAdministrator(current: { role: string; roles?: string[] }) {
    const roles = current.roles?.length ? current.roles : [current.role];
    if (!roles.includes(AdminRole.SUPER_ADMIN)) {
      throw new ForbiddenException("只有超级管理员可以编辑会员资料与验证状态");
    }
    if (!isGlobalRealm()) {
      throw new ForbiddenException("会员资料编辑仅用于国际版新会员系统");
    }
  }

  private memberProfileFields(item: { id: string; compatibilityId: number; mobile: string | null; mobileVerifiedAt: Date | null; email: string | null; emailVerifiedAt: Date | null; nickname: string; avatarUrl: string | null; gender: Gender; birthday: Date | null; heightCm: { toNumber(): number } | null; weightKg: { toNumber(): number } | null; status: UserStatus; updatedAt: Date }) {
    return {
      id: item.id,
      memberNo: String(item.compatibilityId),
      mobile: item.mobile,
      mobileVerified: Boolean(item.mobile && item.mobileVerifiedAt),
      mobileVerifiedAt: item.mobile && item.mobileVerifiedAt ? item.mobileVerifiedAt.toISOString() : null,
      email: item.email,
      emailVerified: Boolean(item.email && item.emailVerifiedAt),
      emailVerifiedAt: item.email && item.emailVerifiedAt ? item.emailVerifiedAt.toISOString() : null,
      nickname: item.nickname,
      avatarUrl: item.avatarUrl,
      gender: item.gender,
      birthday: item.birthday?.toISOString().slice(0, 10) ?? null,
      heightCm: item.heightCm?.toNumber() ?? null,
      weightKg: item.weightKg?.toNumber() ?? null,
      status: item.status,
      verificationVersion: item.updatedAt.toISOString(),
    };
  }

  private memberVerificationFields(item: { id: string; compatibilityId: number; mobile: string | null; mobileVerifiedAt: Date | null; email: string | null; emailVerifiedAt: Date | null; updatedAt: Date }) {
    const mobileVerified = Boolean(item.mobile && item.mobileVerifiedAt);
    const emailVerified = Boolean(item.email && item.emailVerifiedAt);
    return {
      id: item.id,
      memberNo: String(item.compatibilityId),
      mobileMasked: isGlobalRealm() && item.mobile ? maskedIdentifier("sms", item.mobile) : maskMobile(item.mobile),
      mobileVerified,
      mobileVerificationStatus: !item.mobile ? "NOT_PROVIDED" : mobileVerified ? "VERIFIED" : "UNVERIFIED",
      mobileVerifiedAt: mobileVerified ? item.mobileVerifiedAt!.toISOString() : null,
      ...(isGlobalRealm()
        ? {
            emailMasked: item.email ? maskedIdentifier("email", item.email) : null,
            emailVerified,
            emailVerificationStatus: !item.email ? "NOT_PROVIDED" : emailVerified ? "VERIFIED" : "UNVERIFIED",
            emailVerifiedAt: emailVerified ? item.emailVerifiedAt!.toISOString() : null,
          }
        : {}),
      verificationVersion: item.updatedAt.toISOString(),
    };
  }

  async dashboard() {
    const [members, records, care, warnings, feedback, outboxPending, products, commerceOrders, paidCents, reports, paymentFailures] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { status: "ACTIVE" } }),
      this.prisma.healthRecord.count(),
      this.prisma.careRelationship.count({ where: { status: "ACTIVE" } }),
      this.prisma.healthWarningEvent.count(),
      this.prisma.feedback.count({
        where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      }),
      this.prisma.outboxEvent.count({
        where: { status: { in: ["PENDING", "FAILED"] } },
      }),
      this.prisma.commerceProduct.count({ where: { localArchived: false } }),
      this.prisma.commerceOrder.count(),
      this.prisma.paymentIntent.aggregate({
        where: { status: PaymentStatus.SUCCEEDED },
        _sum: { amountCents: true },
      }),
      this.prisma.healthReport.count(),
      this.prisma.paymentIntent.count({
        where: { status: PaymentStatus.FAILED },
      }),
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
    search = search.trim();
    const page = Math.min(Math.max(Math.trunc(Number(pageInput)) || 1, 1), 1_000_000);
    const pageSize = Math.min(Math.max(Math.trunc(Number(pageSizeInput)) || 30, 1), 100);
    const memberNo = /^[1-9]\d{0,9}$/.test(search) && Number(search) <= 2_147_483_647 ? Number(search) : null;
    const where = search
      ? {
          OR: [{ nickname: { contains: search, mode: "insensitive" as const } }, { mobile: { contains: search } }, { legacyMemberId: { contains: search } }, ...(isGlobalRealm() ? [{ email: { contains: search, mode: "insensitive" as const } }] : []), ...(memberNo !== null ? [{ compatibilityId: memberNo }] : [])],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { healthRecords: true, devices: true } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...this.memberVerificationFields(item),
        legacyMemberId: item.legacyMemberId,
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

  async memberProfile(current: { id: string; role: string; roles?: string[] }, userId: string, requestId: string) {
    this.assertGlobalMemberAdministrator(current);
    if (!isUuid(userId)) throw new BadRequestException("会员编号无效");
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          compatibilityId: true,
          mobile: true,
          mobileVerifiedAt: true,
          email: true,
          emailVerifiedAt: true,
          nickname: true,
          avatarUrl: true,
          gender: true,
          birthday: true,
          heightCm: true,
          weightKg: true,
          status: true,
          updatedAt: true,
        },
      });
      if (!user) throw new NotFoundException("会员不存在");
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: current.id,
          action: "MEMBER_PROFILE_READ",
          entityType: "USER_PROFILE",
          entityId: userId,
          requestId,
          afterJson: {
            mobilePresent: Boolean(user.mobile),
            emailPresent: Boolean(user.email),
            fields: ["nickname", "avatarUrl", "gender", "birthday", "heightCm", "weightKg", "mobile", "email", "status", "verification"],
          },
        },
      });
      return this.memberProfileFields(user);
    });
  }

  async updateMemberProfile(current: { id: string; role: string; roles?: string[] }, userId: string, requestId: string, input: Record<string, unknown>) {
    this.assertGlobalMemberAdministrator(current);
    if (!isUuid(userId)) throw new BadRequestException("会员编号无效");
    const allowedFields = new Set(["nickname", "avatarUrl", "gender", "birthday", "heightCm", "weightKg", "mobile", "email", "status", "mobileVerified", "emailVerified", "newPassword", "expectedUpdatedAt"]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      throw new BadRequestException("会员资料包含不支持的字段");
    }
    const nickname = String(input.nickname ?? "").trim();
    if (!nickname || nickname.length > 40) throw new BadRequestException("昵称须为1至40个字符");
    const newPassword = String(input.newPassword ?? "");
    if (newPassword && (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72)) {
      throw new BadRequestException("新密码须至少8位且不能超过72字节");
    }
    const newPasswordHash = newPassword ? await hash(newPassword, 12) : undefined;

    const hasField = (field: string) => Object.prototype.hasOwnProperty.call(input, field);
    const avatarUrlInput = hasField("avatarUrl") ? String(input.avatarUrl ?? "").trim() || null : undefined;
    if (avatarUrlInput && !/^https?:\/\//i.test(avatarUrlInput)) {
      throw new BadRequestException("头像地址不正确，请填写HTTP或HTTPS图片地址");
    }
    const genderInput = hasField("gender") ? String(input.gender ?? "") : undefined;
    if (genderInput !== undefined && ![Gender.MALE, Gender.FEMALE, Gender.UNSPECIFIED].includes(genderInput as Gender)) {
      throw new BadRequestException("性别选项不正确");
    }
    let birthdayInput: Date | null | undefined;
    if (hasField("birthday")) {
      const birthdayText = String(input.birthday ?? "").trim();
      birthdayInput = null;
      if (birthdayText) {
        const birthday = new Date(`${birthdayText}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdayText) || Number.isNaN(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== birthdayText || birthday >= new Date()) {
          throw new BadRequestException("出生日期不正确");
        }
        birthdayInput = birthday;
      }
    }
    const optionalProfileNumber = (field: "heightCm" | "weightKg", min: number, max: number, label: string) => {
      if (!hasField(field)) return undefined;
      const raw = input[field];
      if (raw === null || String(raw).trim() === "") return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < min || value > max) {
        throw new BadRequestException(`${label}须在${min}至${max}之间`);
      }
      return value;
    };
    const heightCmInput = optionalProfileNumber("heightCm", 50, 250, "身高");
    const weightKgInput = optionalProfileNumber("weightKg", 10, 500, "体重");

    const mobileInput = String(input.mobile ?? "").trim();
    const emailInput = String(input.email ?? "").trim();
    const mobile = mobileInput ? (internationalPhone(mobileInput)?.identifier ?? "") : null;
    const email = emailInput ? normalizedEmail(emailInput) : null;
    if (mobileInput && !mobile) throw new BadRequestException("手机号格式不正确，请填写带国家区号的号码");
    if (emailInput && !email) throw new BadRequestException("邮箱地址格式不正确");
    if (!mobile && !email) throw new BadRequestException("手机号和邮箱至少保留一项");
    if (typeof input.mobileVerified !== "boolean" || typeof input.emailVerified !== "boolean") {
      throw new BadRequestException("请明确设置手机号和邮箱的验证状态");
    }
    if (!mobile && input.mobileVerified) throw new BadRequestException("未填写手机号时不能设为已验证");
    if (!email && input.emailVerified) throw new BadRequestException("未填写邮箱时不能设为已验证");
    const status = String(input.status ?? "");
    if (status !== UserStatus.ACTIVE && status !== UserStatus.DISABLED) {
      throw new BadRequestException("账号状态只能设为正常或停用");
    }
    const expectedUpdatedAt = new Date(String(input.expectedUpdatedAt ?? ""));
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new BadRequestException("会员数据版本无效，请刷新后重试");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            compatibilityId: true,
            mobile: true,
            mobileVerifiedAt: true,
            email: true,
            emailVerifiedAt: true,
            nickname: true,
            avatarUrl: true,
            gender: true,
            birthday: true,
            heightCm: true,
            weightKg: true,
            status: true,
            updatedAt: true,
          },
        });
        if (!user) throw new NotFoundException("会员不存在");
        if (user.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new ConflictException("会员信息已发生变化，请刷新后重试");
        }
        if (user.status === UserStatus.DELETION_PENDING || user.status === UserStatus.DELETED) {
          throw new ConflictException("注销流程中的会员不能手工编辑");
        }
        const conflict = await tx.user.findFirst({
          where: {
            id: { not: userId },
            OR: [...(mobile ? [{ mobile }] : []), ...(email ? [{ email }] : [])],
          },
          select: { id: true },
        });
        if (conflict) throw new ConflictException("手机号或邮箱已被其他会员使用");

        const changedAt = new Date();
        const mobileChanged = user.mobile !== mobile;
        const emailChanged = user.email !== email;
        const nextMobileVerifiedAt = mobile && input.mobileVerified ? (!mobileChanged && user.mobileVerifiedAt ? user.mobileVerifiedAt : changedAt) : null;
        const nextEmailVerifiedAt = email && input.emailVerified ? (!emailChanged && user.emailVerifiedAt ? user.emailVerifiedAt : changedAt) : null;
        const verificationChanged = Boolean(user.mobileVerifiedAt) !== Boolean(nextMobileVerifiedAt) || Boolean(user.emailVerifiedAt) !== Boolean(nextEmailVerifiedAt);
        const statusChanged = user.status !== status;
        const passwordChanged = Boolean(newPasswordHash);
        const avatarUrl = avatarUrlInput === undefined ? user.avatarUrl : avatarUrlInput;
        const gender = genderInput === undefined ? user.gender : (genderInput as Gender);
        const birthday = birthdayInput === undefined ? user.birthday : birthdayInput;
        const heightCm = heightCmInput === undefined ? user.heightCm : heightCmInput === null ? null : new Prisma.Decimal(heightCmInput);
        const weightKg = weightKgInput === undefined ? user.weightKg : weightKgInput === null ? null : new Prisma.Decimal(weightKgInput);
        const profileFieldsChanged = [...(user.nickname !== nickname ? ["nickname"] : []), ...(user.avatarUrl !== avatarUrl ? ["avatarUrl"] : []), ...(user.gender !== gender ? ["gender"] : []), ...((user.birthday?.toISOString().slice(0, 10) ?? null) !== (birthday?.toISOString().slice(0, 10) ?? null) ? ["birthday"] : []), ...((user.heightCm?.toNumber() ?? null) !== (heightCm?.toNumber() ?? null) ? ["heightCm"] : []), ...((user.weightKg?.toNumber() ?? null) !== (weightKg?.toNumber() ?? null) ? ["weightKg"] : [])];
        if (!mobileChanged && !emailChanged && !verificationChanged && !statusChanged && !passwordChanged && !profileFieldsChanged.length) {
          return this.memberProfileFields(user);
        }

        const result = await tx.user.updateMany({
          where: { id: userId, updatedAt: expectedUpdatedAt },
          data: {
            nickname,
            avatarUrl,
            gender,
            birthday,
            heightCm,
            weightKg,
            mobile,
            mobileVerifiedAt: nextMobileVerifiedAt,
            email,
            emailVerifiedAt: nextEmailVerifiedAt,
            status: status as UserStatus,
            ...(newPasswordHash ? { passwordHash: newPasswordHash } : {}),
            updatedAt: changedAt,
          },
        });
        if (result.count !== 1) throw new ConflictException("会员信息已发生变化，请刷新后重试");
        if (mobileChanged || emailChanged || verificationChanged || statusChanged || passwordChanged) {
          await tx.userSession.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: changedAt },
          });
        }
        await tx.auditLog.create({
          data: {
            actorType: "ADMIN",
            actorId: current.id,
            action: "MEMBER_PROFILE_UPDATE",
            entityType: "USER_PROFILE",
            entityId: userId,
            requestId,
            beforeJson: {
              mobilePresent: Boolean(user.mobile),
              mobileVerified: Boolean(user.mobileVerifiedAt),
              emailPresent: Boolean(user.email),
              emailVerified: Boolean(user.emailVerifiedAt),
              status: user.status,
              profileFieldsChanged,
              passwordChanged: false,
            },
            afterJson: {
              mobilePresent: Boolean(mobile),
              mobileVerified: Boolean(nextMobileVerifiedAt),
              mobileChanged,
              emailPresent: Boolean(email),
              emailVerified: Boolean(nextEmailVerifiedAt),
              emailChanged,
              status,
              profileFieldsChanged,
              passwordChanged,
              source: "SUPER_ADMIN_PROFILE_EDITOR",
            },
          },
        });
        return this.memberProfileFields({
          ...user,
          nickname,
          avatarUrl,
          gender,
          birthday,
          heightCm,
          weightKg,
          mobile,
          mobileVerifiedAt: nextMobileVerifiedAt,
          email,
          emailVerifiedAt: nextEmailVerifiedAt,
          status: status as UserStatus,
          updatedAt: changedAt,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("手机号或邮箱已被其他会员使用");
      }
      throw error;
    }
  }

  async updateMemberVerification(current: { id: string; role: string; roles?: string[] }, userId: string, requestId: string, input: Record<string, unknown>) {
    this.assertGlobalMemberAdministrator(current);
    const channel = String(input.channel ?? "").trim();
    if (channel !== "mobile" && channel !== "email") {
      throw new BadRequestException("验证类型必须是手机号或邮箱");
    }
    if (typeof input.verified !== "boolean") {
      throw new BadRequestException("请明确选择确认或撤销确认");
    }
    const expectedUpdatedAt = new Date(String(input.expectedUpdatedAt ?? ""));
    if (Number.isNaN(expectedUpdatedAt.getTime())) {
      throw new BadRequestException("会员数据版本无效，请刷新后重试");
    }
    const verified = input.verified;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          compatibilityId: true,
          mobile: true,
          mobileVerifiedAt: true,
          email: true,
          emailVerifiedAt: true,
          updatedAt: true,
        },
      });
      if (!user) throw new NotFoundException("会员不存在");
      if (user.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("会员信息已发生变化，请刷新后重试");
      }
      const contact = channel === "mobile" ? user.mobile : user.email;
      if (!contact) throw new BadRequestException(channel === "mobile" ? "该会员尚未填写手机号" : "该会员尚未填写邮箱");
      const verifiedField = channel === "mobile" ? "mobileVerifiedAt" : "emailVerifiedAt";
      const previouslyVerifiedAt = channel === "mobile" ? user.mobileVerifiedAt : user.emailVerifiedAt;
      if (Boolean(previouslyVerifiedAt) === verified) return this.memberVerificationFields(user);

      const changedAt = new Date();
      const nextVerifiedAt = verified ? changedAt : null;
      const result = await tx.user.updateMany({
        where: { id: userId, updatedAt: expectedUpdatedAt },
        data: { [verifiedField]: nextVerifiedAt, updatedAt: changedAt },
      });
      if (result.count !== 1) throw new ConflictException("会员信息已发生变化，请刷新后重试");
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: current.id,
          action: "MANUAL_CONTACT_VERIFICATION_UPDATE",
          entityType: "USER_CONTACT_VERIFICATION",
          entityId: userId,
          requestId,
          beforeJson: {
            channel,
            verified: Boolean(previouslyVerifiedAt),
            verifiedAt: previouslyVerifiedAt?.toISOString() ?? null,
          },
          afterJson: {
            channel,
            verified,
            verifiedAt: nextVerifiedAt?.toISOString() ?? null,
            source: "SUPER_ADMIN_MANUAL",
          },
        },
      });
      return this.memberVerificationFields({
        ...user,
        [verifiedField]: nextVerifiedAt,
        updatedAt: changedAt,
      });
    });
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

  async rawHealth(current: { id: string; role: string; roles?: string[] }, userId: string, requestId: string, reason: string, limitInput = 100) {
    // Roles come from AdminAuthGuard's current database session, never query params.
    const roles = current.roles?.length ? current.roles : [current.role];
    if (!roles.some((role) => role === AdminRole.SUPER_ADMIN || role === AdminRole.HEALTH_AUDITOR)) {
      throw new ForbiddenException("当前账号无权查看原始健康记录");
    }
    const normalizedReason = reason.trim();
    const reasonExempt = isGlobalRealm() && roles.includes(AdminRole.SUPER_ADMIN) && !normalizedReason;
    if (!reasonExempt && (normalizedReason.length < 5 || normalizedReason.length > 300)) {
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
        actorId: current.id,
        action: "HEALTH_RAW_READ",
        entityType: "USER",
        entityId: userId,
        requestId,
        afterJson: {
          recordCount: records.length,
          reason: reasonExempt ? "超级管理员直接查看（免填原因）" : normalizedReason,
          ...(isGlobalRealm()
            ? {
                reasonSource: reasonExempt ? "SUPER_ADMIN_EXEMPTION" : "PROVIDED",
              }
            : {}),
        },
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

  async feedback(status?: string) {
    const normalized = status?.toUpperCase() as FeedbackStatus | undefined;
    const rows = await this.prisma.feedback.findMany({
      where: normalized && Object.values(FeedbackStatus).includes(normalized) ? { status: normalized } : {},
      include: { user: { select: { compatibilityId: true, nickname: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return rows.map(({ user, ...row }) => ({
      ...row,
      memberNo: user ? String(user.compatibilityId) : null,
      memberNickname: user?.nickname ?? null,
    }));
  }

  async updateFeedback(id: string, input: unknown, current: { id: string }) {
    const body = safeObject(input);
    if (Object.keys(body).some(field => !["status", "assignedTo", "replyContent"].includes(field))) {
      throw new BadRequestException("反馈处理包含不支持的字段");
    }
    const status = String(body.status ?? "").toUpperCase() as FeedbackStatus;
    if (!Object.values(FeedbackStatus).includes(status)) {
      throw new BadRequestException("反馈状态不正确");
    }
    const hasReply = Object.prototype.hasOwnProperty.call(body, "replyContent");
    const replyContent = hasReply ? String(body.replyContent ?? "").replace(/[\u0000-\u001f]+/g, " ").trim() : "";
    if (hasReply && (replyContent.length < 2 || replyContent.length > 2_000)) {
      throw new BadRequestException("回复内容需为2至2000字");
    }
    return this.prisma.feedback.update({
      where: { id },
      data: {
        status,
        ...(Object.prototype.hasOwnProperty.call(body, "assignedTo") ? { assignedTo: body.assignedTo ? String(body.assignedTo) : null } : {}),
        ...(hasReply ? { replyContent, repliedAt: new Date(), repliedBy: current.id } : {}),
      },
    });
  }

  articles() {
    return this.prisma.article.findMany({
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    });
  }

  async articleCategories() {
    const categories = await this.prisma.articleCategory.findMany({
      orderBy: [{ sort: "desc" }, { name: "asc" }],
    });
    return isGlobalRealm() ? withCategoryNumbers(this.prisma, categories) : categories;
  }

  async saveArticleCategory(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 80) {
      throw new BadRequestException("分类名称不正确");
    }
    const data = {
      name,
      ...(isGlobalRealm() ? { locale: globalLocale(body.locale) } : {}),
      parentId: body.parentId ? String(body.parentId) : null,
      sort: Math.trunc(Number(body.sort ?? 0)) || 0,
      enabled: body.enabled !== false,
    };
    if (id && data.parentId === id) {
      throw new BadRequestException("分类不能作为自己的上级");
    }
    if (isGlobalRealm()) {
      return this.prisma.$transaction(async (tx) => {
        const category = id ? await tx.articleCategory.update({ where: { id }, data }) : await tx.articleCategory.create({ data });
        return (await withCategoryNumbers(tx, [category]))[0]!;
      });
    }
    return id ? this.prisma.articleCategory.update({ where: { id }, data }) : this.prisma.articleCategory.create({ data });
  }

  async saveArticle(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const title = String(body.title ?? "").trim();
    const contentHtml = String(body.contentHtml ?? body.content ?? "").trim();
    if (!title || !contentHtml) throw new BadRequestException("文章标题和正文不能为空");
    const data = {
      title,
      contentHtml,
      ...(isGlobalRealm() ? { locale: globalLocale(body.locale) } : {}),
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
    return id ? this.prisma.article.update({ where: { id }, data }) : this.prisma.article.create({ data });
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
      verificationStatus: row.state === IntegrationState.DISABLED ? "DISABLED" : row.state === IntegrationState.CONFIGURED && row.lastCheckedAt && !row.lastError ? "VERIFIED" : row.state === IntegrationState.CONFIGURED ? "PENDING" : row.state,
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
      verificationStatus: state === IntegrationState.DISABLED ? "DISABLED" : state === IntegrationState.CONFIGURED ? "PENDING" : state,
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
    if (isGlobalRealm())
      return this.prisma.globalLegalDocument.findMany({
        orderBy: [{ locale: "asc" }, { documentType: "asc" }, { publishedAt: "desc" }],
      });
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
      publishedAt: body.publishedAt ? new Date(String(body.publishedAt)) : new Date(),
    };
    if (!data.documentType || !data.version || !data.title || !data.contentHtml) {
      throw new BadRequestException("协议内容不完整");
    }
    if (Number.isNaN(data.publishedAt.valueOf())) {
      throw new BadRequestException("协议发布时间不正确");
    }
    if (isGlobalRealm()) {
      const locale = globalLocale(body.locale);
      const reviewed = body.reviewed === true;
      if (data.active && !reviewed) throw new BadRequestException("Review the global document before publishing it.");
      if (!["user_agreement", "privacy_policy", "health_ai_analysis"].includes(data.documentType)) throw new BadRequestException("Unsupported global legal document type.");
      return this.prisma.$transaction(async (tx) => {
        if (data.active)
          await tx.globalLegalDocument.updateMany({
            where: {
              documentType: data.documentType,
              locale,
              ...(id ? { id: { not: id } } : {}),
            },
            data: { active: false },
          });
        return id
          ? tx.globalLegalDocument.update({
              where: { id },
              data: { ...data, locale, reviewed },
            })
          : tx.globalLegalDocument.create({
              data: { ...data, locale, reviewed },
            });
      });
    }
    return this.prisma.$transaction(async (tx) => {
      if (data.active) {
        await tx.legalDocument.updateMany({
          where: {
            documentType: data.documentType,
            ...(id ? { id: { not: id } } : {}),
          },
          data: { active: false },
        });
      }
      return id ? tx.legalDocument.update({ where: { id }, data }) : tx.legalDocument.create({ data });
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
        roles: true,
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
    const roles = normalizeAdminRoles(body.roles ?? [body.role ?? "READ_ONLY"]);
    const role = roles[0]!;
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
        roles,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        roles: true,
        active: true,
      },
    });
  }

  async updateAdmin(id: string, input: unknown) {
    const body = safeObject(input);
    if (body.active !== undefined && typeof body.active !== "boolean") throw new BadRequestException("启用状态必须为布尔值");
    const roles = body.roles !== undefined || body.role !== undefined ? normalizeAdminRoles(body.roles ?? [body.role]) : undefined;
    const role = roles?.[0];
    return this.prisma.$transaction(async (tx) => {
      await protectLastSuperAdmin(tx, id, {
        ...(roles ? { roles } : {}),
        ...(body.active !== undefined ? { active: body.active as boolean } : {}),
      });
      return tx.adminUser.update({
        where: { id },
        data: {
          ...(role ? { role, roles } : {}),
          ...(body.active !== undefined ? { active: body.active === true } : {}),
          ...(body.displayName ? { displayName: String(body.displayName).trim().slice(0, 50) } : {}),
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          roles: true,
          active: true,
        },
      });
    });
  }

  deletionRequests() {
    return this.prisma.accountDeletionRequest
      .findMany({
        include: {
          user: {
            select: {
              id: true,
              compatibilityId: true,
              mobile: true,
              nickname: true,
            },
          },
        },
        orderBy: { requestedAt: "desc" },
      })
      .then((items) =>
        items.map((item) => ({
          ...item,
          user: { ...item.user, mobile: maskMobile(item.user.mobile) },
        })),
      );
  }

  settings() {
    return this.prisma.appSetting.findMany({
      where: {
        key: {
          in: isGlobalRealm() ? ["global_support", "global_app_update"] : ["support", "app_update", "legacy_app_update"],
        },
      },
      orderBy: { key: "asc" },
    });
  }

  updateSetting(key: string, input: unknown) {
    const allowedKeys = isGlobalRealm() ? ["global_support", "global_app_update"] : ["support", "app_update", "legacy_app_update"];
    if (!allowedKeys.includes(key)) {
      throw new NotFoundException("设置项不存在");
    }
    const body = safeObject(input);
    let value = safeObject(body.value);
    if (!Object.keys(value).length) {
      throw new BadRequestException("设置内容不能为空");
    }
    if (key === "app_update" || key === "global_app_update") {
      try {
        value = (key === "global_app_update" ? parseGlobalDownloadManifest(value) : parseDownloadManifest(value)) as unknown as Record<string, unknown>;
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : "App 下载配置无效");
      }
    }
    if (key === "legacy_app_update") value = parseLegacyAppUpdate(value) as unknown as Record<string, unknown>;
    return this.prisma.appSetting.upsert({
      where: { key },
      create: {
        key,
        value: value as Prisma.InputJsonValue,
        public: body.public !== false,
      },
      update: {
        value: value as Prisma.InputJsonValue,
        public: body.public !== false,
      },
    });
  }

  async commerceProducts(search = "", pageInput = 1, statusInput = "") {
    const page = Math.max(Number(pageInput) || 1, 1);
    const where: Prisma.CommerceProductWhereInput = {
      ...(statusInput === "ARCHIVED"
        ? { localArchived: true }
        : statusInput === "OUT_OF_STOCK"
          ? {
              localArchived: false,
              skus: { none: { enabled: true, stock: { gt: 0 } } },
            }
          : statusInput
            ? {
                localArchived: false,
                status: enumValue(ProductStatus, statusInput, "商品状态"),
              }
            : {}),
      ...(search
        ? {
            OR: [{ name: { contains: search, mode: "insensitive" } }, { displayName: { contains: search, mode: "insensitive" } }, { erpItemId: { contains: search } }],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commerceProduct.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          skus: true,
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
    const body = safeObject(input);
    const existing = id
      ? await this.prisma.commerceProduct.findUnique({
          where: { id },
          include: { skus: true },
        })
      : null;
    if (id && !existing) throw new NotFoundException("商品不存在");
    if (!id && body.source && body.source !== "LOCAL") throw new BadRequestException("ERP商品应从聚水潭同步创建");
    if (existing && body.source !== undefined && body.source !== existing.source) throw new BadRequestException("商品来源不能修改");
    const local = !existing || existing.source === "LOCAL";
    if (!local && (body.skus !== undefined || (body.name !== undefined && body.name !== existing!.name) || (body.erpItemId !== undefined && body.erpItemId !== existing!.erpItemId))) {
      throw new BadRequestException("ERP商品的名称、编码、SKU、售价和库存由ERP同步维护");
    }
    const name = String(body.name ?? existing?.name ?? "").trim();
    if (!name) throw new BadRequestException("商品名称不能为空");
    const erpItemId = String(body.erpItemId ?? existing?.erpItemId ?? `LOCAL-${randomUUID()}`).trim();
    if (!erpItemId) throw new BadRequestException("商品编码不能为空");
    const status = enumValue(ProductStatus, body.status ?? existing?.status ?? ProductStatus.DRAFT, "商品状态");
    const data = {
      ...(local ? { name, erpItemId } : {}),
      displayName: nullableText(body.displayName ?? existing?.displayName),
      subtitle: nullableText(body.subtitle ?? existing?.subtitle),
      brand: nullableText(body.brand ?? existing?.brand),
      coverImage: nullableText(body.coverImage ?? existing?.coverImage),
      gallery: stringList(body.gallery ?? existing?.gallery, 20),
      detailHtml: nullableText(body.detailHtml ?? existing?.detailHtml),
      tags: stringList(body.tags ?? existing?.tags, 30),
      categoryId: nullableText(body.categoryId ?? existing?.categoryId),
      status,
      featured: body.featured === undefined ? (existing?.featured ?? false) : body.featured === true,
      sort: Math.trunc(Number(body.sort ?? existing?.sort ?? 0)) || 0,
      localArchived: body.localArchived === undefined ? (existing?.localArchived ?? false) : body.localArchived === true,
    };
    return this.prisma.$transaction(async (tx) => {
      const saved = id
        ? await tx.commerceProduct.update({ where: { id }, data })
        : await tx.commerceProduct.create({
            data: { ...data, name, erpItemId, source: "LOCAL" },
          });
      if (local && (body.skus !== undefined || !id)) {
        if (!Array.isArray(body.skus) || !body.skus.length) throw new BadRequestException("至少添加一个商品规格");
        const retained: string[] = [];
        for (const [index, raw] of body.skus.entries()) {
          const sku = safeObject(raw);
          const skuId = String(sku.id ?? "");
          const current = existing?.skus.find((item) => item.id === skuId);
          if (skuId && !current) throw new BadRequestException("商品规格不属于当前商品");
          const skuData = {
            erpItemId,
            erpSkuId: String(sku.erpSkuId ?? current?.erpSkuId ?? `${erpItemId}-${index + 1}`).trim(),
            specification: nullableText(sku.specification),
            image: nullableText(sku.image),
            barcode: nullableText(sku.barcode),
            salePriceCents: integerCents(sku.salePriceCents ?? current?.salePriceCents, "销售价格", 1),
            marketPriceCents: sku.marketPriceCents == null ? null : integerCents(sku.marketPriceCents, "市场价"),
            stock: integerCents(sku.stock ?? current?.stock ?? 0, "库存"),
            enabled: sku.enabled !== false,
          };
          if (!skuData.erpSkuId) throw new BadRequestException("SKU编码不能为空");
          const result = current
            ? await tx.commerceSku.update({
                where: { id: current.id },
                data: skuData,
              })
            : await tx.commerceSku.create({
                data: { ...skuData, productId: saved.id },
              });
          retained.push(result.id);
        }
        await tx.commerceSku.updateMany({
          where: { productId: saved.id, id: { notIn: retained } },
          data: { enabled: false },
        });
      }
      if (saved.localArchived)
        await tx.commerceSku.updateMany({
          where: { productId: saved.id },
          data: { enabled: false },
        });
      return tx.commerceProduct.findUniqueOrThrow({
        where: { id: saved.id },
        include: { skus: true, category: true },
      });
    });
  }

  async batchCommerceProducts(input: unknown) {
    const body = safeObject(input);
    const ids = [...new Set(stringList(body.ids, 500))];
    const action = String(body.action ?? "");
    if (!ids.length || !["PUBLISH", "DISABLE", "ARCHIVE"].includes(action)) throw new BadRequestException("请选择商品与有效操作");
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.commerceProduct.updateMany({
        where: { id: { in: ids }, localArchived: false },
        data:
          action === "ARCHIVE"
            ? { localArchived: true, status: ProductStatus.OFF_SHELF }
            : {
                status: action === "PUBLISH" ? ProductStatus.PUBLISHED : ProductStatus.OFF_SHELF,
              },
      });
      if (action === "ARCHIVE")
        await tx.commerceSku.updateMany({
          where: { productId: { in: ids } },
          data: { enabled: false },
        });
      return result;
    });
  }

  async quickUpdateCommerceProductSkus(productId: string, input: unknown) {
    const body = safeObject(input);
    if (!Array.isArray(body.skus) || body.skus.length === 0 || body.skus.length > 100) {
      throw new BadRequestException("请选择1至100个需要修改的SKU");
    }
    const product = await this.prisma.commerceProduct.findUnique({
      where: { id: productId },
      include: { skus: true },
    });
    if (!product) throw new NotFoundException("商品不存在");

    const productSkuIds = new Set(product.skus.map((sku) => sku.id));
    const requestedIds = new Set<string>();
    const adjustments = body.skus.map((raw) => {
      const sku = safeObject(raw);
      const id = String(sku.id ?? "").trim();
      if (!id || !productSkuIds.has(id)) throw new BadRequestException("SKU不属于当前商品，请刷新后重试");
      if (requestedIds.has(id)) throw new BadRequestException("同一个SKU不能重复提交");
      requestedIds.add(id);
      const expectedUpdatedAt = new Date(String(sku.updatedAt ?? ""));
      if (Number.isNaN(expectedUpdatedAt.valueOf())) throw new BadRequestException("SKU版本无效，请刷新后重试");
      return {
        id,
        expectedUpdatedAt,
        salePriceCents: integerCents(sku.salePriceCents, "销售价格", 1),
        stock: integerCents(sku.stock, "库存"),
      };
    });

    return this.prisma.$transaction(async (tx) => {
      for (const adjustment of adjustments) {
        const result = await tx.commerceSku.updateMany({
          where: {
            id: adjustment.id,
            productId,
            updatedAt: adjustment.expectedUpdatedAt,
          },
          data: {
            salePriceCents: adjustment.salePriceCents,
            stock: adjustment.stock,
          },
        });
        if (result.count !== 1) {
          throw new ConflictException("SKU价格或库存已被更新，请刷新后重新修改");
        }
      }
      await tx.commerceProduct.update({
        where: { id: productId },
        data: { updatedAt: new Date() },
      });
      return tx.commerceProduct.findUniqueOrThrow({
        where: { id: productId },
        include: { skus: { orderBy: { createdAt: "asc" } }, category: true },
      });
    });
  }

  commerceCategories() {
    return this.prisma.commerceCategory.findMany({
      include: { parent: { select: { id: true, name: true } } },
      orderBy: [{ sort: "desc" }, { name: "asc" }],
    });
  }

  async saveCommerceCategory(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const existing = id ? await this.prisma.commerceCategory.findUnique({ where: { id } }) : null;
    const name = String(body.name ?? existing?.name ?? "").trim();
    if (!name) throw new BadRequestException("分类名称不能为空");
    const parentId = nullableText(body.parentId ?? existing?.parentId);
    if (id && parentId === id) throw new BadRequestException("分类不能作为自己的上级");
    const data = {
      name,
      iconUrl: nullableText(body.iconUrl ?? existing?.iconUrl),
      parentId,
      sort: Math.trunc(Number(body.sort ?? existing?.sort ?? 0)) || 0,
      enabled: body.enabled === undefined ? (existing?.enabled ?? true) : body.enabled === true,
    };
    return id ? this.prisma.commerceCategory.update({ where: { id }, data }) : this.prisma.commerceCategory.create({ data });
  }

  commerceBanners() {
    return this.prisma.commerceBanner.findMany({
      orderBy: [{ sort: "desc" }, { updatedAt: "desc" }],
      take: 500,
    });
  }

  async saveCommerceBanner(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const existing = id ? await this.prisma.commerceBanner.findUnique({ where: { id } }) : null;
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
      enabled: body.enabled === undefined ? (existing?.enabled ?? true) : body.enabled === true,
    };
    return id ? this.prisma.commerceBanner.update({ where: { id }, data }) : this.prisma.commerceBanner.create({ data });
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
    const value = body.value === null || body.value === undefined ? Prisma.DbNull : (body.value as Prisma.InputJsonValue);
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
    return this.prisma.commerceReview
      .findMany({
        include: {
          user: { select: { id: true, nickname: true, mobile: true } },
          product: { select: { id: true, name: true, displayName: true } },
          orderItem: { select: { id: true, orderId: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          user: { ...row.user, mobile: maskMobile(row.user.mobile) },
        })),
      );
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

  async commerceOrders(statusInput?: string, pageInput = 1, searchInput = "") {
    const page = Math.max(Number(pageInput) || 1, 1);
    const status = statusInput ? enumValue(CommerceOrderStatus, statusInput, "订单状态") : undefined;
    const search = searchInput.trim().slice(0, 200);
    const where: Prisma.CommerceOrderWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [{ orderNo: { contains: search, mode: "insensitive" } }, { recipientName: { contains: search, mode: "insensitive" } }, { recipientMobile: { contains: search } }, { user: { nickname: { contains: search, mode: "insensitive" } } }, { user: { mobile: { contains: search } } }],
          }
        : {}),
    };
    const [items, total, statusCounts, amounts] = await this.prisma.$transaction([
      this.prisma.commerceOrder.findMany({
        where,
        include: {
          user: { select: { id: true, nickname: true, mobile: true } },
          items: true,
          shipments: { include: { items: true } },
          paymentIntents: { select: adminOrderPaymentSelect },
          afterSales: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 50,
        take: 50,
      }),
      this.prisma.commerceOrder.count({ where }),
      this.prisma.commerceOrder.groupBy({
        by: ["status"],
        where,
        orderBy: { status: "asc" },
        _count: true,
      }),
      this.prisma.commerceOrder.aggregate({
        where: { ...where, paidAt: { not: null } },
        _sum: { payableCents: true },
      }),
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
      stats: {
        statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row._count])),
        paidOrderCents: amounts._sum.payableCents ?? 0,
      },
    };
  }

  async updateCommerceOrder(id: string, input: unknown) {
    const body = safeObject(input);
    const adminRemark = nullableText(body.adminRemark);
    if (body.status !== undefined) {
      throw new BadRequestException("订单状态由支付、履约或售后流程更新，不能手工改写");
    }
    const version = expectedVersion(body.version);
    const changed = await this.prisma.commerceOrder.updateMany({
      where: { id, version, executionOwner: "NEW_SYSTEM" },
      data: { adminRemark, version: { increment: 1 } },
    });
    if (!changed.count) throw new ConflictException("订单已更新或未完成接管，请刷新后重试");
    return this.prisma.commerceOrder.findUniqueOrThrow({ where: { id } });
  }

  async manuallySettleCommerceOrder(id: string, input: unknown, current: { id: string; role: string; roles?: string[] }, requestId?: string) {
    const roles = current.roles?.length ? current.roles : [current.role];
    if (!isGlobalRealm()) throw new NotFoundException("此功能仅供国际版后台使用");
    if (!current.id || !roles.includes(AdminRole.SUPER_ADMIN)) throw new ForbiddenException("只有超级管理员可以调价或确认线下收款");
    if (!isUuid(id)) throw new BadRequestException("订单编号不正确");
    const body = safeObject(input);
    if (Object.keys(body).some((field) => !["action", "payableCents", "note", "orderVersion", "idempotencyKey"].includes(field))) {
      throw new BadRequestException("订单人工处理包含不支持的字段");
    }
    const action = String(body.action ?? "").trim();
    if (!["ADJUST_PRICE", "CONFIRM_OFFLINE_PAID"].includes(action)) throw new BadRequestException("请选择保留待付款或确认线下收款");
    const payableCents = integerCents(body.payableCents, "订单应付金额", 1);
    const orderVersion = expectedVersion(body.orderVersion);
    const note = String(body.note ?? "").trim();
    if (note.length < 2 || note.length > 500) throw new BadRequestException("请填写2至500字的处理备注");
    const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) throw new BadRequestException("请提供有效的操作请求编号");
    const scope = "admin_order_manual_payment_v1";
    const requestHash = sha256(
      JSON.stringify({
        id,
        action,
        payableCents,
        note,
        orderVersion,
        actorId: current.id,
      }),
    );

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${id}::uuid FOR UPDATE`;
        const order = await tx.commerceOrder.findUnique({
          where: { id },
          include: {
            items: true,
            paymentIntents: { select: adminOrderPaymentSelect },
          },
        });
        if (!order) throw new NotFoundException("订单不存在");
        requireCommerceOwner(order.executionOwner);
        const previousRequest = await tx.idempotencyRecord.findUnique({
          where: {
            userId_scope_key: {
              userId: order.userId,
              scope,
              key: idempotencyKey,
            },
          },
        });
        if (previousRequest) {
          if (previousRequest.requestHash !== requestHash) throw new ConflictException("操作请求编号已被不同参数使用");
          const saved = await tx.commerceOrder.findUniqueOrThrow({
            where: { id },
            include: {
              items: true,
              paymentIntents: { select: adminOrderPaymentSelect },
              shipments: { include: { items: true } },
              afterSales: true,
            },
          });
          return {
            ...saved,
            recipientMobile: maskMobile(saved.recipientMobile),
            reused: true,
          };
        }
        if (order.version !== orderVersion) throw new ConflictException("订单已更新，请刷新后重试");
        if (order.status !== CommerceOrderStatus.PENDING_PAYMENT || order.paidAt) {
          throw new ConflictException("只有待付款订单可以调价或确认线下收款，已支付状态不能手工倒退");
        }
        if (order.paymentIntents.some((intent) => ([PaymentStatus.CREATED, PaymentStatus.PENDING] as PaymentStatus[]).includes(intent.status))) {
          throw new ConflictException("订单存在支付处理中记录，请先等待渠道结果或完成关单后再操作");
        }
        if (order.paymentIntents.some((intent) => ([PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDING, PaymentStatus.PARTIAL_REFUNDED, PaymentStatus.REFUNDED] as PaymentStatus[]).includes(intent.status))) {
          throw new ConflictException("订单已有成功支付或退款记录，请先完成资金对账");
        }
        const merchandiseCashCents = payableCents - order.shippingCents;
        const discountCents = order.subtotalCents - order.pointDiscountCents - merchandiseCashCents;
        if (merchandiseCashCents < 0 || discountCents < 0) {
          throw new BadRequestException(`应付金额须在${Math.max(1, order.shippingCents)}分至${order.subtotalCents - order.pointDiscountCents + order.shippingCents}分之间`);
        }
        const quote = priceOrder({
          items: order.items.map((item) => ({
            skuId: item.skuId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
          })),
          couponDiscountCents: discountCents,
          pointDiscountCents: order.pointDiscountCents,
          shippingCents: order.shippingCents,
          availablePointCents: order.pointDiscountCents,
        });
        if (quote.subtotalCents !== order.subtotalCents || quote.payableCents !== payableCents) {
          throw new ConflictException("订单金额无法保持一致，请先核验商品和优惠快照");
        }
        for (const item of order.items) {
          const allocation = quote.lines.find((line) => line.skuId === item.skuId);
          if (!allocation) throw new ConflictException("订单商品分摊不完整，请先核验");
          await tx.commerceOrderItem.update({
            where: { id: item.id },
            data: {
              couponDiscountCentsSnapshot: allocation.couponDiscountCentsSnapshot,
              pointDiscountCentsSnapshot: allocation.pointDiscountCentsSnapshot,
              cashPaidCentsSnapshot: allocation.cashPaidCentsSnapshot,
            },
          });
        }
        const changedAt = new Date();
        const paid = action === "CONFIRM_OFFLINE_PAID";
        const remarkPrefix = paid ? "线下收款" : "后台调价";
        const adminRemark = [order.adminRemark, `[${remarkPrefix} ${changedAt.toISOString()}] ${note}`].filter(Boolean).join("\n");
        const changed = await tx.commerceOrder.updateMany({
          where: {
            id,
            version: orderVersion,
            status: CommerceOrderStatus.PENDING_PAYMENT,
            paidAt: null,
            executionOwner: "NEW_SYSTEM",
          },
          data: {
            discountCents: quote.couponDiscountCents,
            payableCents,
            pricingVersion: quote.pricingVersion,
            pricingVerifiedAt: changedAt,
            adminRemark,
            ...(paid ? { status: CommerceOrderStatus.PAID, paidAt: changedAt } : {}),
            version: { increment: 1 },
          },
        });
        if (!changed.count) throw new ConflictException("订单已更新，请刷新后重试");
        if (paid) {
          const paymentDigest = sha256(`${id}:${idempotencyKey}`);
          await tx.paymentIntent.create({
            data: {
              paymentNo: `OFFLINE-${paymentDigest.slice(0, 24).toUpperCase()}`,
              userId: order.userId,
              businessType: BusinessType.COMMERCE_ORDER,
              businessId: id,
              commerceOrderId: id,
              channel: PaymentChannel.OFFLINE_MANUAL,
              status: PaymentStatus.SUCCEEDED,
              amountCents: payableCents,
              currency: order.currency,
              description: `后台确认线下收款：${order.orderNo}`,
              idempotencyKey: `admin-offline:${paymentDigest}`,
              providerTransactionId: `OFFLINE-${paymentDigest.toUpperCase()}`,
              providerPayload: {
                source: "SUPER_ADMIN_OFFLINE_CONFIRMATION",
                adminId: current.id,
              } as Prisma.InputJsonValue,
              paidAt: changedAt,
            },
          });
          await onCommerceOrderPaid(tx, id);
          const erpItems = await tx.commerceOrderItem.count({
            where: { orderId: id, product: { source: "ERP" } },
          });
          if (erpItems) {
            await tx.commerceIntegrationJob.upsert({
              where: { idempotencyKey: `jushuitan-order:${id}` },
              create: {
                type: "JUSHUITAN_ORDER_PUSH",
                idempotencyKey: `jushuitan-order:${id}`,
                aggregateType: "commerce_order",
                aggregateId: id,
                payload: { orderId: id },
              },
              update: {},
            });
          }
        }
        await tx.auditLog.create({
          data: {
            actorType: "ADMIN",
            actorId: current.id,
            action: paid ? "COMMERCE_ORDER_OFFLINE_PAYMENT_CONFIRMED" : "COMMERCE_ORDER_PRICE_ADJUSTED",
            entityType: "COMMERCE_ORDER",
            entityId: id,
            requestId: requestId ?? null,
            beforeJson: {
              status: order.status,
              payableCents: order.payableCents,
              version: order.version,
            },
            afterJson: {
              status: paid ? CommerceOrderStatus.PAID : CommerceOrderStatus.PENDING_PAYMENT,
              payableCents,
              note,
              version: order.version + 1,
            },
          },
        });
        await tx.idempotencyRecord.create({
          data: {
            userId: order.userId,
            scope,
            key: idempotencyKey,
            requestHash,
            responseCode: 201,
            responseBody: { orderId: id, action },
            expiresAt: new Date(changedAt.valueOf() + 30 * 86_400_000),
          },
        });
        const saved = await tx.commerceOrder.findUniqueOrThrow({
          where: { id },
          include: {
            items: true,
            paymentIntents: { select: adminOrderPaymentSelect },
            shipments: { include: { items: true } },
            afterSales: true,
          },
        });
        return {
          ...saved,
          recipientMobile: maskMobile(saved.recipientMobile),
          reused: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  commerceFulfillmentPreview(orderId: string, current: { id: string; role: string; roles?: string[] }) {
    return localFulfillmentPreview(this.prisma, orderId, current);
  }

  createCommerceShipment(orderId: string, input: unknown, current: { id: string; role: string; roles?: string[] }) {
    return this.prisma.$transaction((tx) => createLocalShipment(tx, orderId, input, current));
  }

  async shippingRefundPreview(orderId: string) {
    const { order, ...capacity } = await shippingRefundCapacity(this.prisma, orderId);
    return { orderId, orderVersion: order.version, ...capacity };
  }

  async createShippingRefund(orderId: string, input: unknown, current: { id: string; role: string; roles?: string[] }) {
    requireShippingFinance(current);
    const body = safeObject(input),
      amountCents = integerCents(body.amountCents, "退运费", 1);
    const reason = String(body.reason ?? "").trim(),
      rawKey = String(body.requestKey ?? "").trim();
    if (reason.length < 2 || reason.length > 256) throw new BadRequestException("请填写2至256字的退运费原因");
    if (rawKey.length < 8 || rawKey.length > 120) throw new BadRequestException("请提供有效申请编号");
    const requestKey = "shipping:" + rawKey,
      version = expectedVersion(body.orderVersion);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${orderId}::uuid FOR UPDATE`;
        const existing = await tx.commerceAfterSale.findUnique({
          where: { requestKey },
        });
        if (existing) {
          if (existing.orderId !== orderId || existing.requestedCents !== amountCents || existing.reason !== reason || existing.requestedByAdminId !== current.id) throw new ConflictException("申请编号已被不同参数使用");
          return existing;
        }
        const { order, maximumCents, pricingVersion } = await shippingRefundCapacity(tx, orderId);
        if (order.version !== version) throw new ConflictException("订单已更新，请刷新运费报价");
        if (["PENDING_PAYMENT", "CANCELLED", "CLOSED"].includes(order.status)) throw new ConflictException("当前订单不可退运费");
        if (amountCents > maximumCents) throw new ConflictException("退运费超过剩余运费或现金额度");
        const created = await tx.commerceAfterSale.create({
          data: {
            afterSaleNo: "AS-SHIP-" + randomUUID(),
            orderId,
            type: "SHIPPING_ONLY",
            status: "APPLIED",
            pricingVersion,
            pointReturnCents: 0,
            shippingRefundCents: amountCents,
            requestedCents: amountCents,
            reason,
            requestKey,
            requestedByAdminId: current.id,
            evidenceImages: [],
          },
        });
        await tx.commerceOrder.update({
          where: { id: orderId },
          data: { status: "AFTER_SALE", version: { increment: 1 } },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  commerceAfterSales(statusInput?: string) {
    const status = statusInput ? enumValue(AfterSaleStatus, statusInput, "售后状态") : undefined;
    return this.prisma.commerceAfterSale
      .findMany({
        where: status ? { status } : {},
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
              userId: true,
              payableCents: true,
            },
          },
          refunds: {
            select: {
              id: true,
              refundNo: true,
              status: true,
              amountCents: true,
            },
          },
          items: { include: { orderItem: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          allowedTransitions: row.type === "SHIPPING_ONLY" ? (shippingAfterSaleTransitions[row.status] ?? []) : (afterSaleTransitions[row.status] ?? []).filter((next) => row.type !== "REFUND_ONLY" || !["WAITING_RETURN", "RETURNED"].includes(next)),
        })),
      );
  }

  async updateCommerceAfterSale(id: string, input: unknown, current?: { id: string; role: string; roles?: string[] }) {
    const body = safeObject(input);
    const status = enumValue(AfterSaleStatus, body.status, "售后状态");
    const version = expectedVersion(body.version);
    return this.prisma.$transaction(async (tx) => {
      const reference = await tx.commerceAfterSale.findUnique({
        where: { id },
        select: { orderId: true },
      });
      if (!reference) throw new NotFoundException("售后单不存在");
      await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${reference.orderId}::uuid FOR UPDATE`;
      const existing = await tx.commerceAfterSale.findUnique({
        where: { id },
        include: {
          order: {
            include: {
              items: { include: { product: { select: { source: true } } } },
            },
          },
        },
      });
      if (!existing) throw new NotFoundException("售后单不存在");
      requireCommerceOwner(existing.executionOwner);
      requireCommerceOwner(existing.order.executionOwner);
      if (existing.type === "SHIPPING_ONLY") {
        requireShippingFinance(current);
        if (!["APPLIED", "REVIEWING", "APPROVED", "REJECTED", "CANCELLED"].includes(status)) throw new BadRequestException("运费申请不适用退货状态，资金完成由渠道确认");
        if (existing.status !== status && !(shippingAfterSaleTransitions[existing.status] ?? []).includes(status)) throw new ConflictException("当前运费申请不可转为该状态");
        if (status === AfterSaleStatus.CANCELLED) {
          const occupied = await tx.paymentRefund.count({
            where: {
              afterSaleId: id,
              status: { in: ["CREATED", "PROCESSING", "SUCCEEDED"] },
            },
          });
          if (occupied) throw new ConflictException("运费退款已有资金占用，不能取消");
        }
        if (status === AfterSaleStatus.APPROVED) {
          const capacity = await shippingRefundCapacity(tx, existing.orderId, id);
          if (existing.requestedCents > capacity.maximumCents) throw new ConflictException("运费额度已变动，请先核验");
        }
      }
      if (existing.type !== "SHIPPING_ONLY") {
        if (existing.type === "REFUND_ONLY" && ["WAITING_RETURN", "RETURNED"].includes(status)) throw new BadRequestException("仅退款不适用退货物流状态");
        assertAfterSaleTransition(existing.status, status);
      }
      const changed = await tx.commerceAfterSale.updateMany({
        where: { id, version, status: existing.status },
        data: {
          status,
          version: { increment: 1 },
          ...(existing.type === "SHIPPING_ONLY" && ["APPROVED", "REJECTED"].includes(status) ? { reviewedByAdminId: current!.id, reviewedAt: new Date() } : {}),
          ...(body.returnLogisticsCompany !== undefined
            ? {
                returnLogisticsCompany: nullableText(body.returnLogisticsCompany),
              }
            : {}),
          ...(body.returnTrackingNo !== undefined ? { returnTrackingNo: nullableText(body.returnTrackingNo) } : {}),
        },
      });
      if (!changed.count) throw new ConflictException("售后单已更新，请刷新后重试");
      if (status === AfterSaleStatus.APPROVED && existing.status !== status && existing.type !== "SHIPPING_ONLY" && existing.order.items.some((item) => item.product.source === "ERP")) {
        await tx.commerceIntegrationJob.upsert({
          where: { idempotencyKey: `jushuitan-after-sale:${id}` },
          create: {
            type: "JUSHUITAN_AFTER_SALE_PUSH",
            aggregateType: "commerce_after_sale",
            aggregateId: id,
            idempotencyKey: `jushuitan-after-sale:${id}`,
            payload: { afterSaleId: id },
          },
          update: {},
        });
      }
      if ([AfterSaleStatus.CANCELLED, AfterSaleStatus.REJECTED].includes(status as "CANCELLED" | "REJECTED")) {
        const active = await tx.commerceAfterSale.count({
          where: {
            orderId: existing.orderId,
            status: {
              notIn: [AfterSaleStatus.CANCELLED, AfterSaleStatus.REJECTED, AfterSaleStatus.COMPLETED],
            },
          },
        });
        if (!active) {
          const order = await tx.commerceOrder.findUniqueOrThrow({
            where: { id: existing.orderId },
            include: {
              items: true,
              shipments: { include: { items: true } },
              afterSales: { include: { items: true } },
            },
          });
          await tx.commerceOrder.updateMany({
            where: {
              id: existing.orderId,
              status: CommerceOrderStatus.AFTER_SALE,
            },
            data: {
              ...orderFulfillmentState(order),
              version: { increment: 1 },
            },
          });
        }
      }
      return tx.commerceAfterSale.findUniqueOrThrow({
        where: { id },
        include: { items: true },
      });
    });
  }

  async commerceCoupons() {
    const coupons = await this.prisma.commerceCoupon.findMany({
      include: { _count: { select: { claims: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return coupons.map(({ legacyId, ...coupon }) => ({
      ...coupon,
      redemptionCode: legacyId && /^[A-Z0-9_-]{4,32}$/.test(legacyId) ? legacyId : null,
    }));
  }

  async saveCommerceCoupon(id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const existing = id ? await this.prisma.commerceCoupon.findUnique({ where: { id } }) : null;
    const name = String(body.name ?? existing?.name ?? "").trim();
    if (!name) throw new BadRequestException("优惠券名称不能为空");
    const validFrom = dateValue(body.validFrom ?? existing?.validFrom, "生效时间");
    const validUntil = dateValue(body.validUntil ?? existing?.validUntil, "失效时间");
    if (validFrom >= validUntil) throw new BadRequestException("优惠券失效时间必须晚于生效时间");
    const redemptionCode =
      body.redemptionCode === undefined
        ? (existing?.legacyId ?? null)
        : String(body.redemptionCode ?? "")
            .trim()
            .toUpperCase() || null;
    if (redemptionCode && !/^[A-Z0-9_-]{4,32}$/.test(redemptionCode)) {
      throw new BadRequestException("优惠码须为 4 至 32 位字母、数字、下划线或连字符");
    }
    const data = {
      name,
      legacyId: redemptionCode,
      type: "CASH" as const,
      status: enumValue(CouponStatus, body.status ?? existing?.status ?? "DRAFT", "优惠券状态"),
      value: positiveInteger(body.value ?? existing?.value, "优惠金额"),
      minimumSpendCents: nonNegativeInteger(body.minimumSpendCents ?? existing?.minimumSpendCents, "最低消费金额"),
      totalQuantity: body.totalQuantity === null ? null : positiveInteger(body.totalQuantity ?? existing?.totalQuantity ?? 1, "发行数量"),
      validFrom,
      validUntil,
      employeeDistributable: body.employeeDistributable === undefined ? (existing?.employeeDistributable ?? false) : body.employeeDistributable === true,
      perEmployeeLimit: nonNegativeInteger(body.perEmployeeLimit ?? existing?.perEmployeeLimit ?? 0, "员工领取上限"),
    };
    return id ? this.prisma.commerceCoupon.update({ where: { id }, data }) : this.prisma.commerceCoupon.create({ data });
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
      this.prisma.commerceCommissionPlan.findUnique({
        where: { id: "default" },
      }),
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
    return { plan, items: accruals, ledger };
  }

  async saveCommerceCommissionPlan(input: unknown) {
    const body = safeObject(input);
    const rateBps = integerCents(body.rateBps, "奖金比例");
    const settlementDays = integerCents(body.settlementDays, "结算等待天数");
    if (rateBps > 10_000 || settlementDays > 3650) throw new BadRequestException("奖金比例应为0至10000基点，结算等待应在0至3650天内");
    const minimumWithdrawCents = body.minimumWithdrawCents === null || body.minimumWithdrawCents === undefined ? null : integerCents(body.minimumWithdrawCents, "最低提现金额", 1);
    const dailyWithdrawLimitCents = body.dailyWithdrawLimitCents === null || body.dailyWithdrawLimitCents === undefined ? null : integerCents(body.dailyWithdrawLimitCents, "每日提现额度", 1);
    if (body.withdrawalEnabled === true && minimumWithdrawCents === null) throw new BadRequestException("启用提现前必须配置最低提现金额");
    if (dailyWithdrawLimitCents !== null && minimumWithdrawCents !== null && dailyWithdrawLimitCents < minimumWithdrawCents) {
      throw new BadRequestException("每日提现额度不能低于单次最低金额");
    }
    if (body.reviewRequired !== true) throw new BadRequestException("当前提现必须保留人工审核，不能启用自动付款");
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.commerceCommissionPlan.findUnique({
        where: { id: "default" },
      });
      const data = {
        enabled: body.enabled === true,
        rateBps,
        settlementDays,
        withdrawalEnabled: body.withdrawalEnabled === true,
        minimumWithdrawCents,
        dailyWithdrawLimitCents,
        reviewRequired: true,
        enabledAt: body.enabled === true && !current?.enabled ? new Date() : (current?.enabledAt ?? null),
      };
      return tx.commerceCommissionPlan.upsert({
        where: { id: "default" },
        create: { id: "default", ...data },
        update: data,
      });
    });
  }

  commerceJobs(statusInput?: string) {
    const status = statusInput ? enumValue(CommerceJobStatus, statusInput, "任务状态") : undefined;
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
        status: {
          in: [CommerceJobStatus.FAILED, CommerceJobStatus.DEAD_LETTER],
        },
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
    return this.prisma.commerceIntegrationJob.findUniqueOrThrow({
      where: { id },
    });
  }

  async queueCommerceProductSync(input: unknown) {
    const body = safeObject(input);
    const modifiedEnd = optionalDate(body.modifiedEnd) ?? new Date();
    const modifiedBegin = optionalDate(body.modifiedBegin) ?? new Date(modifiedEnd.valueOf() - 24 * 3_600_000);
    if (modifiedBegin >= modifiedEnd || modifiedEnd.valueOf() - modifiedBegin.valueOf() > 31 * 86_400_000) {
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
    const status = statusInput ? enumValue(PaymentStatus, statusInput, "支付状态") : undefined;
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

  async healthReports(statusInput?: string) {
    const status = statusInput ? enumValue(ReportStatus, statusInput, "报告状态") : undefined;
    const rows = await this.prisma.healthReport.findMany({
      where: status ? { status } : {},
      select: {
        id: true,
        userId: true,
        user: { select: { compatibilityId: true, nickname: true } },
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
    return rows.map(({ user, ...report }) => ({
      ...report,
      memberNo: String(user.compatibilityId),
      memberNickname: user.nickname,
    }));
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
    const previous = id ? await this.prisma.healthReportOffer.findUnique({ where: { id } }) : null;
    if (id && !previous) throw new NotFoundException("报告方案不存在");
    const offerKey = String(body.offerKey ?? previous?.offerKey ?? "").trim();
    const title = String(body.title ?? previous?.title ?? "").trim();
    const description = String(body.description ?? previous?.description ?? "").trim();
    if (!/^[a-z0-9-]{3,60}$/.test(offerKey) || !title || !description) {
      throw new BadRequestException("方案标识、标题或说明不正确");
    }
    const entitlement = enumValue(ReportEntitlementType, body.entitlement ?? previous?.entitlement, "权益类型");
    const priceCents = positiveInteger(body.priceCents ?? previous?.priceCents, "价格");
    const creditCount = positiveInteger(body.creditCount ?? previous?.creditCount, "报告次数");
    const durationDays = entitlement === ReportEntitlementType.MEMBERSHIP ? positiveInteger(body.durationDays ?? previous?.durationDays ?? 30, "有效天数") : null;
    const platforms = stringList(body.platforms ?? previous?.platforms, 8).filter((item) => ["android", "ios", "h5", "mini_program", "web"].includes(item));
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

  async saveNotificationCampaign(adminId: string, id: string | undefined, input: unknown) {
    const body = safeObject(input);
    const previous = id ? await this.prisma.notificationCampaign.findUnique({ where: { id } }) : null;
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
    const campaign = await this.prisma.notificationCampaign.findUnique({
      where: { id },
    });
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

function enumValue<T extends Record<string, string>>(values: T, input: unknown, label: string): T[keyof T] {
  const value = String(input ?? "")
    .trim()
    .toUpperCase();
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
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\n]/) : [];
  return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].slice(0, maximum);
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

const shippingAfterSaleTransitions: Record<string, readonly string[]> = {
  APPLIED: ["REVIEWING", "APPROVED", "REJECTED", "CANCELLED"],
  REVIEWING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["CANCELLED"],
  REFUNDING: [],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

function requireShippingFinance(current?: { id: string; role: string; roles?: string[] }): asserts current is { id: string; role: string; roles?: string[] } {
  if (!current?.id || ![current.role, ...(current.roles ?? [])].some((role) => ["SUPER_ADMIN", "FINANCE"].includes(role))) throw new ForbiddenException("单独退运费必须由财务审核处理");
}

function normalizeAdminRoles(value: unknown): AdminRole[] {
  if (!Array.isArray(value) || !value.length) throw new BadRequestException("至少选择一个后台角色");
  const roles = [...new Set(value.map((role) => String(role).toUpperCase()))];
  if (roles.some((role) => !Object.values(AdminRole).includes(role as AdminRole))) {
    throw new BadRequestException("后台角色不正确");
  }
  return roles as AdminRole[];
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value ?? 0);
  if (!Number.isInteger(number) || number < 0) {
    throw new BadRequestException(`${label}必须是非负整数`);
  }
  return number;
}
