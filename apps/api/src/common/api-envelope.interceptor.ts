import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, map } from "rxjs";
import type { ApiEnvelope } from "@saydian/app-contracts";
import type { RequestWithContext } from "./request-context";
import { RAW_RESPONSE_KEY } from "./raw-response.decorator";

@Injectable()
export class ApiEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    return next.handle().pipe(
      map(
        (data): ApiEnvelope<unknown> => ({
          code: 200,
          message: "OK",
          data: data ?? null,
          timestamp: Math.floor(Date.now() / 1000),
          requestId: request.requestId,
        }),
      ),
    );
  }
}
