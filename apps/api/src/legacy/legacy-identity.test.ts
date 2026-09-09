import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyService } from "./legacy.service";

function fixture() {
  const prisma = {
    user: { findUnique: vi.fn(async () => null as unknown), findFirst: vi.fn(async () => null as unknown), findUniqueOrThrow: vi.fn(async () => null as unknown) },
    commercePointAccount: { findUnique: vi.fn(async () => null as unknown) },
    legacyIdMap: { findMany: vi.fn(async () => [] as unknown[]), findUnique: vi.fn(async () => null as unknown) },
    compatibilityId: {
      findUnique: vi.fn(async () => null as unknown),
      upsert: vi.fn(async () => ({ id: 101, entityType: "mall_sku", externalId: "new-sku" })),
    },
    appSetting: { findUnique: vi.fn(async () => null as unknown) },
  };
  return { prisma, service: new LegacyService(prisma as never) };
}

afterEach(() => vi.unstubAllEnvs());

describe("released App identity continuity", () => {
  it("returns the original member ID so local health and notification partitions remain attached", async () => {
    const { service, prisma } = fixture();
    const member = { id: "new-uuid", compatibilityId: 3, legacyMemberId: "9527", mobile: null, nickname: "测试用户", avatarUrl: null, gender: "UNSPECIFIED", birthday: null, heightCm: null, weightKg: null };
    expect(service.memberContract(member)).toMatchObject({ id: 9527, uuid: "new-uuid", legacy_id: "9527" });
    prisma.user.findUnique.mockResolvedValueOnce(member);
    await expect(service.userByCompatibilityId("9527")).resolves.toBe(member);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { legacyMemberId: "9527" } });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("does not use a newly assigned number as an alias for another imported member", async () => {
    const { service, prisma } = fixture();
    await expect(service.userByCompatibilityId(3)).rejects.toThrow("未找到成员");
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { compatibilityId: 3, legacyMemberId: null } });
  });

  it("returns verified point-account amounts only to the owning member, keeping unavailable balances null", async () => {
    const { service, prisma } = fixture();
    const member = { id: "new-uuid", compatibilityId: 3, legacyMemberId: "9527", mobile: null, nickname: "测试用户", avatarUrl: null, gender: "UNSPECIFIED", birthday: null, heightCm: null, weightKg: null };
    prisma.user.findUniqueOrThrow.mockResolvedValue(member);
    expect((await service.member(member.id)).money1).toBeNull();
    prisma.commercePointAccount.findUnique.mockResolvedValueOnce({ balanceCents: 12345 });
    expect((await service.member(member.id)).money1).toBe(123.45);
    expect(prisma.commercePointAccount.findUnique).toHaveBeenCalledWith({ where: { userId: member.id } });
    expect(service.memberContract(member)).not.toHaveProperty("money1");
  });

  it("uses the old App namespace for product and SKU IDs before generated numbers", async () => {
    const { service, prisma } = fixture();
    prisma.legacyIdMap.findUnique.mockResolvedValueOnce({ targetId: "imported-sku" });
    await expect(service.externalIdIfMapped("mall_sku", 52)).resolves.toBe("imported-sku");
    expect(prisma.legacyIdMap.findUnique).toHaveBeenCalledWith({ where: { sourceSystem_entityType_legacyId: { sourceSystem: "legacy_app", entityType: "mall_sku", legacyId: "52" } } });
    expect(prisma.compatibilityId.findUnique).not.toHaveBeenCalled();
    prisma.legacyIdMap.findMany.mockResolvedValueOnce([{ legacyId: "52" }]);
    await expect(service.compatibilityId("mall_sku", "imported-sku")).resolves.toBe(52);
    expect(prisma.compatibilityId.upsert).not.toHaveBeenCalled();
  });

  it("fails on new/old ID collisions rather than returning the wrong resource", async () => {
    vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
    const { service, prisma } = fixture();
    prisma.legacyIdMap.findUnique.mockResolvedValueOnce({ targetId: "different-old-sku" });
    await expect(service.compatibilityId("mall_sku", "new-sku")).rejects.toThrow("冲突");
  });

  it("does not create compatibility IDs through GET requests while business writes are frozen", async () => {
    vi.stubEnv("MAINTENANCE_READ_ONLY", "true");
    const { service, prisma } = fixture();
    await expect(service.compatibilityId("mall_sku", "new-sku")).rejects.toThrow("迁移维护中");
    expect(prisma.compatibilityId.upsert).not.toHaveBeenCalled();
    prisma.compatibilityId.findUnique.mockResolvedValueOnce({ id: 101 });
    await expect(service.compatibilityId("mall_sku", "known-sku")).resolves.toBe(101);
  });

  it("does not pretend a missing or invalid production updater means no update", async () => {
    const { service, prisma } = fixture();
    await expect(service.appUpdate("android", "23")).rejects.toThrow("暂未发布");
    prisma.appSetting.findUnique.mockResolvedValueOnce({ public: true, value: { audience: "internal_test" } });
    await expect(service.appUpdate("android", "23")).rejects.toThrow("配置无效");
  });
});
