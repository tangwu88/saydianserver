import { describe, expect, it } from "vitest";
import { UserStatus } from "@prisma/client";
import { anonymizedUserData } from "./account-deletion-worker";

describe("account deletion anonymization", () => {
  it("removes direct identifiers and remains deterministic for retries", () => {
    const first = anonymizedUserData("5b5e73ec-3353-4d5c-89bd-e9610c590cf2");
    const second = anonymizedUserData("5b5e73ec-3353-4d5c-89bd-e9610c590cf2");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      mobile: null,
      wechatUnionId: null,
      passwordHash: null,
      avatarUrl: null,
      status: UserStatus.DELETED,
    });
    expect(first.nickname).not.toContain("5b5e73ec");
  });
});
