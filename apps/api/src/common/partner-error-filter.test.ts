import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SafeHttpExceptionFilter } from "./http-exception.filter";

function filter(path: string, exception: unknown) {
  const json = vi.fn(),
    status = vi.fn((_status: number) => ({ json }));
  new SafeHttpExceptionFilter().catch(exception, {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: path, requestId: "synthetic-partner" }),
      getResponse: () => ({ status }),
    }),
  } as any);
  return {
    status: status.mock.calls[0]?.[0],
    payload: json.mock.calls[0]?.[0],
  };
}

describe("brand partner public error messages", () => {
  it.each(["", "/global"])(
    "preserves invalid promotion status and actionable Chinese text under %s",
    (prefix) => {
      const result = filter(
        `${prefix}/api/saydian-app/vip/v1/public/promotion/invalid`,
        new NotFoundException("品牌伙伴推广链接已失效"),
      );
      expect(result).toMatchObject({
        status: 404,
        payload: { code: 404, message: "品牌伙伴推广链接已失效", data: null },
      });
    },
  );
  it("preserves partner login messages while continuing to redact arbitrary exception data", () => {
    const result = filter(
      "/api/saydian-app/vip/v1/auth/login",
      new BadRequestException({
        message: "品牌伙伴账户已停用",
        data: { secret: "PRIVATE_SENTINEL" },
      }),
    );
    expect(result.payload.message).toBe("品牌伙伴账户已停用");
    expect(result.payload.data).toBeNull();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    const unknown = filter(
      "/api/saydian-app/vip/v1/wallet",
      new Error("PRIVATE_SENTINEL"),
    );
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(unknown)).not.toContain("PRIVATE_SENTINEL");
  });
  it.each(["partners", "partner-levels", "partner-prices", "partner-finance"])(
    "preserves actionable admin %s errors for both API aliases",
    (resource) => {
      for (const prefix of ["", "/global"]) {
        const result = filter(
          `${prefix}/api/saydian-app/admin/v1/${resource}?page=1`,
          new BadRequestException("密码须为10至128个字符"),
        );
        expect(result).toMatchObject({
          status: 400,
          payload: { code: 400, message: "密码须为10至128个字符", data: null },
        });
      }
    },
  );
  it("retains reset-password and duplicate account messages without exposing exception data", () => {
    const path = "/api/saydian-app/admin/v1/partners/synthetic/reset-password";
    const result = filter(
      path,
      new BadRequestException({
        message: "密码须为10至128个字符",
        data: { password: "PRIVATE_SENTINEL" },
      }),
    );
    expect(result.payload.message).toBe("密码须为10至128个字符");
    expect(result.payload.data).toBeNull();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    expect(
      JSON.stringify(filter(path, new Error("PRIVATE_SENTINEL"))),
    ).not.toContain("PRIVATE_SENTINEL");
  });
  it.each([
    "/api/saydian-app/admin/v1/users",
    "/api/saydian-app/admin/v1/partners-other",
    "/api/saydian-app/admin/v1/users?next=/partners",
    "/global/api/saydian-app/admin/v10/partners",
  ])("does not change unrelated admin errors for %s", (path) => {
    expect(filter(path, new BadRequestException("输入不正确"))).toMatchObject({
      status: 400,
      payload: {
        message:
          "The request could not be completed. Please check and try again.",
      },
    });
  });
  it.each([
    "/api/saydian-app/v2/auth/login",
    "/api/saydian-app/vip/v10/auth/login",
    "/api/saydian-app/v2/auth/login?next=/api/saydian-app/vip/v1/",
  ])("keeps existing international handling for %s", (path) => {
    expect(filter(path, new UnauthorizedException("登录已失效"))).toMatchObject(
      { status: 401, payload: { message: "Please sign in again." } },
    );
  });
});
