import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { verify } from "jsonwebtoken";
import { UserStatus } from "@prisma/client";
import { env } from "./environment";
import { PrismaService } from "./prisma.service";
import type { RequestWithContext } from "./request-context";
import { resolveLegacySession } from "./legacy-session-bridge";
import { requiresVerifiedCommerceMobile } from "./commerce-mobile-policy";
import { authAudience, authIssuer, isGlobalRealm } from "./deployment-realm";
import { AuthService } from "../auth/auth.service";
import { isH5PhoneTestSession } from "../auth/global-wechat-policy";

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
  constructor(private readonly prisma: PrismaService, @Optional() private readonly auth?: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const path = (request.originalUrl || request.url || request.path).split("?")[0] || request.path;
    const token = bearerToken(request);
    if (!token) throw new UnauthorizedException("请先登录");
    try {
      const claims = verify(token, env("ACCESS_TOKEN_SECRET"), {
        algorithms: ["HS256"],
        issuer: authIssuer(),
        audience: authAudience(),
      }) as AccessClaims;
      if (claims.typ !== "access" || !claims.sub || !claims.sid || !claims.jti) {
        throw new Error("invalid claims");
      }
      const temporary = isH5PhoneTestSession(claims.jti);
      let testAppId: string | undefined;
      if (temporary) {
        if (!(request.method === "GET" && path === "/api/saidian-mall/v1/auth/wechat/h5/account") &&
            !(request.method === "POST" && path === "/api/saydian-app/v2/auth/logout")) throw new Error("temporary session scope");
        if (!this.auth) throw new Error("temporary session verifier missing");
        testAppId = await this.auth.phoneTestAppId();
      }
      const session = await this.prisma.userSession.findFirst({
        where: {
          id: claims.sid,
          userId: claims.sub,
          accessJti: claims.jti,
          revokedAt: null,
          expiresAt: { gt: new Date() },
          user: { status: UserStatus.ACTIVE,
            ...(temporary ? { wechatOfficialIdentities: { some: { appId: testAppId! } } } : requiresVerifiedCommerceMobile(path) ? (isGlobalRealm()
              ? { OR: [{ mobile: { not: null }, mobileVerifiedAt: { not: null } }, { email: { not: null }, emailVerifiedAt: { not: null } }] }
              : { mobile: { not: null }, mobileVerifiedAt: { not: null } }) : {}),
          },
        },
        select: { id: true },
      });
      if (!session) throw new Error("inactive session");
      request.authUser = { id: claims.sub, sessionId: claims.sid };
      return true;
    } catch {
      const imported = await resolveLegacySession(this.prisma, token, path);
      if (imported) {
        request.authUser = imported;
        return true;
      }
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }
}
