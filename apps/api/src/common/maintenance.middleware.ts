import { HttpStatus, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { businessWritesPaused, cutoverFlag, verifiedCallbackPaths } from "@saydian/app-contracts";
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
    const memberAuthentication = new Set([
      "/api/saydian-app/v2/auth/login", "/api/saydian-app/v2/auth/refresh", "/api/saydian-app/v2/auth/logout",
      "/api/v1/site/login", "/api/v1/site/refresh", "/api/v1/site/logout",
    ]);
    const exempt = request.method === "POST" && (
      requestPath === "/api/saydian-app/admin/v1/auth/login" ||
      verifiedCallbackPaths.has(requestPath ?? "") ||
      (cutoverFlag(process.env.MAINTENANCE_ALLOW_MEMBER_AUTH) && memberAuthentication.has(requestPath ?? ""))
    );
    const legacyReadMutation = request.method === "GET" && /^\/api\/v1\/member\/notify\/[^/]+$/.test(requestPath ?? "") &&
      !["/api/v1/member/notify/unread-count", "/api/v1/member/notify/statistics"].includes(requestPath ?? "");
    if ((writeMethod || legacyReadMutation) && !exempt && businessWritesPaused(process.env)) {
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
