import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

export interface RequestWithContext extends Request {
  requestId: string;
  authUser?: AuthenticatedUser;
  authAdmin?: {
    id: string;
    role: string;
    sessionId: string;
  };
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.authUser) throw new Error("Authenticated user is missing");
    return request.authUser;
  },
);

export const CurrentAdmin = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): NonNullable<RequestWithContext["authAdmin"]> => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.authAdmin) throw new Error("Authenticated admin is missing");
    return request.authAdmin;
  },
);
