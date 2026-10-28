import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { compare, hash } from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { randomToken, safeObject, sha256 } from "../common/crypto";
import type { RequestWithContext } from "../common/request-context";
import { verifiedPartnerMember } from "./partner-onboarding.service";
import { isH5PhoneTestSession } from "../auth/global-wechat-policy";

@Injectable()
export class PartnerAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: unknown) {
    const body = safeObject(input),
      username = String(body.username ?? "").trim(),
      password = String(body.password ?? "");
    if (username.length > 80 || password.length > 128)
      throw new BadRequestException("账号或密码格式不正确");
    const partner = await this.prisma.brandPartner.findUnique({
      where: { username },
      include: { level: true },
    });
    if (!partner?.active || !(await compare(password, partner.passwordHash)))
      throw new UnauthorizedException("账号或密码错误");
    const token = randomToken(),
      expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const mustChangePassword = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partner.id}::uuid FOR SHARE`;
      const current = await tx.brandPartner.findUniqueOrThrow({
        where: { id: partner.id },
      });
      if (!current.active || current.passwordHash !== partner.passwordHash)
        throw new UnauthorizedException("账号状态已变化，请重新登录");
      await tx.partnerSession.create({
        data: { partnerId: partner.id, tokenHash: sha256(token), expiresAt },
      });
      return current.mustChangePassword;
    });
    return {
      token,
      expiresAt,
      mustChangePassword,
      user: {
        id: partner.id,
        partnerNo: partner.partnerNo,
        name: partner.name,
        username: partner.username,
        level: partner.level.name,
      },
    };
  }

  async changePassword(
    partnerId: string,
    sessionId: string,
    input: unknown,
    requestId: string,
  ) {
    const body = safeObject(input);
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";
    if (
      !currentPassword ||
      currentPassword.length > 128 ||
      newPassword.length < 10 ||
      Buffer.byteLength(newPassword, "utf8") > 72
    )
      throw new BadRequestException(
        "新密码至少10个字符，最多72个字节（中文通常占3个字节）",
      );
    if (newPassword !== body.confirmPassword)
      throw new BadRequestException("两次输入的新密码不一致");
    const passwordHash = await hash(newPassword, 12);
    const token = randomToken(),
      expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partnerId}::uuid FOR UPDATE`;
      const partner = await tx.brandPartner.findUnique({
        where: { id: partnerId },
      });
      const session = await tx.partnerSession.findUnique({
        where: { id: sessionId },
      });
      if (
        !partner?.active ||
        !session ||
        session.partnerId !== partnerId ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      )
        throw new UnauthorizedException("品牌伙伴登录已失效");
      if (!(await compare(currentPassword, partner.passwordHash)))
        throw new BadRequestException("当前密码不正确");
      if (await compare(newPassword, partner.passwordHash))
        throw new BadRequestException("新密码不能与当前密码相同");
      await tx.brandPartner.update({
        where: { id: partnerId },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.partnerSession.updateMany({
        where: { partnerId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.partnerSession.create({
        data: {
          partnerId,
          memberSessionId: session.memberSessionId,
          tokenHash: sha256(token),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: "PARTNER",
          actorId: partnerId,
          action: "PARTNER_PASSWORD_CHANGED",
          entityType: "BRAND_PARTNER",
          entityId: partnerId,
          afterJson: { sessionsRevoked: true },
          requestId,
        },
      });
    });
    return { token, expiresAt, mustChangePassword: false };
  }

  async logout(sessionId: string) {
    await this.prisma.partnerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }
}

@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const authorization = request.header("authorization")?.trim() ?? "";
    const token = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!token) throw new UnauthorizedException("请先登录品牌伙伴平台");
    const session = await this.prisma.partnerSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { partner: true, memberSession: { include: { user: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.partner.active
    )
      throw new UnauthorizedException("品牌伙伴登录已失效");
    if (session.memberSessionId) {
      const source = session.memberSession;
      if (
        !source ||
        source.revokedAt ||
        source.expiresAt <= new Date() ||
        isH5PhoneTestSession(source.accessJti) ||
        source.userId !== session.partner.linkedMemberId ||
        !verifiedPartnerMember(source.user)
      )
        throw new UnauthorizedException("会员登录已失效，请从商城重新进入");
    }
    const path = (
      (request.originalUrl || request.path || "").split("?")[0] ?? ""
    ).replace(/\/$/, "");
    if (
      session.partner.mustChangePassword &&
      !/\/vip\/v1\/auth\/(?:me|logout|change-password)$/.test(path)
    )
      throw new ForbiddenException({
        errorKey: "PARTNER_PASSWORD_CHANGE_REQUIRED",
        message: "请先修改初始密码后继续使用",
      });
    if (
      !/\/vip\/v1\/(?:auth\/(?:me|logout|change-password)|agreement(?:\/accept)?)$/.test(
        path,
      )
    ) {
      const agreement = await this.prisma.partnerAgreement.findFirst({
        where: { active: true, status: "PUBLISHED" },
        select: { id: true },
      });
      if (
        agreement &&
        !(
          await this.prisma.partnerAgreementAcceptance.findUnique({
            where: {
              partnerId_agreementId: {
                partnerId: session.partnerId,
                agreementId: agreement.id,
              },
            },
            select: { acceptedAt: true },
          })
        )?.acceptedAt
      )
        throw new ForbiddenException({
          errorKey: "PARTNER_AGREEMENT_REQUIRED",
          message: "请先阅读并同意合作协议",
        });
    }
    request.authPartner = { id: session.partnerId, sessionId: session.id };
    return true;
  }
}
