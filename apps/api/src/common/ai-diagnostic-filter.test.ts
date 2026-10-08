import {
  ServiceUnavailableException,
  BadRequestException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SafeHttpExceptionFilter } from "./http-exception.filter";

function filtered(
  exception: unknown,
  path = "/api/saydian-app/v2/ai/messages",
) {
  const json = vi.fn(),
    status = vi.fn((_status: number) => ({ json }));
  new SafeHttpExceptionFilter().catch(exception, {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: path, requestId: "synthetic" }),
      getResponse: () => ({ status }),
    }),
  } as any);
  return { status: status.mock.calls[0]![0], payload: json.mock.calls[0]![0] };
}
describe("AI public diagnostics whitelist", () => {
  it("preserves numeric metadata but drops response content and credentials", () => {
    const result = filtered(
      new ServiceUnavailableException({
        errorKey: "AI_PROVIDER_REJECTED",
        message: "AI unavailable",
        data: {
          upstreamStatus: 400,
          providerCode: "1211",
          durationMs: 42,
          secret: "PRIVATE_SENTINEL",
          content: "PRIVATE_SENTINEL",
        },
      }),
    );
    expect(result).toMatchObject({
      status: 503,
      payload: {
        code: 503,
        errorKey: "AI_PROVIDER_REJECTED",
        data: { upstreamStatus: 400, providerCode: "1211", durationMs: 42 },
      },
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
  });
  it("rejects forged metadata, preserves legacy HTTP semantics and arbitrary data exclusion", () => {
    const result = filtered(
      new ServiceUnavailableException({
        errorKey: "AI_PROVIDER_AUTH",
        message: "AI unavailable",
        data: {
          upstreamStatus: "PRIVATE_SENTINEL",
          providerCode: "PRIVATE_SENTINEL",
          durationMs: -1,
        },
      }),
      "/api/v1/ai/send",
    );
    expect(result.status).toBe(200);
    expect(result.payload.data).toEqual({
      upstreamStatus: null,
      providerCode: null,
      durationMs: null,
    });
    expect(
      filtered(
        new BadRequestException({
          errorKey: "OTHER",
          message: "bad",
          data: { secret: "PRIVATE_SENTINEL" },
        }),
      ).payload.data,
    ).toBeNull();
  });
});
