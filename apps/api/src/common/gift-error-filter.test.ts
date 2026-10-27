import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { SafeHttpExceptionFilter } from "./http-exception.filter";

function filtered(path: string, exception: unknown) {
  const json = vi.fn();
  const status = vi.fn((_status: number) => ({ json }));
  new SafeHttpExceptionFilter().catch(exception, {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: path, requestId: "gift-http-fixture" }),
      getResponse: () => ({ status }),
    }),
  } as any);
  return {
    status: status.mock.calls[0]?.[0],
    payload: json.mock.calls[0]?.[0],
  };
}

describe("gift redemption actionable errors", () => {
  it.each(["", "/global"])(
    "keeps safe business reasons and HTTP statuses for the %s storefront alias",
    (prefix) => {
      for (const [endpoint, exception, status, message] of [
        [
          "validate",
          new BadRequestException("卡号或校验码不正确"),
          400,
          "卡号或校验码不正确",
        ],
        [
          "validate",
          new ConflictException("兑换卡尚未启用，请联系发卡方"),
          409,
          "兑换卡尚未启用，请联系发卡方",
        ],
        [
          "validate",
          new ConflictException("兑换卡已过期，请联系发卡方"),
          409,
          "兑换卡已过期，请联系发卡方",
        ],
        [
          "validate",
          new ConflictException("兑换卡已作废，请联系发卡方"),
          409,
          "兑换卡已作废，请联系发卡方",
        ],
        [
          "validate",
          new ConflictException("该卡已兑换，请登录兑换手机号查看订单"),
          409,
          "该卡已兑换，请登录兑换手机号查看订单",
        ],
        [
          "session",
          new UnauthorizedException("兑换验证已失效，请重新输入卡号和校验码"),
          401,
          "兑换验证已失效，请重新输入卡号和校验码",
        ],
        [
          "submit",
          new ForbiddenException("请使用本次短信验证的手机号继续兑换"),
          403,
          "请使用本次短信验证的手机号继续兑换",
        ],
        [
          "sms/request",
          new ServiceUnavailableException("短信服务暂时不可用，请稍后再试"),
          503,
          "短信服务暂时不可用，请稍后再试",
        ],
      ] as const) {
        expect(
          filtered(
            `${prefix}/api/saidian-mall/v1/storefront/gift-redemptions/${endpoint}`,
            exception,
          ),
        ).toMatchObject({
          status,
          payload: { code: status, message, data: null },
        });
      }
    },
  );

  it.each(["", "/global"])(
    "localizes both persistent and HTTP guard rate limits under %s",
    (prefix) => {
      for (const reason of [
        "操作过于频繁，请稍后再试",
        "ThrottlerException: Too Many Requests",
      ]) {
        expect(
          filtered(
            `${prefix}/api/saidian-mall/v1/storefront/gift-redemptions/validate`,
            new HttpException(reason, 429),
          ),
        ).toMatchObject({
          status: 429,
          payload: { message: "操作过于频繁，请稍后再试" },
        });
      }
    },
  );

  it.each(["batches", "cards", "redemptions", "products", "settings"])(
    "preserves actionable admin %s messages for both aliases and nested resources",
    (resource) => {
      for (const prefix of ["", "/global"]) {
        const path = `${prefix}/api/saydian-app/admin/v1/commerce-gift-${resource}`;
        expect(
          filtered(
            path + "?page=1",
            new BadRequestException("请选择商品和允许兑换的规格"),
          ),
        ).toMatchObject({
          status: 400,
          payload: { message: "请选择商品和允许兑换的规格" },
        });
        expect(
          filtered(
            path + "/fixture/qr",
            new ForbiddenException("仅总管理员可执行此操作"),
          ),
        ).toMatchObject({
          status: 403,
          payload: { message: "仅总管理员可执行此操作" },
        });
      }
    },
  );

  it("keeps unknown exceptions and arbitrary exception data private", () => {
    for (const path of [
      "/api/saidian-mall/v1/storefront/gift-redemptions/validate",
      "/global/api/saydian-app/admin/v1/commerce-gift-cards",
    ]) {
      const unknown = filtered(path, new Error("DATABASE_SECRET_SENTINEL"));
      expect(unknown.status).toBe(500);
      expect(JSON.stringify(unknown)).not.toContain("DATABASE_SECRET_SENTINEL");
      const business = filtered(
        path,
        new BadRequestException({
          message: "卡号或校验码不正确",
          data: {
            checkCode: "PRIVATE_SENTINEL",
            secretHash: "PRIVATE_SENTINEL",
          },
        }),
      );
      expect(business.payload.message).toBe("卡号或校验码不正确");
      expect(business.payload.data).toBeNull();
      expect(JSON.stringify(business)).not.toContain("PRIVATE_SENTINEL");
    }
  });

  it.each([
    "/api/saidian-mall/v1/storefront/gift-redemptions-other/validate",
    "/api/saidian-mall/v1/storefront/products?next=/gift-redemptions",
    "/api/saydian-app/admin/v1/commerce-gift-cards-other",
    "/api/saydian-app/admin/v1/users?next=/commerce-gift-cards",
    "/api/saydian-app/v2/auth/login",
  ])("preserves unrelated error handling for %s", (path) => {
    expect(filtered(path, new BadRequestException("输入不正确"))).toMatchObject(
      {
        status: 400,
        payload: {
          message:
            "The request could not be completed. Please check and try again.",
        },
      },
    );
    expect(
      filtered(path, new UnauthorizedException("登录已失效")),
    ).toMatchObject({
      status: 401,
      payload: { message: "Please sign in again." },
    });
  });
});
