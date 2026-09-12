import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import { isOwnPromoter } from "../common/member-promoter-identity";
import type { CommerceWithdrawalService } from "./commerce-withdrawal.service";
import { EmployeePromotionService } from "./employee-promotion.service";

function service(database: object) {
  return new EmployeePromotionService(
    database as PrismaService,
    {} as IntegrationSecretsService,
    {} as CommerceWithdrawalService,
  );
}

describe("member promotion identity", () => {
  it("creates a stable promoter for an ordinary member without enterprise WeChat", async () => {
    const created = {
      id: "promoter-1",
      wecomUserId: "member:member-1",
      active: true,
      referralCode: "MEMBER01",
    };
    const database = {
      user: {
        findUnique: vi.fn(async () => ({
          id: "member-1",
          nickname: "会员一",
          avatarUrl: null,
          mobile: null,
          mobileVerifiedAt: null,
        })),
      },
      commerceEmployee: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.wecomUserId ? null : null,
        ),
        upsert: vi.fn(async () => created),
      },
    };
    const instance = service(database);
    vi.spyOn(instance as any, "uniqueReferralCode").mockResolvedValue("MEMBER01");
    await expect(instance.memberPromoter("member-1")).resolves.toEqual(created);
    expect(database.commerceEmployee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wecomUserId: "member:member-1" },
        create: expect.objectContaining({
          name: "会员一",
          referralCode: "MEMBER01",
          departmentNames: [],
        }),
      }),
    );
  });

  it("keeps an ordinary member promoter separate from enterprise employee sessions", async () => {
    const promoter = {
      id: "member-promoter-1",
      wecomUserId: "member:member-1",
      mobile: "+8613800000000",
      active: true,
    };
    const database = {
      user: {
        findUnique: async () => ({
          id: "member-1",
          nickname: "会员一",
          avatarUrl: null,
          mobile: "+8613800000000",
          mobileVerifiedAt: new Date(),
        }),
      },
      commerceEmployee: {
        findUnique: async () => null,
        upsert: vi.fn(async () => promoter),
      },
    };
    const instance = service(database);
    vi.spyOn(instance as any, "uniqueReferralCode").mockResolvedValue("MEMBER02");
    await expect(instance.memberPromoter("member-1")).resolves.toBe(promoter);
    expect(database.commerceEmployee.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wecomUserId: "member:member-1" },
        create: expect.objectContaining({ mobile: "+8613800000000" }),
      }),
    );
  });

  it("recognizes both stable member IDs and verified mobile matches as self-referrals", () => {
    const member = {
      id: "member-1",
      mobile: "+86 138-0000-0000",
      mobileVerifiedAt: new Date(),
    };
    expect(
      isOwnPromoter(member, {
        wecomUserId: "member:member-1",
        mobile: null,
      }),
    ).toBe(true);
    expect(
      isOwnPromoter(member, {
        wecomUserId: "wecom-user-1",
        mobile: "+8613800000000",
      }),
    ).toBe(true);
    expect(
      isOwnPromoter(
        { ...member, mobileVerifiedAt: null },
        { wecomUserId: "wecom-user-1", mobile: "+8613800000000" },
      ),
    ).toBe(false);
  });

  it("does not reactivate a promoter account disabled by administration", async () => {
    const database = {
      user: {
        findUnique: async () => ({
          id: "member-1",
          nickname: "会员一",
          avatarUrl: null,
          mobile: null,
          mobileVerifiedAt: null,
        }),
      },
      commerceEmployee: {
        findUnique: async () => ({
          id: "promoter-1",
          wecomUserId: "member:member-1",
          name: "会员一",
          active: false,
        }),
        update: vi.fn(),
      },
    };
    await expect(service(database).memberPromoter("member-1")).rejects.toThrow(
      "推广账户已停用",
    );
    expect(database.commerceEmployee.update).not.toHaveBeenCalled();
  });
});
