import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

const memberId = "00000000-0000-4000-8000-000000000123";
const requestKey = "00000000-0000-4000-8000-000000000999";
const current = { id: "admin-1", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };

function harness(balanceCents = 1_000) {
  const ledger = { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) };
  const account = {
    upsert: vi.fn().mockResolvedValue({}),
    findUnique: vi.fn().mockResolvedValue({ balanceCents, version: 2, updatedAt: new Date("2026-09-16T00:00:00Z") }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ balanceCents, version: 2 }),
    update: vi.fn().mockImplementation(async ({ data }: any) => ({
      balanceCents: data.balanceCents,
      version: 3,
      updatedAt: new Date("2026-09-16T01:00:00Z"),
    })),
  };
  const auditLog = { create: vi.fn().mockResolvedValue({}) };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    user: { findUnique: vi.fn().mockResolvedValue({ id: memberId, compatibilityId: 23, status: "ACTIVE" }) },
    commercePointLedger: ledger,
    commercePointAccount: account,
    auditLog,
  };
  const prisma = { $transaction: vi.fn(async (run: any) => run(tx)) };
  return { service: new AdminService(prisma as any, {} as any), tx, ledger, account, auditLog };
}

beforeEach(() => vi.stubEnv("APP_REALM", "domestic"));
afterEach(() => vi.unstubAllEnvs());

describe("member point administration", () => {
  it("adjusts a domestic member balance atomically and writes ledger plus audit", async () => {
    const h = harness();
    const result = await h.service.adjustMemberPoints(current, memberId, "request-1", {
      deltaCents: 250,
      reason: "客服补偿",
      idempotencyKey: requestKey,
    });
    expect(result).toMatchObject({ memberNo: "23", deltaCents: 250, balanceCents: 1250, version: 3, repeated: false });
    expect(h.account.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: memberId },
      data: { balanceCents: 1250, version: { increment: 1 } },
    }));
    expect(h.ledger.create).toHaveBeenCalledWith({ data: {
      userId: memberId,
      deltaCents: 250,
      type: "ADMIN_ADJUSTMENT",
      idempotencyKey: `admin-point:${requestKey}`,
    } });
    expect(h.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "MEMBER_POINTS_ADJUSTMENT",
      beforeJson: { balanceCents: 1000, version: 2 },
      afterJson: { deltaCents: 250, balanceCents: 1250, version: 3, reason: "客服补偿" },
    }) });
  });

  it("rejects a deduction that would make the balance negative without a ledger", async () => {
    const h = harness(100);
    await expect(h.service.adjustMemberPoints(current, memberId, "request-2", {
      deltaCents: -200,
      reason: "人工扣减",
      idempotencyKey: requestKey,
    })).rejects.toThrow("不能小于0");
    expect(h.account.update).not.toHaveBeenCalled();
    expect(h.ledger.create).not.toHaveBeenCalled();
    expect(h.auditLog.create).not.toHaveBeenCalled();
  });
});
