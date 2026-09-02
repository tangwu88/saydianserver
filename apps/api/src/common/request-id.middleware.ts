import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import { randomUUID } from "node:crypto";
import type { RequestWithContext } from "./request-context";

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithContext, response: Response, next: NextFunction): void {
    const incoming = request.header("x-request-id")?.trim();
    request.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  }
}
