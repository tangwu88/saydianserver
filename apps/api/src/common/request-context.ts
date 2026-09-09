import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export interface AuthenticatedUser {
  id: string;
  sessionId: string;
}

export interface AuthenticatedEmployee {
  id: string;
}

export interface RequestWithContext extends Request {
  requestId: string;
  authUser?: AuthenticatedUser;
  authEmployee?: AuthenticatedEmployee;
  authAdmin?: {
    id: string;
    role: string;
    roles?: string[];
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

export const CurrentEmployee = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedEmployee => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.authEmployee) throw new Error("Authenticated employee is missing");
    return request.authEmployee;
  },
);
