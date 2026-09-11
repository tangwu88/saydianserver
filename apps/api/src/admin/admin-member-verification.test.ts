import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

const superAdmin = { id: "admin-id", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };
const initialUpdatedAt = new Date("2026-09-11T00:00:00.000Z");

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000123",
    compatibilityId: 23,
    legacyMemberId: null,
    mobile: "+8613812348888",
    mobileVerifiedAt: null as Date | null,
    email: "member@example.invalid",
    emailVerifiedAt: new Date("2026-09-10T00:00:00.000Z") as Date | null,
    updatedAt: initialUpdatedAt,
    nickname: "Synthetic member",
    avatarUrl: "https://cdn.example.invalid/avatar.png",
    gender: "FEMALE",
    birthday: new Date("1990-01-02T00:00:00.000Z") as Date | null,
    heightCm: { toNumber: () => 168.5 } as { toNumber(): number } | null,
    weightKg: { toNumber: () => 56.2 } as { toNumber(): number } | null,
    status: "ACTIVE",
    createdAt: new Date("2026-09-09T00:00:00.000Z"),
    _count: { healthRecords: 0, devices: 0 },
    ...overrides,
  };
}

function updateHarness(overrides: Record<string, unknown> = {}) {
  let user: ReturnType<typeof userRow> | null = userRow(overrides);
  const auditLog = { create: vi.fn(async (_input: unknown) => ({})) };
  const tx = {
    user: {
      findUnique: vi.fn(async () => user ? { ...user } : null),
      findFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!user || where.updatedAt.getTime() !== user.updatedAt.getTime()) return { count: 0 };
        user = { ...user, ...data };
        return { count: 1 };
      }),
    },
    userSession: { updateMany: vi.fn(async () => ({ count: 2 })) },
    auditLog,
  };
  const prisma = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
  return { service: new AdminService(prisma as any, {} as any), prisma, tx, auditLog, current: () => user };
}

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

describe("international member contact verification administration", () => {
  it("returns independent phone and email verification states in the member list", async () => {
    const row = userRow();
    const prisma = {
      user: {
        findMany: vi.fn(async () => [row]),
        count: vi.fn(async () => 1),
      },
      $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    const result = await new AdminService(prisma as any, {} as any).members();
    const item = result.items[0]!;
    expect(item).toMatchObject({
      id: row.id,
      memberNo: "23",
      mobileVerified: false,
      mobileVerificationStatus: "UNVERIFIED",
      mobileVerifiedAt: null,
      emailVerified: true,
      emailVerificationStatus: "VERIFIED",
      emailVerifiedAt: "2026-09-10T00:00:00.000Z",
      verificationVersion: initialUpdatedAt.toISOString(),
    });
    expect(item.mobileMasked).not.toBe(row.mobile);
    expect(item.emailMasked).not.toBe(row.email);
  });

  it("lets a super administrator confirm a stored contact and writes a PII-free audit record", async () => {
    const h = updateHarness();
    const result = await h.service.updateMemberVerification(superAdmin, h.current()!.id, "request-id", {
      channel: "mobile", verified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    });
    expect(result).toMatchObject({ mobileVerified: true, mobileVerificationStatus: "VERIFIED" });
    expect(h.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: h.current()!.id, updatedAt: initialUpdatedAt },
      data: { mobileVerifiedAt: expect.any(Date), updatedAt: expect.any(Date) },
    });
    expect(h.auditLog.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      actorType: "ADMIN", actorId: "admin-id", action: "MANUAL_CONTACT_VERIFICATION_UPDATE",
      entityType: "USER_CONTACT_VERIFICATION", entityId: h.current()!.id, requestId: "request-id",
      beforeJson: { channel: "mobile", verified: false, verifiedAt: null },
      afterJson: { channel: "mobile", verified: true, verifiedAt: expect.any(String), source: "SUPER_ADMIN_MANUAL" },
    }) });
    expect(JSON.stringify(h.auditLog.create.mock.calls[0]?.[0])).not.toContain("13812348888");
  });

  it("returns editable contact values only through the audited super-admin profile endpoint", async () => {
    const h = updateHarness();
    const result = await h.service.memberProfile(superAdmin, h.current()!.id, "profile-read");
    expect(result).toMatchObject({
      memberNo: "23", mobile: "+8613812348888", mobileVerified: false,
      email: "member@example.invalid", emailVerified: true, nickname: "Synthetic member", status: "ACTIVE",
      avatarUrl: "https://cdn.example.invalid/avatar.png", gender: "FEMALE", birthday: "1990-01-02",
      heightCm: 168.5, weightKg: 56.2,
      verificationVersion: initialUpdatedAt.toISOString(),
    });
    expect(h.auditLog.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      actorId: "admin-id", action: "MEMBER_PROFILE_READ", entityType: "USER_PROFILE",
      entityId: h.current()!.id, requestId: "profile-read",
      afterJson: { mobilePresent: true, emailPresent: true, fields: ["nickname", "avatarUrl", "gender", "birthday", "heightCm", "weightKg", "mobile", "email", "status", "verification"] },
    }) });
    expect(JSON.stringify(h.auditLog.create.mock.calls[0]?.[0])).not.toContain("13812348888");
    expect(JSON.stringify(h.auditLog.create.mock.calls[0]?.[0])).not.toContain("member@example.invalid");
  });

  it("updates member details and verification atomically, revokes sessions and omits PII from audit", async () => {
    const h = updateHarness();
    const result = await h.service.updateMemberProfile(superAdmin, h.current()!.id, "profile-update", {
      nickname: "Updated member",
      avatarUrl: "https://cdn.example.invalid/updated.png",
      gender: "MALE",
      birthday: "1991-03-04",
      heightCm: 180.2,
      weightKg: 75.4,
      mobile: "+86 139 1234 8888",
      email: "MEMBER@example.invalid",
      status: "DISABLED",
      mobileVerified: true,
      emailVerified: true,
      expectedUpdatedAt: initialUpdatedAt.toISOString(),
    });
    expect(result).toMatchObject({
      nickname: "Updated member", mobile: "+8613912348888", email: "member@example.invalid",
      status: "DISABLED", mobileVerified: true, emailVerified: true,
      avatarUrl: "https://cdn.example.invalid/updated.png", gender: "MALE", birthday: "1991-03-04",
      heightCm: 180.2, weightKg: 75.4,
    });
    expect(h.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: h.current()!.id, updatedAt: initialUpdatedAt },
      data: expect.objectContaining({
        nickname: "Updated member", mobile: "+8613912348888", email: "member@example.invalid",
        status: "DISABLED", mobileVerifiedAt: expect.any(Date), emailVerifiedAt: new Date("2026-09-10T00:00:00.000Z"),
        avatarUrl: "https://cdn.example.invalid/updated.png", gender: "MALE",
        birthday: new Date("1991-03-04T00:00:00.000Z"), heightCm: expect.anything(), weightKg: expect.anything(),
      }),
    });
    expect(h.tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: h.current()!.id, revokedAt: null }, data: { revokedAt: expect.any(Date) },
    });
    const audit = JSON.stringify(h.auditLog.create.mock.calls[0]?.[0]);
    expect(audit).toContain("MEMBER_PROFILE_UPDATE");
    expect(audit).not.toContain("13912348888");
    expect(audit).not.toContain("member@example.invalid");
    expect(audit).not.toContain("1991-03-04");
    expect(audit).not.toContain("updated.png");
  });

  it("updates App profile details without revoking otherwise valid member sessions", async () => {
    const h = updateHarness();
    const result = await h.service.updateMemberProfile(superAdmin, h.current()!.id, "profile-only", {
      nickname: "Synthetic member", avatarUrl: "", gender: "MALE", birthday: "1992-05-06",
      heightCm: 172.3, weightKg: null,
      mobile: "+8613812348888", email: "member@example.invalid", status: "ACTIVE",
      mobileVerified: false, emailVerified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    });
    expect(result).toMatchObject({ avatarUrl: null, gender: "MALE", birthday: "1992-05-06", heightCm: 172.3, weightKg: null });
    expect(h.tx.userSession.updateMany).not.toHaveBeenCalled();
    expect(h.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      afterJson: expect.objectContaining({ profileFieldsChanged: ["avatarUrl", "gender", "birthday", "heightCm", "weightKg"] }),
    }) });
  });

  it.each([
    [{ avatarUrl: "file:///avatar.png" }, "头像地址不正确"],
    [{ gender: "UNKNOWN" }, "性别选项不正确"],
    [{ birthday: "2026-02-30" }, "出生日期不正确"],
    [{ heightCm: 49.9 }, "身高须在50至250之间"],
    [{ weightKg: 500.1 }, "体重须在10至500之间"],
  ])("rejects invalid App profile details: %j", async (profile, message) => {
    const h = updateHarness();
    await expect(h.service.updateMemberProfile(superAdmin, h.current()!.id, "invalid-profile", {
      nickname: "Synthetic member", mobile: "+8613812348888", email: "member@example.invalid",
      status: "ACTIVE", mobileVerified: false, emailVerified: true,
      expectedUpdatedAt: initialUpdatedAt.toISOString(), ...profile,
    })).rejects.toThrow(message);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("clears verification when a contact is changed without manual confirmation", async () => {
    const h = updateHarness();
    const result = await h.service.updateMemberProfile(superAdmin, h.current()!.id, "profile-update", {
      nickname: "Synthetic member", mobile: "+8613812348888", email: "new@example.invalid",
      status: "ACTIVE", mobileVerified: false, emailVerified: false,
      expectedUpdatedAt: initialUpdatedAt.toISOString(),
    });
    expect(result).toMatchObject({ email: "new@example.invalid", emailVerified: false, emailVerifiedAt: null });
    expect(h.current()).toMatchObject({ email: "new@example.invalid", emailVerifiedAt: null });
  });

  it("rejects invalid, duplicate, stale and protected member profile changes", async () => {
    const invalid = updateHarness();
    await expect(invalid.service.updateMemberProfile(superAdmin, invalid.current()!.id, "r", {
      nickname: "", mobile: "13812348888", email: "bad", status: "ACTIVE",
      mobileVerified: false, emailVerified: false, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    })).rejects.toThrow("昵称须为1至40个字符");
    expect(invalid.prisma.$transaction).not.toHaveBeenCalled();

    const duplicate = updateHarness();
    duplicate.tx.user.findFirst.mockResolvedValueOnce({ id: "other-member" });
    await expect(duplicate.service.updateMemberProfile(superAdmin, duplicate.current()!.id, "r", {
      nickname: "Synthetic member", mobile: "+8613812348888", email: "member@example.invalid", status: "ACTIVE",
      mobileVerified: false, emailVerified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    })).rejects.toThrow("已被其他会员使用");
    expect(duplicate.tx.user.updateMany).not.toHaveBeenCalled();

    const stale = updateHarness();
    await expect(stale.service.updateMemberProfile(superAdmin, stale.current()!.id, "r", {
      nickname: "Synthetic member", mobile: "+8613812348888", email: "member@example.invalid", status: "ACTIVE",
      mobileVerified: false, emailVerified: true, expectedUpdatedAt: "2026-09-10T00:00:00.000Z",
    })).rejects.toThrow("已发生变化");

    const protectedMember = updateHarness({ status: "DELETION_PENDING" });
    await expect(protectedMember.service.updateMemberProfile(superAdmin, protectedMember.current()!.id, "r", {
      nickname: "Synthetic member", mobile: "+8613812348888", email: "member@example.invalid", status: "ACTIVE",
      mobileVerified: false, emailVerified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    })).rejects.toThrow("注销流程中的会员不能手工编辑");
  });

  it("keeps raw member profile reads and edits restricted to global super administrators", async () => {
    const denied = updateHarness();
    const operator = { id: "operator", role: "APP_OPERATIONS", roles: ["APP_OPERATIONS"] };
    await expect(denied.service.memberProfile(operator, denied.current()!.id, "r")).rejects.toThrow("只有超级管理员");
    await expect(denied.service.updateMemberProfile(operator, denied.current()!.id, "r", {})).rejects.toThrow("只有超级管理员");
    expect(denied.prisma.$transaction).not.toHaveBeenCalled();

    vi.stubEnv("APP_REALM", "domestic");
    await expect(denied.service.memberProfile(superAdmin, denied.current()!.id, "r")).rejects.toThrow("仅用于国际版");
    await expect(denied.service.updateMemberProfile(superAdmin, denied.current()!.id, "r", {})).rejects.toThrow("仅用于国际版");
  });

  it("supports revoking one channel without changing the other channel", async () => {
    const h = updateHarness();
    const result = await h.service.updateMemberVerification(superAdmin, h.current()!.id, "request-id", {
      channel: "email", verified: false, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    });
    expect(result).toMatchObject({ emailVerified: false, emailVerificationStatus: "UNVERIFIED", mobileVerified: false });
    expect(h.current()).toMatchObject({ emailVerifiedAt: null, mobileVerifiedAt: null });
  });

  it("rejects missing contacts, stale pages, non-super-admins and domestic requests", async () => {
    const missing = updateHarness({ email: null, emailVerifiedAt: null });
    await expect(missing.service.updateMemberVerification(superAdmin, missing.current()!.id, "r", {
      channel: "email", verified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    })).rejects.toThrow("尚未填写邮箱");
    expect(missing.tx.user.updateMany).not.toHaveBeenCalled();

    const stale = updateHarness();
    await expect(stale.service.updateMemberVerification(superAdmin, stale.current()!.id, "r", {
      channel: "mobile", verified: true, expectedUpdatedAt: "2026-09-10T23:59:59.000Z",
    })).rejects.toThrow("已发生变化");
    expect(stale.auditLog.create).not.toHaveBeenCalled();

    const denied = updateHarness();
    await expect(denied.service.updateMemberVerification({ id: "operator", role: "APP_OPERATIONS", roles: ["APP_OPERATIONS"] }, denied.current()!.id, "r", {
      channel: "mobile", verified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    })).rejects.toThrow("只有超级管理员");
    expect(denied.prisma.$transaction).not.toHaveBeenCalled();

    vi.stubEnv("APP_REALM", "domestic");
    await expect(denied.service.updateMemberVerification(superAdmin, denied.current()!.id, "r", {
      channel: "mobile", verified: true, expectedUpdatedAt: initialUpdatedAt.toISOString(),
    })).rejects.toThrow("仅用于国际版");
  });
});
