import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { verify } from "jsonwebtoken";
import { UserStatus } from "@prisma/client";
import { env } from "./environment";
import { PrismaService } from "./prisma.service";
import type { RequestWithContext } from "./request-context";

interface AccessClaims {
  sub: string;
  sid: string;
  typ: string;
  jti: string;
}

function bearerToken(request: RequestWithContext): string {
  const authorization = request.header("authorization")?.trim() ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  if (request.path.startsWith("/api/v1/")) {
    return request.header("token")?.trim() ?? "";
  }
  return "";
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException("请先登录");
    try {
      const claims = verify(token, env("ACCESS_TOKEN_SECRET"), {
        algorithms: ["HS256"],
        issuer: "saydianapp-server",
        audience: "saydian-app",
      }) as AccessClaims;
      if (claims.typ !== "access" || !claims.sub || !claims.sid || !claims.jti) {
        throw new Error("invalid claims");
      }
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: claims.sid,
          userId: claims.sub,
          accessJti: claims.jti,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: UserStatus.ACTIVE },
        },
        select: { id: true },
      });
      if (!session) throw new Error("inactive session");
      request.authUser = { id: claims.sub, sessionId: claims.sid };
      return true;
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }
}
