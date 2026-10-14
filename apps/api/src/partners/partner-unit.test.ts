import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { BusinessType, PaymentChannel } from "@prisma/client";
import { postPartnerLedger } from "./partner-ledger";
import { PartnerMembersService } from "./partner-members.service";
import { PartnerAuthGuard } from "./partner-auth";
import {
  assertGlobalPaymentScope,
  PaymentProviderService,
  paymentIntegrationKeyForNewIntent,
  paymentIntegrationKeyForStoredIntent,
} from "../billing/payment-provider.service";
import { BillingService } from "../billing/billing.service";

function ledgerHarness() {
  const wallet = { balanceCents: 1000, depositCents: 9000 },
    entries = new Map<string, any>();
  const tx: any = {
    $queryRaw: vi.fn(),
    partnerWallet: {
      findUniqueOrThrow: vi.fn(async () => ({ ...wallet })),
      update: vi.fn(async ({ data }: any) => {
        if (typeof data.balanceCents === "number")
          wallet.balanceCents = data.balanceCents;
        if (typeof data.depositCents === "number")
          wallet.depositCents = data.depositCents;
      }),
    },
    partnerLedger: {
      findUnique: vi.fn(
        async ({ where }: any) => entries.get(where.idempotencyKey) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const entry = {
          ...data,
          id: randomUUID(),
          referenceId: data.referenceId ?? null,
        };
        entries.set(data.idempotencyKey, entry);
        return entry;
      }),
    },
  };
  return { tx, wallet, entries };
}
describe("brand partner financial and access boundaries", () => {
  it("does not spend guarantee deposit when purchase balance is insufficient", async () => {
    const h = ledgerHarness();
    await expect(
      postPartnerLedger(h.tx, {
        partnerId: randomUUID(),
        account: "BALANCE",
        type: "PURCHASE",
        deltaCents: -1200,
        reason: "采购",
        idempotencyKey: "purchase-once",
      }),
    ).rejects.toThrow("余额不足");
    expect(h.wallet).toEqual({ balanceCents: 1000, depositCents: 9000 });
    expect(h.tx.partnerLedger.create).not.toHaveBeenCalled();
  });
  it("one recharge reference posts once, while a conflicting owner or amount is rejected", async () => {
    const h = ledgerHarness(),
      input = {
        partnerId: randomUUID(),
        account: "BALANCE" as const,
        type: "RECHARGE",
        deltaCents: 500,
        reason: "合成充值",
        referenceId: randomUUID(),
        idempotencyKey: "recharge-once",
      };
    await postPartnerLedger(h.tx, input);
    await postPartnerLedger(h.tx, input);
    expect(h.wallet.balanceCents).toBe(1500);
    expect(h.tx.partnerLedger.create).toHaveBeenCalledOnce();
    await expect(
      postPartnerLedger(h.tx, { ...input, partnerId: randomUUID() }),
    ).rejects.toThrow("不同参数");
    await expect(
      postPartnerLedger(h.tx, { ...input, deltaCents: 600 }),
    ).rejects.toThrow("不同参数");
  });
  it("does not return member health data if reading audit fails", async () => {
    const memberId = randomUUID(),
      partnerId = randomUUID();
    const tx: any = {
      brandPartner: {
        findUnique: vi.fn(async () => ({
          active: true,
          level: { active: true, code: "distribution-1" },
        })),
      },
      user: {
        findFirst: vi.fn(async () => ({ id: memberId })),
        findFirstOrThrow: vi.fn(async () => ({
          id: memberId,
          compatibilityId: 1,
          nickname: "合成健康会员",
        })),
      },
      auditLog: {
        create: vi.fn(async () => {
          throw new Error("audit unavailable");
        }),
      },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const service = new PartnerMembersService(prisma, {} as any);
    await expect(
      service.profile(partnerId, memberId, "request"),
    ).rejects.toThrow("audit unavailable");
    expect(tx.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: memberId, partnerId }),
      }),
    );
  });
  it("rejects a foreign member before fetching health or device data", async () => {
    const tx: any = {
      brandPartner: {
        findUnique: vi.fn(async () => ({
          active: true,
          level: { active: true, code: "distribution-1" },
        })),
      },
      user: { findFirst: vi.fn(async () => null) },
      healthRecord: { findMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const service = new PartnerMembersService(
      { $transaction: (fn: any) => fn(tx) } as any,
      {} as any,
    );
    await expect(
      service.healthRecords(randomUUID(), randomUUID(), "request", 1, 30),
    ).rejects.toThrow("会员不存在");
    expect(tx.healthRecord.findMany).not.toHaveBeenCalled();
  });
  it("does not accept an admin/member token with no independent partner session", async () => {
    const guard = new PartnerAuthGuard({
      partnerSession: { findUnique: vi.fn(async () => null) },
    } as any);
    const request = { header: () => "Bearer unrelated-token" };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as any),
    ).rejects.toThrow("登录已失效");
  });
  it("only permits Native QR for partner recharge, preserving retail channel policy", () => {
    expect(() =>
      assertGlobalPaymentScope({
        channel: PaymentChannel.WECHAT_NATIVE,
        businessType: BusinessType.PARTNER_RECHARGE,
      }),
    ).not.toThrow();
    expect(() =>
      assertGlobalPaymentScope({
        channel: PaymentChannel.WECHAT_NATIVE,
        businessType: BusinessType.COMMERCE_ORDER,
      }),
    ).toThrow();
    expect(() =>
      assertGlobalPaymentScope({
        channel: PaymentChannel.PARTNER_BALANCE,
        businessType: BusinessType.COMMERCE_ORDER,
      }),
    ).toThrow();
  });
  it("internal balance cannot be dispatched, refunded or closed at a money provider", async () => {
    const provider = new PaymentProviderService({} as any, {} as any);
    const intent: any = { channel: PaymentChannel.PARTNER_BALANCE };
    expect(paymentIntegrationKeyForNewIntent(intent.channel)).toBeNull();
    expect(paymentIntegrationKeyForStoredIntent(intent)).toBeNull();
    await expect(provider.create(intent, {})).rejects.toThrow("内部账务");
    await expect(provider.refund(intent)).rejects.toThrow("内部账务");
    await expect(provider.closePayment(intent)).rejects.toThrow("外部关闭");
  });
  it("blocks recharge refunds before any outbound money operation", async () => {
    const intent = {
      id: randomUUID(),
      executionOwner: "NEW_SYSTEM",
      businessType: BusinessType.PARTNER_RECHARGE,
      commerceOrder: null,
    };
    const tx: any = {
      $queryRaw: vi.fn(),
      paymentIntent: { findUnique: vi.fn(async () => intent) },
    };
    const provider = { refund: vi.fn() };
    const billing = new BillingService(
      { $transaction: (fn: any) => fn(tx) } as any,
      provider as any,
      {} as any,
    );
    await expect(
      billing.createRefund(intent.id, {
        amountCents: 100,
        reason: "合成退款",
        idempotencyKey: "recharge-refund",
      }),
    ).rejects.toThrow("充值退款尚未开放");
    expect(provider.refund).not.toHaveBeenCalled();
  });
});
