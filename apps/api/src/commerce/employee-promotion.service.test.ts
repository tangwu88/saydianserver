import { describe, expect, it } from "vitest";
import {
  employeeCouponQuantity,
  validateEmployeeRedirectUri,
} from "./employee-promotion.service";

describe("employee promotion boundaries", () => {
  it("only accepts allowlisted HTTPS redirects in production", () => {
    const allowed = new Set(["app.saydian.cn"]);
    expect(
      validateEmployeeRedirectUri(
        "https://app.saydian.cn/saidian-mall/#/pages/employee/index",
        allowed,
        true,
      ),
    ).toContain("app.saydian.cn");
    expect(() =>
      validateEmployeeRedirectUri(
        "https://example.invalid/callback",
        allowed,
        true,
      ),
    ).toThrow("不在允许范围");
    expect(() =>
      validateEmployeeRedirectUri(
        "http://app.saydian.cn/callback",
        allowed,
        true,
      ),
    ).toThrow("不正确");
  });

  it("caps employee coupon allocation to the configured batch size", () => {
    expect(employeeCouponQuantity(8, 3)).toBe(3);
    expect(employeeCouponQuantity(0, 3)).toBe(1);
    expect(employeeCouponQuantity("invalid", 3)).toBe(1);
  });
});
