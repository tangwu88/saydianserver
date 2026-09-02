import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { Observable, concatMap } from "rxjs";
import { PrismaService } from "../common/prisma.service";
import type { RequestWithContext } from "../common/request-context";

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext & Request>();
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || !request.authAdmin) {
      return next.handle();
    }
    return next.handle().pipe(
      concatMap(async (data) => {
        await this.prisma.auditLog.create({
          data: {
            actorType: "ADMIN",
            actorId: request.authAdmin!.id,
            action: `${request.method} ${request.route?.path ?? request.path}`.slice(0, 255),
            entityType: "ADMIN_API",
            entityId: request.path.slice(0, 255),
            requestId: request.requestId,
          },
        });
        return data;
      }),
    );
  }
}
