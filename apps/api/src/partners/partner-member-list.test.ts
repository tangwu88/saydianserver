import "reflect-metadata";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { PartnerController } from "./partner.controller";
import { PartnerMembersService } from "./partner-members.service";

function fixture(code = "distribution-1") {
  const member = {
    id: "member-owned",
    compatibilityId: 271,
    nickname: "合成会员",
    mobile: "+8613812345678",
    email: "synthetic@example.invalid",
    avatarUrl: null,
    gender: "FEMALE",
    birthday: new Date("1996-05-20"),
    heightCm: "165.5",
    weightKg: "56.2",
    createdAt: new Date("2026-11-07"),
    _count: { devices: 0, healthRecords: 0 },
    passwordHash: "must-never-leave-server",
    healthProfile: { private: true },
  };
  const tx = {
    brandPartner: {
      findUnique: vi.fn(async () => ({
        active: true,
        level: { code, active: true },
      })),
    },
    user: {
      findMany: vi.fn(async () => [member]),
      count: vi.fn(async () => 1),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const transaction = vi.fn((fn: any) => fn(tx));
  return {
    tx,
    transaction,
    service: new PartnerMembersService(
      { $transaction: transaction } as any,
      {} as any,
    ),
  };
}
describe("partner member list basics and health boundaries", () => {
  it("prevents shared or browser caching of personal list data", () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, PartnerController.prototype.members)).toContainEqual({ name: "Cache-Control", value: "private, no-store" });
  });
  it("returns strategic demographics in one scoped paginated query and audits the read", async () => {
    const h = fixture(),
      result = await h.service.members(
        "partner-current",
        "271",
        2,
        "request-current",
      );
    expect(h.tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          partnerId: "partner-current",
          status: { not: "DELETED" },
          OR: expect.arrayContaining([{ compatibilityId: 271 }]),
        }),
        skip: 30,
        take: 30,
        select: expect.objectContaining({
          birthday: true,
          heightCm: true,
          weightKg: true,
          _count: { select: { devices: true, healthRecords: true } },
        }),
      }),
    );
    expect(result.items[0]).toMatchObject({
      memberNo: "271",
      heightCm: "165.5",
      weightKg: "56.2",
      _count: { devices: 0, healthRecords: 0 },
    });
    expect(result.items[0]).not.toHaveProperty("passwordHash");
    expect(result.items[0]).not.toHaveProperty("healthProfile");
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorType: "PARTNER",
          actorId: "partner-current",
          requestId: "request-current",
          entityType: "USER_PROFILE_LIST",
          afterJson: expect.objectContaining({ returnedCount: 1, page: 2 }),
        }),
      }),
    );
    expect(JSON.stringify(h.tx.auditLog.create.mock.calls)).not.toContain(
      "165.5",
    );
  });
  it.each(["distribution-2", "distribution-3"])(
    "does not select or return health-related fields for %s even from an overbroad fixture",
    async (code) => {
      const h = fixture(code),
        result = await h.service.members(
          "partner-current",
          "",
          1,
          "request-basic",
        );
      const select = (h.tx.user.findMany.mock.calls[0] as any)[0].select;
      expect(select).not.toHaveProperty("birthday");
      expect(select).not.toHaveProperty("heightCm");
      expect(select).not.toHaveProperty("weightKg");
      expect(select._count.select).not.toHaveProperty("healthRecords");
      expect(result.canViewMemberHealth).toBe(false);
      for (const key of [
        "birthday",
        "heightCm",
        "weightKg",
        "healthProfile",
        "passwordHash",
      ])
        expect(result.items[0]).not.toHaveProperty(key);
      expect(result.items[0]?._count).toEqual({ devices: 0 });
    },
  );
  it("checks the current tier again after a downgrade", async () => {
    const h = fixture();
    expect(
      (await h.service.members("partner-current", "", 1)).canViewMemberHealth,
    ).toBe(true);
    h.tx.brandPartner.findUnique.mockResolvedValueOnce({
      active: true,
      level: { code: "distribution-2", active: true },
    });
    const result = await h.service.members("partner-current", "", 1);
    expect(result.canViewMemberHealth).toBe(false);
    expect(result.items[0]).not.toHaveProperty("birthday");
  });
  it("never returns the private list if its audit cannot be recorded", async () => {
    const h = fixture();
    h.tx.auditLog.create.mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(h.service.members("partner-current", "", 1)).rejects.toThrow(
      "audit unavailable",
    );
  });
});
