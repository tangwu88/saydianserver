import { HttpStatus, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { envBoolean } from "./environment";
import type { RequestWithContext } from "./request-context";

@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  use(
    request: RequestWithContext,
    response: Response,
    next: NextFunction,
  ): void {
    const writeMethod = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const requestPath = (request.originalUrl || request.url || request.path)
      .split("?")[0]?.replace(/\/+$/, "");
    // Query strings and nested paths must not grant a write exemption.
    const exempt = requestPath === "/api/saydian-app/admin/v1/auth/login";
    if (writeMethod && !exempt && envBoolean("MAINTENANCE_READ_ONLY")) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        code: HttpStatus.SERVICE_UNAVAILABLE,
        message: "系统维护中，请稍后再试",
        data: null,
        timestamp: Math.floor(Date.now() / 1000),
        requestId: request.requestId,
      });
      return;
    }
    next();
  }
}
