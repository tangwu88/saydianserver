import { describe, expect, it } from "vitest";
import { Prisma, UserStatus } from "@prisma/client";
import { anonymizedOrderData, anonymizedUserData } from "./account-deletion-worker";

describe("account deletion anonymization", () => {
  it("removes direct identifiers and remains deterministic for retries", () => {
    const first = anonymizedUserData("5b5e73ec-3353-4d5c-89bd-e9610c590cf2");
    const second = anonymizedUserData("5b5e73ec-3353-4d5c-89bd-e9610c590cf2");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      mobile: null,
      wechatUnionId: null,
      wechatOpenId: null,
      passwordHash: null,
      avatarUrl: null,
      status: UserStatus.DELETED,
      referralEmployeeId: null,
    });
    expect(first.nickname).not.toContain("5b5e73ec");
  });

  it("removes delivery and invoice data while retaining the financial order row", () => {
    expect(anonymizedOrderData()).toEqual({
      recipientName: "已注销用户",
      recipientMobile: "",
      province: "",
      city: "",
      district: "",
      addressDetail: "",
      buyerRemark: null,
      invoiceJson: Prisma.DbNull,
    });
  });
});
