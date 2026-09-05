import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { verify } from "jsonwebtoken";
import { PrismaService } from "../common/prisma.service";
import type { RequestWithContext } from "../common/request-context";
import { env } from "../common/environment";

interface EmployeeClaims {
  sub: string;
  typ: string;
}

@Injectable()
export class EmployeeAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const authorization = request.header("authorization")?.trim() ?? "";
    const token = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!token) throw new UnauthorizedException("请从企业微信工作台重新进入");
    try {
      const claims = verify(
        token,
        env("EMPLOYEE_TOKEN_SECRET", env("ACCESS_TOKEN_SECRET")),
        {
          algorithms: ["HS256"],
          issuer: "saydianapp-server",
          audience: "saydian-commerce-employee",
        },
      ) as EmployeeClaims;
      if (claims.typ !== "employee" || !claims.sub) throw new Error("invalid claims");
      const employee = await this.prisma.commerceEmployee.findFirst({
        where: { id: claims.sub, active: true },
        select: { id: true },
      });
      if (!employee) throw new Error("inactive employee");
      request.authEmployee = { id: employee.id };
      return true;
    } catch {
      throw new UnauthorizedException("员工登录已失效，请从企业微信工作台重新进入");
    }
  }
}
