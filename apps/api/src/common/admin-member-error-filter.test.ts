import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SafeHttpExceptionFilter } from "./http-exception.filter";

function filter(path: string, exception: unknown) {
  const json = vi.fn();
  const status = vi.fn((_status: number) => ({ json }));
  new SafeHttpExceptionFilter().catch(exception, {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: path, requestId: "synthetic-member-edit" }),
      getResponse: () => ({ status }),
    }),
  } as any);
  return { status: status.mock.calls[0]?.[0], payload: json.mock.calls[0]?.[0] };
}

describe("admin member editing error messages", () => {
  it.each(["", "/global"])("returns actionable profile errors on %s without arbitrary data", (prefix) => {
    const path = `${prefix}/api/saydian-app/admin/v1/members/synthetic/profile`;
    const result = filter(path, new BadRequestException({ message: "手机号和邮箱至少保留一项", data: { secret: "PRIVATE_SENTINEL" } }));
    expect(result).toMatchObject({ status: 400, payload: { message: "手机号和邮箱至少保留一项", data: null } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
    expect(filter(path, new ConflictException("会员信息已发生变化，请刷新后重试")).payload.message).toContain("请刷新后重试");
    expect(JSON.stringify(filter(path, new Error("PRIVATE_SENTINEL")))).not.toContain("PRIVATE_SENTINEL");
  });
  it("returns a points adjustment validation reason", () => {
    expect(filter("/api/saydian-app/admin/v1/members/synthetic/points-adjustments", new BadRequestException("积分余额不足")).payload.message).toBe("积分余额不足");
  });
  it.each([
    "/api/saydian-app/v2/members/me/profile",
    "/api/saydian-app/admin/v1/members/synthetic/profile-extra",
    "/api/saydian-app/admin/v1/members?next=/synthetic/profile",
  ])("preserves unrelated error behavior: %s", (path) => {
    expect(filter(path, new BadRequestException("输入不正确")).payload.message).toBe("The request could not be completed. Please check and try again.");
  });
});
