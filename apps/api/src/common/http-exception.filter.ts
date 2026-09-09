import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithContext } from "./request-context";
import { isGlobalRealm } from "./deployment-realm";

function errorMessage(exception: unknown): {
  message: string;
  data: Record<string, unknown> | null;
} {
  if (!(exception instanceof HttpException)) {
    return { message: "服务暂时不可用，请稍后再试", data: null };
  }
  const response = exception.getResponse();
  if (typeof response === "string") return { message: response, data: null };
  const payload = response as Record<string, unknown>;
  const rawMessage = payload.message;
  const messages = Array.isArray(rawMessage)
    ? rawMessage.map(String)
    : rawMessage
      ? [String(rawMessage)]
      : [exception.message];
  return {
    message: messages[0] ?? "请求失败",
    data: messages.length > 1 ? { errors: { request: messages } } : null,
  };
}

function isLegacyPath(path: string): boolean {
  return (
    path.startsWith("/api/v1/") ||
    path.startsWith("/api/rf-article/") ||
    path.startsWith("/api/inv-shop/v1/")
  );
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithContext>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const details = errorMessage(exception);
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const errorKey = raw && typeof raw === "object" && "errorKey" in raw && typeof raw.errorKey === "string" ? raw.errorKey : undefined;
    const legacy = isLegacyPath(request.originalUrl || request.url || request.path);
    response.status(legacy ? HttpStatus.OK : status).json({
      code: status,
      message: isGlobalRealm() && !errorKey && /[\u3400-\u9fff]/.test(details.message)
        ? (status === 401 ? "Please sign in again." : status === 503 ? "This service is temporarily unavailable. Please try again later." : "The request could not be completed. Please check and try again.")
        : details.message,
      ...(errorKey ? { errorKey } : {}),
      data: details.data,
      timestamp: Math.floor(Date.now() / 1000),
      ...(legacy ? {} : { requestId: request.requestId }),
    });
  }
}
