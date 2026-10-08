import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import type { RequestWithContext } from "./request-context";

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
    // Only the fixed AI diagnostic shape is public; never forward arbitrary data.
    data:
      typeof payload.errorKey === "string" &&
      /^AI_PROVIDER_(AUTH|LIMIT|REJECTED|UNAVAILABLE|TIMEOUT|NETWORK|INVALID_RESPONSE)$/.test(
        payload.errorKey,
      )
        ? safeAiDiagnostic(payload.data)
        : messages.length > 1
          ? { errors: { request: messages } }
          : null,
  };
}

function safeAiDiagnostic(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  return {
    upstreamStatus:
      typeof value.upstreamStatus === "number" &&
      Number.isInteger(value.upstreamStatus) &&
      value.upstreamStatus >= 100 &&
      value.upstreamStatus <= 599
        ? value.upstreamStatus
        : null,
    providerCode:
      typeof value.providerCode === "string" &&
      /^\d{3,6}$/.test(value.providerCode)
        ? value.providerCode
        : null,
    durationMs:
      typeof value.durationMs === "number" &&
      Number.isInteger(value.durationMs) &&
      value.durationMs >= 0 &&
      value.durationMs <= 300_000
        ? value.durationMs
        : null,
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
    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const errorKey =
      raw &&
      typeof raw === "object" &&
      "errorKey" in raw &&
      typeof raw.errorKey === "string"
        ? raw.errorKey
        : undefined;
    const legacy = isLegacyPath(
      request.originalUrl || request.url || request.path,
    );
    response.status(legacy ? HttpStatus.OK : status).json({
      code: status,
      message:
        !errorKey && /[\u3400-\u9fff]/.test(details.message)
          ? status === 401
            ? "Please sign in again."
            : status === 503
              ? "This service is temporarily unavailable. Please try again later."
              : "The request could not be completed. Please check and try again."
          : details.message,
      ...(errorKey ? { errorKey } : {}),
      data: details.data,
      timestamp: Math.floor(Date.now() / 1000),
      ...(legacy ? {} : { requestId: request.requestId }),
    });
  }
}
