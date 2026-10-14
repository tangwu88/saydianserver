import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { hash } from "bcryptjs";
import { createHash } from "node:crypto";
import { PrismaService } from "../common/prisma.service";
import { isUuid, randomToken, safeObject, sha256 } from "../common/crypto";
import { isH5PhoneTestSession } from "../auth/global-wechat-policy";
import {
  partnerNumber,
  partnerPage,
  partnerRequestKey,
} from "./partner-commerce.service";

export function verifiedPartnerMember(user: {
  status: UserStatus;
  mobile: string | null;
  mobileVerifiedAt: Date | null;
  email: string | null;
  emailVerifiedAt: Date | null;
}) {
  return (
    user.status === UserStatus.ACTIVE &&
    !!(
      (user.mobile && user.mobileVerifiedAt) ||
      (user.email && user.emailVerifiedAt)
    )
  );
}
function field(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new BadRequestException(`${label}格式不正确`);
  return value.trim();
}
function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  action: string,
  entityId: string,
  afterJson: Prisma.InputJsonValue,
  requestId: string,
  actorType = "ADMIN",
) {
  return tx.auditLog.create({
    data: {
      actorType,
      actorId,
      action,
      entityType: "PARTNER_ONBOARDING",
      entityId,
      afterJson,
      requestId,
    },
  });
}

@Injectable()
export class PartnerOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async memberStatus(userId: string) {
    const [partner, applications] = await Promise.all([
      this.prisma.brandPartner.findUnique({
        where: { linkedMemberId: userId },
        select: {
          id: true,
          name: true,
          username: true,
          active: true,
          level: { select: { name: true } },
        },
      }),
      this.prisma.partnerApplication.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      }),
    ]);
    return { partner, application: applications[0] ?? null };
  }

  async apply(userId: string, input: unknown, requestId: string) {
    const body = safeObject(input);
    const values = {
      name: field(body.name, "合作名称", 80),
      contactName: field(body.contactName, "联系人", 40),
      mobile: field(body.mobile, "联系电话", 30),
      region: field(body.region, "所在地区", 120),
      description: field(body.description, "合作介绍", 2000),
    };
    if (!/^\+?[\d ()-]{6,30}$/.test(values.mobile))
      throw new BadRequestException("请填写有效的联系电话");
    const idempotencyKey = `partner-application:${userId}:${partnerRequestKey(body.idempotencyKey)}`;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!verifiedPartnerMember(user))
        throw new ForbiddenException("请先验证会员手机号或邮箱");
      const previous = await tx.partnerApplication.findUnique({
        where: { idempotencyKey },
      });
      if (previous) {
        if (
          previous.userId !== userId ||
          Object.entries(values).some(
            ([key, value]) => previous[key as keyof typeof values] !== value,
          )
        )
          throw new ConflictException("申请编号已被不同内容使用");
        return previous;
      }
      if (
        await tx.brandPartner.findUnique({ where: { linkedMemberId: userId } })
      )
        throw new ConflictException("该会员已开通合作账户");
      if (
        await tx.partnerApplication.findFirst({
          where: { userId, status: { in: ["PENDING", "APPROVED"] } },
        })
      )
        throw new ConflictException("已有申请，请查看审核进度");
      const application = await tx.partnerApplication.create({
        data: { userId, ...values, idempotencyKey },
      });
      await audit(
        tx,
        userId,
        "PARTNER_APPLICATION_SUBMITTED",
        application.id,
        { ...values },
        requestId,
        "USER",
      );
      return application;
    });
  }

  async applications(status: string, pageInput: unknown) {
    if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status))
      throw new BadRequestException("审核状态不正确");
    const { page, pageSize, skip } = partnerPage(pageInput),
      where = status ? { status } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.partnerApplication.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip,
        include: {
          user: { select: { id: true, compatibilityId: true, nickname: true } },
          partner: { select: { username: true, name: true } },
        },
      }),
      this.prisma.partnerApplication.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async review(actorId: string, id: string, input: unknown, requestId: string) {
    if (!isUuid(id)) throw new NotFoundException("申请不存在");
    const body = safeObject(input),
      decision = String(body.decision ?? "");
    if (!["APPROVED", "REJECTED"].includes(decision))
      throw new BadRequestException("请选择审核结果");
    const reason =
      decision === "REJECTED"
        ? field(body.reason, "未通过原因", 1000)
        : String(body.reason ?? "").trim();
    if (reason.length > 1000) throw new BadRequestException("审核备注过长");
    const passwordHash =
      decision === "APPROVED" ? await hash(randomToken(), 12) : "";
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "PartnerApplication" WHERE id = ${id}::uuid FOR UPDATE`;
      const application = await tx.partnerApplication.findUnique({
        where: { id },
      });
      if (!application) throw new NotFoundException("申请不存在");
      if (application.status !== "PENDING") {
        if (application.status === decision) return application;
        throw new ConflictException("该申请已审核，请刷新");
      }
      let partnerId: string | null = null;
      if (decision === "APPROVED") {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${application.userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: application.userId },
        });
        if (!verifiedPartnerMember(user))
          throw new ConflictException("会员状态或联系方式已失效，暂不能开通");
        if (
          await tx.brandPartner.findUnique({
            where: { linkedMemberId: user.id },
          })
        )
          throw new ConflictException("该会员已有合作账户，请勿重复开通");
        if (!isUuid(String(body.levelId ?? "")))
          throw new BadRequestException("请选择合作等级");
        const level = await tx.partnerLevel.findFirst({
          where: { id: String(body.levelId), active: true },
        });
        if (!level) throw new BadRequestException("合作等级不可用");
        const username = field(
          body.username || `vip${user.compatibilityId}`,
          "登录账号",
          80,
        );
        if (!/^[A-Za-z0-9_.-]{3,80}$/.test(username))
          throw new BadRequestException("登录账号格式不正确");
        if (await tx.brandPartner.findUnique({ where: { username } }))
          throw new ConflictException("登录账号已存在，请使用另一账号");
        const partner = await tx.brandPartner.create({
          data: {
            name: application.name,
            mobile: application.mobile,
            username,
            passwordHash,
            levelId: level.id,
            linkedMemberId: user.id,
            partnerNo: partnerNumber("VIP"),
            promotionCode: randomToken(),
            wallet: { create: {} },
          },
        });
        partnerId = partner.id;
      }
      const result = await tx.partnerApplication.update({
        where: { id },
        data: {
          status: decision,
          partnerId,
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewReason: reason || null,
        },
      });
      await audit(
        tx,
        actorId,
        `PARTNER_APPLICATION_${decision}`,
        id,
        {
          partnerId,
          reason,
          levelId: body.levelId ? String(body.levelId) : null,
        },
        requestId,
      );
      return result;
    });
  }

  async linkMember(
    actorId: string,
    partnerId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input),
      memberId = body.memberId === null ? null : String(body.memberId ?? "");
    if (!isUuid(partnerId) || (memberId !== null && !isUuid(memberId)))
      throw new BadRequestException("请选择有效的会员");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partnerId}::uuid FOR UPDATE`;
      const partner = await tx.brandPartner.findUnique({
        where: { id: partnerId },
      });
      if (!partner) throw new NotFoundException("合作账户不存在");
      if (memberId) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${memberId}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: memberId } });
        if (!user || !verifiedPartnerMember(user))
          throw new BadRequestException("请选择已验证且启用的会员");
        const owner = await tx.brandPartner.findUnique({
          where: { linkedMemberId: memberId },
        });
        if (owner && owner.id !== partnerId)
          throw new ConflictException("该会员已绑定其他合作账户");
      }
      await tx.brandPartner.update({
        where: { id: partnerId },
        data: { linkedMemberId: memberId },
      });
      await tx.partnerSession.updateMany({
        where: { partnerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit(
        tx,
        actorId,
        "PARTNER_MEMBER_LINKED",
        partnerId,
        { beforeMemberId: partner.linkedMemberId, memberId },
        requestId,
      );
      return { linkedMemberId: memberId };
    });
  }

  async loginTicket(userId: string, sessionId: string, input: unknown) {
    const codeChallenge = String(safeObject(input).codeChallenge ?? "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge))
      throw new BadRequestException("请从合作平台重新发起登录");
    const token = randomToken(),
      expiresAt = new Date(Date.now() + 120_000);
    await this.prisma.$transaction(async (tx) => {
      const partner = await tx.brandPartner.findUnique({
        where: { linkedMemberId: userId },
      });
      if (!partner?.active)
        throw new ForbiddenException("该会员尚未开通有效的合作账户");
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partner.id}::uuid FOR SHARE`;
      const current = await tx.brandPartner.findUniqueOrThrow({
        where: { id: partner.id },
      });
      const source = await tx.userSession.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (
        !current.active ||
        current.linkedMemberId !== userId ||
        !source ||
        source.userId !== userId ||
        source.revokedAt ||
        source.expiresAt <= new Date() ||
        isH5PhoneTestSession(source.accessJti) ||
        !verifiedPartnerMember(source.user)
      )
        throw new UnauthorizedException("会员登录已失效，请重新登录");
      await tx.partnerLoginTicket.create({
        data: {
          tokenHash: sha256(token),
          codeChallenge,
          partnerId: current.id,
          memberSessionId: sessionId,
          partnerUpdatedAt: current.updatedAt,
          expiresAt,
        },
      });
    });
    return { ticket: token, expiresAt };
  }

  async redeemTicket(input: unknown) {
    const codeVerifier = String(safeObject(input).codeVerifier ?? "");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeVerifier))
      throw new UnauthorizedException("登录浏览器不匹配，请重新进入");
    const codeChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    const ticket = field(safeObject(input).ticket, "登录凭证", 200),
      tokenHash = sha256(ticket);
    const token = randomToken(),
      expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    return this.prisma.$transaction(async (tx) => {
      // Match account reset/disable locking before consuming the ticket.
      const initial = await tx.partnerLoginTicket.findUnique({
        where: { tokenHash },
      });
      if (!initial)
        throw new UnauthorizedException("登录链接已失效，请从商城重新进入");
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${initial.partnerId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT "tokenHash" FROM "PartnerLoginTicket" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;
      const current = await tx.partnerLoginTicket.findUniqueOrThrow({
        where: { tokenHash },
        include: { partner: true, memberSession: { include: { user: true } } },
      });
      const source = current.memberSession;
      if (current.codeChallenge !== codeChallenge)
        throw new UnauthorizedException("登录浏览器不匹配，请重新进入");
      if (
        current.consumedAt ||
        current.expiresAt <= new Date() ||
        !current.partner.active ||
        current.partner.updatedAt.getTime() !==
          current.partnerUpdatedAt.getTime() ||
        current.partner.linkedMemberId !== source.userId ||
        source.revokedAt ||
        source.expiresAt <= new Date() ||
        isH5PhoneTestSession(source.accessJti) ||
        !verifiedPartnerMember(source.user)
      )
        throw new UnauthorizedException("登录链接已失效，请从商城重新进入");
      await tx.partnerLoginTicket.update({
        where: { tokenHash },
        data: { consumedAt: new Date() },
      });
      await tx.partnerSession.create({
        data: {
          partnerId: current.partnerId,
          memberSessionId: source.id,
          tokenHash: sha256(token),
          expiresAt,
        },
      });
      return { token, expiresAt };
    });
  }
}
