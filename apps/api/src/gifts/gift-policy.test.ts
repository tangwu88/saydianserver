import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { canAdminResource } from "@saydian/app-contracts";
import {
  formatGiftCardNo,
  giftCardNumber,
  giftCheckCode,
  giftCsv,
  giftSecret,
  assertGiftAvailable,
  giftAvailability,
} from "./gift-policy";
import { GiftAdminController } from "./gift.controller";
describe("gift credentials and authorization", () => {
  it("allows ERP replenishment while keeping local stock bounded and estimates dispatch per SKU", () => {
    for (const source of ["ERP", "LOCAL"]) {
      expect(giftAvailability(source, 1)).toEqual({
        redeemable: true,
        estimatedDispatchDays: 2,
      });
      for (const stock of [0, -3])
        expect(giftAvailability(source, stock)).toEqual({
          redeemable: source === "ERP",
          estimatedDispatchDays: 7,
        });
    }
  });
  it("formats fixed eight-digit numbers and refuses silent overflow", () => {
    expect(formatGiftCardNo(12, 35)).toBe("81200035");
    expect(formatGiftCardNo(1, 1)).toBe("80100001");
    expect(() => formatGiftCardNo(100, 1)).toThrow();
    expect(() => formatGiftCardNo(1, 100000)).toThrow();
    expect(giftCardNumber("81200035")).toBe("81200035");
    expect(() => giftCardNumber("11200035")).toThrow();
    expect(giftCheckCode("012345")).toBe("012345");
    expect(() => giftCheckCode("12345")).toThrow();
    for (let i = 0; i < 100; i++) expect(giftSecret()).toMatch(/^\d{6}$/);
  });
  it("escapes CSV formulas and commas without executable cells", () => {
    const csv = giftCsv([["=HYPERLINK(x)", "81200035", "123456", '礼品,"大"']]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("'=HYPERLINK(x)");
    expect(csv).toContain('礼品,""大""');
  });
  it("restricts every secret-bearing or mutating admin route to super administrators", () => {
    for (const method of ["generate", "change", "configure", "qr"] as const)
      expect(
        Reflect.getMetadata(
          "saydian.admin-roles",
          GiftAdminController.prototype[method],
        ),
      ).toEqual(["SUPER_ADMIN"]);
    expect(
      canAdminResource("COMMERCE_OPERATIONS", "commerce-gifts", "read"),
    ).toBe(true);
    expect(
      canAdminResource("COMMERCE_OPERATIONS", "commerce-gifts", "write"),
    ).toBe(false);
  });
  it("rejects inactive and expired cards", () => {
    for (const status of ["DRAFT", "VOID", "REDEEMED"])
      expect(() => assertGiftAvailable({ status, expiresAt: null })).toThrow();
    expect(() =>
      assertGiftAvailable({ status: "ACTIVE", expiresAt: new Date(0) }),
    ).toThrow();
  });
});
