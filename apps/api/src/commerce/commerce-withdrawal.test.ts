import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminRole } from "@prisma/client";
import { CommerceWithdrawalService } from "./commerce-withdrawal.service";
import { CommerceAdminWithdrawalController, CommerceEmployeeWithdrawalController } from "./commerce-withdrawal.controller";
import { EmployeeAuthGuard } from "./employee-auth.guard";
import type { PrismaService } from "../common/prisma.service";

const id = "11111111-1111-4111-8111-111111111111";
const employeeId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const key = "test_apply_000000001";
const review = (decision = "APPROVE", version = 0) => ({ decision, note: "财务已核验", version, idempotencyKey: `review_${decision}_00000001` });
const receipt = (extra = {}) => ({ version: 1, idempotencyKey: "manual_receipt_00000001", providerTransferId: "original-transfer-001",
  recipientOpenId: "verified-openid", amountCents: 400, receiptReference: "archive/receipt-001", evidence: "原渠道真实回执已核验",
  completedAt: "2026-01-02T12:00:00Z", confirmedExternalResult: true, ...extra });

// In-memory serial transactions exercise accounting/state/idempotency and rollback logic.
// This is not a substitute for the PostgreSQL row-lock integration acceptance gate.
function fixture() {
  let state: any = { wallet: { employeeId, frozenCents: 0, availableCents: 1000, withdrawingCents: 0, debtCents: 0, totalPaidCents: 0 },
    identity: { employeeId, openId: "verified-openid", authorizationId: "authorization-1", authorizationStatus: "ACTIVE", verifiedAt: new Date("2026-01-01"), verificationEvidence: "identity-evidence" },
    plan: { enabled: true, withdrawalEnabled: true, minimumWithdrawCents: 100, dailyWithdrawLimitCents: 5000, settlementDays: 7 }, rows: [], ledger: [], audit: [], dailyUsed: 0 };
  const update = (target: any, data: any) => { for (const [field, value] of Object.entries(data)) {
    const change = value as any;
    target[field] = change && typeof change === "object" && !(change instanceof Date) && ("increment" in change || "decrement" in change)
      ? (target[field] || 0) + (change.increment || 0) - (change.decrement || 0) : value;
  } return target; };
  const findRow = (where: any) => state.rows.find((row: any) => where.id ? row.id === where.id : row.idempotencyKey === where.idempotencyKey);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    commerceEmployee: { findUnique: vi.fn().mockResolvedValue({ id: employeeId, active: true }) },
    commerceCommissionPlan: { findUnique: vi.fn(async () => state.plan) },
    commerceEmployeePayoutIdentity: { findUnique: vi.fn(async () => state.identity) },
    commerceEmployeeWallet: { findUnique: vi.fn(async () => state.wallet),
      update: vi.fn(async ({ data }: any) => update(state.wallet, data)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if ((where.debtCents !== undefined && where.debtCents !== state.wallet.debtCents) ||
          (where.availableCents?.gte > state.wallet.availableCents) || (where.withdrawingCents?.gte > state.wallet.withdrawingCents)) return { count: 0 };
        update(state.wallet, data); return { count: 1 };
      }) },
    commerceWithdrawal: { findUnique: vi.fn(async ({ where }: any) => findRow(where)), findUniqueOrThrow: vi.fn(async ({ where }: any) => findRow(where)),
      findMany: vi.fn(async () => state.rows), count: vi.fn(async ({ where }: any) => where.status?.in ? state.rows.filter((row: any) => where.status.in.includes(row.status)).length : state.rows.length),
      aggregate: vi.fn(async (_input: any) => ({ _sum: { amountCents: state.dailyUsed } })),
      create: vi.fn(async ({ data }: any) => { const row = { id, withdrawalNo: "W001", version: 0, providerTransferId: null, legacyId: null, createdAt: new Date("2026-01-01"), ...data }; state.rows.push(row); return row; }),
      updateMany: vi.fn(async ({ where, data }: any) => { const row = findRow(where); if (!row || row.version !== where.version) return { count: 0 }; update(row, data); return { count: 1 }; }) },
    commerceCommissionLedger: { create: vi.fn(async ({ data }: any) => { state.ledger.push(data); return data; }),
      findUnique: vi.fn(async ({ where }: any) => state.ledger.find((row: any) => row.idempotencyKey === where.idempotencyKey)) },
    auditLog: { create: vi.fn(async ({ data }: any) => { state.audit.push(data); return data; }) },
  };
  let queue = Promise.resolve();
  const prisma = { ...tx, $transaction: (run: (db: any) => Promise<unknown>) => {
    const task = queue.then(async () => { const before = structuredClone(state); try { return await run(tx); } catch (error) { state = before; throw error; } });
    queue = task.then(() => undefined, () => undefined); return task;
  } };
  const service = new CommerceWithdrawalService(prisma as unknown as PrismaService);
  return { service, tx, get state() { return state; }, apply: () => service.apply(employeeId, { amountCents: 400, idempotencyKey: key }) };
}
afterEach(() => vi.unstubAllEnvs());

describe("withdrawal accounting and safety", () => {
  it("freezes only verified balance once for concurrent same-key retries", async () => {
    const f = fixture(); await Promise.all([f.apply(), f.apply()]);
    expect(f.state.wallet).toMatchObject({ availableCents: 600, withdrawingCents: 400, totalPaidCents: 0 });
    expect(f.state.rows).toHaveLength(1); expect(f.state.ledger).toHaveLength(1);
    expect(f.tx.$queryRaw).toHaveBeenCalled();
    await expect(f.service.apply(employeeId, { amountCents: 401, idempotencyKey: key })).rejects.toThrow("幂等键");
  });
  it("rejects debt, insufficient balance and unverified payout identity without writing", async () => {
    const f = fixture(); f.state.wallet.debtCents = 1;
    await expect(f.apply()).rejects.toThrow("退款欠款");
    f.state.wallet.debtCents = 0; f.state.wallet.availableCents = 399;
    await expect(f.apply()).rejects.toThrow("余额不足");
    f.state.wallet.availableCents = 1000; f.state.identity.verifiedAt = null;
    await expect(f.apply()).rejects.toThrow("收款身份尚未核验");
    expect(f.state.ledger).toHaveLength(0);
  });
  it("maintenance refuses write but summary does not create a wallet or reveal payout identifiers", async () => {
    const f = fixture(); vi.stubEnv("BUSINESS_WRITES_PAUSED", "true");
    await expect(f.apply()).rejects.toThrow("暂停提现");
    const summary = await f.service.employeeSummary(employeeId);
    expect(summary.canApply).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("verified-openid");
    expect(JSON.stringify(summary)).not.toContain("authorization-1");
    expect(f.tx.commerceEmployeeWallet.update).not.toHaveBeenCalled();
  });
  it("approves without paying and registers exact external success only once", async () => {
    const f = fixture(); await f.apply(); await f.service.review(id, actorId, review());
    expect(f.state.wallet.totalPaidCents).toBe(0);
    expect(f.state.rows[0]).toMatchObject({ status: "APPROVED", version: 1 });
    await f.service.recordManualReceipt(id, actorId, receipt());
    await f.service.recordManualReceipt(id, actorId, receipt());
    expect(f.state.wallet).toMatchObject({ availableCents: 600, withdrawingCents: 0, totalPaidCents: 400 });
    expect(f.state.rows[0]).toMatchObject({ status: "SUCCEEDED", version: 2, providerTransferId: "original-transfer-001" });
    expect(f.state.ledger).toHaveLength(3); expect(f.state.audit).toHaveLength(2);
    await expect(f.service.recordManualReceipt(id, actorId, receipt({ amountCents: 401 }))).rejects.toThrow("幂等键");
  });
  it("rejects mismatched amount, identity, time or absent human confirmation", async () => {
    const f = fixture(); await f.apply(); await f.service.review(id, actorId, review());
    await expect(f.service.recordManualReceipt(id, actorId, receipt({ amountCents: 399 }))).rejects.toThrow("不一致");
    await expect(f.service.recordManualReceipt(id, actorId, receipt({ recipientOpenId: "stranger" }))).rejects.toThrow("不一致");
    expect(() => f.service.recordManualReceipt(id, actorId, receipt({ confirmedExternalResult: false }))).toThrow("不会发起打款");
    await expect(f.service.recordManualReceipt(id, actorId, receipt({ completedAt: "2025-01-01" }))).rejects.toThrow("早于提现");
    expect(f.state.wallet.withdrawingCents).toBe(400);
  });
  it("reject release offsets intervening refund debt before making funds available", async () => {
    const f = fixture(); await f.apply(); f.state.wallet.debtCents = 150;
    await f.service.review(id, actorId, review("REJECT"));
    expect(f.state.wallet).toMatchObject({ availableCents: 850, withdrawingCents: 0, debtCents: 0, totalPaidCents: 0 });
    expect(f.state.ledger[1]).toMatchObject({ type: "WITHDRAW_RELEASE", availableDeltaCents: 250, debtDeltaCents: -150, withdrawingDeltaCents: -400 });
    await f.service.review(id, actorId, review("REJECT"));
    expect(f.state.wallet.availableCents).toBe(850);
  });
  it("stale versions and terminal transitions cannot move money", async () => {
    const f = fixture(); await f.apply(); await f.service.review(id, actorId, review());
    await expect(f.service.review(id, actorId, review("REJECT"))).rejects.toThrow("状态已变化");
    await f.service.recordManualReceipt(id, actorId, receipt());
    await expect(f.service.review(id, actorId, review("REJECT", 2))).rejects.toThrow("已有原供应商");
    expect(f.state.wallet.totalPaidCents).toBe(400);
  });
  it("legacy in-flight records cannot create payouts or change provider IDs, only verify the original result", async () => {
    const f = fixture(); await f.apply(); Object.assign(f.state.rows[0], { sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", status: "PROCESSING", providerTransferId: "legacy-original-9" });
    await expect(f.service.review(id, actorId, review())).rejects.toThrow("尚未完成接管");
    await expect(f.service.recordManualReceipt(id, actorId, receipt({ version: 0 }))).rejects.toThrow("尚未完成接管");
    await expect(f.service.verifyLegacyResult(id, actorId, receipt({ version: 0 }))).rejects.toThrow("必须核验原供应商");
    await f.service.verifyLegacyResult(id, actorId, receipt({ version: 0, providerTransferId: "legacy-original-9", result: "SUCCEEDED" }));
    expect(f.state.rows[0]).toMatchObject({ status: "SUCCEEDED", executionOwner: "LEGACY_SYSTEM", providerTransferId: "legacy-original-9" });
    expect(f.state.wallet.totalPaidCents).toBe(400);
  });
  it("confirmed legacy failure releases funds but pending/unknown result cannot be recorded", async () => {
    const f = fixture(); await f.apply(); Object.assign(f.state.rows[0], { sourceSystem: "legacy_mall", executionOwner: "LEGACY_SYSTEM", status: "WAIT_USER_CONFIRM", providerTransferId: "legacy-original-9" });
    expect(() => f.service.verifyLegacyResult(id, actorId, receipt({ version: 0, result: "UNKNOWN" }))).toThrow("终态");
    await f.service.verifyLegacyResult(id, actorId, receipt({ version: 0, providerTransferId: "legacy-original-9", result: "FAILED" }));
    expect(f.state.rows[0].status).toBe("FAILED"); expect(f.state.wallet).toMatchObject({ availableCents: 1000, withdrawingCents: 0, totalPaidCents: 0 });
  });
  it("rolls back wallet movement when optimistic update or audit fails", async () => {
    const f = fixture(); await f.apply(); f.tx.commerceWithdrawal.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.service.review(id, actorId, review("REJECT"))).rejects.toThrow("其他操作更新");
    expect(f.state.wallet.withdrawingCents).toBe(400); expect(f.state.ledger).toHaveLength(1);
    f.tx.auditLog.create.mockRejectedValueOnce(new Error("audit failed"));
    await expect(f.service.review(id, actorId, review("REJECT"))).rejects.toThrow("audit failed");
    expect(f.state.wallet.withdrawingCents).toBe(400); expect(f.state.rows[0].status).toBe("SUBMITTED");
  });
  it("does not overdraw a migrated inconsistent hold", async () => {
    const f = fixture(); await f.apply(); await f.service.review(id, actorId, review()); f.state.wallet.withdrawingCents = 399;
    await expect(f.service.recordManualReceipt(id, actorId, receipt())).rejects.toThrow("冻结金额不足");
    expect(f.state.wallet.totalPaidCents).toBe(0);
  });
  it("duplicate external transfer uniqueness failure rolls back payment accounting", async () => {
    const f = fixture(); await f.apply(); await f.service.review(id, actorId, review());
    f.tx.commerceWithdrawal.updateMany.mockRejectedValueOnce({ code: "P2002" });
    await expect(f.service.recordManualReceipt(id, actorId, receipt())).rejects.toThrow("转账单号已被使用");
    expect(f.state.wallet).toMatchObject({ withdrawingCents: 400, totalPaidCents: 0 });
    expect(f.state.rows[0].status).toBe("APPROVED");
  });
  it("revoked identities and noninteger money cannot create a hold", async () => {
    const f = fixture(); f.state.identity.revokedAt = new Date();
    await expect(f.apply()).rejects.toThrow("收款身份尚未核验");
    await expect(f.service.apply(employeeId, { amountCents: 10.5, idempotencyKey: key })).rejects.toThrow("必须为非负整数");
    expect(f.state.ledger).toHaveLength(0);
  });
  it("uses guarded employee identity and restricts financial actions to finance and super admins", () => {
    expect(Reflect.getMetadata("__guards__", CommerceEmployeeWithdrawalController)).toContain(EmployeeAuthGuard);
    expect(Reflect.getMetadata("saydian.admin-roles", CommerceAdminWithdrawalController)).toEqual([AdminRole.SUPER_ADMIN, AdminRole.FINANCE]);
    expect(Reflect.getMetadata("path", CommerceEmployeeWithdrawalController)).toBe("api/saidian-mall/v1/wecom/me/withdrawals");
    expect(Reflect.getMetadata("path", CommerceAdminWithdrawalController.prototype.receipt)).toBe(":id/manual-receipt");
  });
  it("honors configured minimum, daily limit, enabled flag and a single pending withdrawal", async () => {
    const f = fixture(); f.state.plan.withdrawalEnabled = false;
    await expect(f.apply()).rejects.toThrow("尚未启用");
    f.state.plan.withdrawalEnabled = true; f.state.plan.minimumWithdrawCents = null;
    await expect(f.apply()).rejects.toThrow("最低提现金额尚未配置");
    f.state.plan.minimumWithdrawCents = 500;
    await expect(f.apply()).rejects.toThrow("低于最低限额");
    f.state.plan.minimumWithdrawCents = 100; f.state.dailyUsed = 4700;
    await expect(f.apply()).rejects.toThrow("当日提现限额");
    f.state.dailyUsed = 0; await f.apply();
    await expect(f.service.apply(employeeId, { amountCents: 400, idempotencyKey: "another_apply_key_001" })).rejects.toThrow("已有提现处理中");
    expect(f.state.wallet.withdrawingCents).toBe(400);
    const where = f.tx.commerceWithdrawal.aggregate.mock.calls[0]?.[0]?.where;
    expect(where?.createdAt.gte.getUTCHours()).toBe(16);
    expect(where?.status.notIn).toEqual(["REJECTED", "CANCELLED"]);
  });
});
