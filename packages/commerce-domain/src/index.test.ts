import { describe, expect, it, vi } from "vitest";
import { commissionCents, commissionReversal, onCommerceOrderPaid, onCommerceOrderReceived, onCommerceRefundSucceeded, onCommercePointsRefundSucceeded, settleCommerceCommission } from "./index";

describe("shared commerce money ledger", () => {
  it("accumulates sub-cent refund rounding and never reverses above the original bonus", () => {
    expect(commissionCents(9000, 1000)).toBe(900);
    expect(commissionReversal(1000, 0, 1, 100, 10)).toEqual({ refundedBaseCents: 1, reversedBonusCents: 0 });
    expect(commissionReversal(1000, 99, 1, 100, 10)).toEqual({ refundedBaseCents: 100, reversedBonusCents: 1 });
    expect(commissionReversal(1000, 990, 500, 100, 10)).toEqual({ refundedBaseCents: 1000, reversedBonusCents: 10 });
  });
  it("freezes a single bonus from payment less shipping and keeps the original rule", async () => {
    const order = { id: "o", executionOwner: "NEW_SYSTEM", referralEmployeeId: "e", paidAt: new Date("2026-09-08"), payableCents: 10000, shippingCents: 1000, receivedAt: null, commissionAccrual: null as object | null };
    const tx: any = { $queryRaw: vi.fn(), commerceOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue(order) },
      commerceCommissionPlan: { findUnique: vi.fn().mockResolvedValue({ enabled: true, enabledAt: new Date("2026-09-01"), rateBps: 1000, settlementDays: 7 }) },
      commerceCommissionAccrual: { create: vi.fn().mockImplementation(async () => { order.commissionAccrual = {}; }) },
      commerceEmployeeWallet: { upsert: vi.fn() }, commerceCommissionLedger: { create: vi.fn() } };
    await onCommerceOrderPaid(tx, "o");
    await onCommerceOrderPaid(tx, "o");
    expect(tx.commerceCommissionAccrual.create).toHaveBeenCalledTimes(1);
    expect(tx.commerceCommissionAccrual.create).toHaveBeenCalledWith({ data: expect.objectContaining({ baseCents: 9000, grossBonusCents: 900, settlementDaysSnapshot: 7 }) });
  });
  it("records zero-delta refund applications so duplicate callbacks cannot consume the base twice", async () => {
    let applied = false;
    const tx: any = { $queryRaw: vi.fn(), paymentRefund: { findUniqueOrThrow: vi.fn().mockResolvedValue({ status: "SUCCEEDED", amountCents: 1, paymentIntent: { commerceOrderId: "o" } }) },
      commerceCommissionLedger: { findUnique: vi.fn().mockImplementation(async () => applied ? {} : null), create: vi.fn().mockImplementation(async () => { applied = true; }) },
      commerceCommissionAccrual: { findUnique: vi.fn().mockResolvedValue({ id: "a", employeeId: "e", status: "FROZEN", baseCents: 1000, refundedBaseCents: 0, rateBps: 100, grossBonusCents: 10, reversedBonusCents: 0 }), update: vi.fn() },
      commerceEmployeeWallet: { findUnique: vi.fn().mockResolvedValue({ frozenCents: 10, availableCents: 0 }), update: vi.fn() } };
    await onCommerceRefundSucceeded(tx, "r"); await onCommerceRefundSucceeded(tx, "r");
    expect(tx.commerceCommissionAccrual.update).toHaveBeenCalledTimes(1);
    expect(tx.commerceCommissionLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({ frozenDeltaCents: 0, idempotencyKey: "commission-refund:r" }) });
  });
  it("does not invent a missing migrated settlement snapshot", async () => {
    const tx: any = { $queryRaw: vi.fn(), commerceCommissionAccrual: { findUnique: vi.fn().mockResolvedValue({ status: "FROZEN", availableAt: null, settlementDaysSnapshot: null }), update: vi.fn() } };
    await onCommerceOrderReceived(tx, "o", new Date());
    expect(tx.commerceCommissionAccrual.update).not.toHaveBeenCalled();
  });
  it("requires matching frozen wallet balance before settling", async () => {
    const accrual = { status: "FROZEN", availableAt: new Date(0), settlementDaysSnapshot: 7, grossBonusCents: 100, reversedBonusCents: 0, employeeId: "e", order: { executionOwner: "NEW_SYSTEM", afterSales: [] } };
    const tx: any = { $queryRaw: vi.fn(), commerceCommissionAccrual: { findUniqueOrThrow: vi.fn().mockResolvedValue(accrual) },
      commerceEmployeeWallet: { findUniqueOrThrow: vi.fn().mockResolvedValue({ frozenCents: 99, debtCents: 0 }), update: vi.fn() } };
    await expect(settleCommerceCommission(tx, "a")).rejects.toThrow("不一致");
    expect(tx.commerceEmployeeWallet.update).not.toHaveBeenCalled();
    accrual.settlementDaysSnapshot = null as any;
    expect(await settleCommerceCommission(tx, "a")).toBe(false);
  });
  it("never restores all points from a cash-total inference without item snapshots", async () => {
    const tx: any = { $queryRaw: vi.fn(), paymentRefund: { findUniqueOrThrow: vi.fn().mockResolvedValue({ status: "SUCCEEDED", afterSaleId: null, paymentIntent: { commerceOrderId: "o" } }) },
      commerceOrder: { findUniqueOrThrow: vi.fn().mockResolvedValue({ executionOwner: "NEW_SYSTEM", userId: "u", pointDiscountCents: 100 }) },
      commercePointAccount: { updateMany: vi.fn() } };
    await expect(onCommercePointsRefundSucceeded(tx, "r")).rejects.toThrow("商品级售后");
    expect(tx.commercePointAccount.updateMany).not.toHaveBeenCalled();
  });
  it("does not reverse commission for the shipping part of a snapshotted refund", async () => {
    const tx: any = { $queryRaw: vi.fn(), paymentRefund: { findUniqueOrThrow: vi.fn().mockResolvedValue({
      status: "SUCCEEDED", amountCents: 101, merchandiseRefundCents: 1, shippingRefundCents: 100, paymentIntent: { commerceOrderId: "o" },
    }) },
      commerceCommissionLedger: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      commerceCommissionAccrual: { findUnique: vi.fn().mockResolvedValue({ id: "a", employeeId: "e", status: "FROZEN", baseCents: 1000, refundedBaseCents: 0, rateBps: 100, grossBonusCents: 10, reversedBonusCents: 0 }), update: vi.fn() },
      commerceEmployeeWallet: { findUnique: vi.fn().mockResolvedValue({ frozenCents: 10, availableCents: 0 }), update: vi.fn() } };
    await onCommerceRefundSucceeded(tx, "r");
    expect(tx.commerceCommissionAccrual.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ refundedBaseCents: 1, reversedBonusCents: 0 }) }));
  });
});
