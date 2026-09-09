import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AdminRole } from "@prisma/client";
import { compare } from "bcryptjs";
import { PrismaService } from "../common/prisma.service";
import { randomToken, sha256 } from "../common/crypto";
import type { RequestWithContext } from "../common/request-context";
import { canAdminResource } from "@saydian/app-contracts";

const ADMIN_ROLES_KEY = "saydian.admin-roles";
export const AdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);

@Injectable()
export class AdminAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(username: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { username } });
    if (!admin?.active || !(await compare(password, admin.passwordHash))) {
      throw new UnauthorizedException("账号或密码错误");
    }
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const session = await this.prisma.adminSession.create({
      data: { adminId: admin.id, tokenHash: sha256(token), expiresAt },
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      user: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        roles: admin.roles?.length ? admin.roles : [admin.role],
      },
      sessionId: session.id,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const authorization = request.header("authorization")?.trim() ?? "";
    const token = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!token) throw new UnauthorizedException("请先登录后台");
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { admin: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.admin.active
    ) {
      throw new UnauthorizedException("后台登录已失效");
    }
    const roles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const grantedRoles = session.admin.roles?.length ? session.admin.roles : [session.admin.role];
    if (roles?.length && !grantedRoles.some((role) => roles.includes(role))) {
      throw new ForbiddenException("当前账号无权执行此操作");
    }
    const path = request.path.replace(/^\/api\/saydian-app\/admin\/v1\/?/, "");
    const resource = path.split("/")[0] || "dashboard";
    const action = ["GET", "HEAD"].includes(request.method) ? "read"
      : /\/(?:refunds?|shipping-refunds)$/.test(path) ? "refund" : "write";
    if (!canAdminResource(grantedRoles, resource, action)) {
      throw new ForbiddenException("当前角色无权访问此业务模块");
    }
    request.authAdmin = {
      id: session.admin.id,
      role: session.admin.role,
      roles: grantedRoles,
      sessionId: session.id,
    };
    return true;
  }
}
