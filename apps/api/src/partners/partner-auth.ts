import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { compare } from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { randomToken, safeObject, sha256 } from "../common/crypto";
import type { RequestWithContext } from "../common/request-context";

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
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BrandPartner" WHERE id = ${partner.id}::uuid FOR SHARE`;
      const current = await tx.brandPartner.findUniqueOrThrow({
        where: { id: partner.id },
      });
      if (!current.active || current.passwordHash !== partner.passwordHash)
        throw new UnauthorizedException("账号状态已变化，请重新登录");
      await tx.partnerSession.create({
        data: { partnerId: partner.id, tokenHash: sha256(token), expiresAt },
      });
    });
    return {
      token,
      expiresAt,
      user: {
        id: partner.id,
        partnerNo: partner.partnerNo,
        name: partner.name,
        username: partner.username,
        level: partner.level.name,
      },
    };
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
      include: { partner: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.partner.active
    )
      throw new UnauthorizedException("品牌伙伴登录已失效");
    request.authPartner = { id: session.partnerId, sessionId: session.id };
    return true;
  }
}
