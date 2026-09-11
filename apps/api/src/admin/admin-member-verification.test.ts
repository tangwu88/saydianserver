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
    avatarUrl: null,
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
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!user || where.updatedAt.getTime() !== user.updatedAt.getTime()) return { count: 0 };
        user = { ...user, ...data };
        return { count: 1 };
      }),
    },
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
