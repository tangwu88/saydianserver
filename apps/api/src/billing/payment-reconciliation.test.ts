import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessType, PaymentChannel, PaymentStatus } from "@prisma/client";
import { BillingService } from "./billing.service";

const pending = {
  id: "00000000-0000-4000-8000-000000000901",
  paymentNo: "PAY-reconcile-1",
  businessType: BusinessType.COMMERCE_ORDER,
  businessId: "00000000-0000-4000-8000-000000000902",
  channel: PaymentChannel.WECHAT_JSAPI,
  status: PaymentStatus.PENDING,
  amountCents: 980,
  currency: "CNY",
  providerPayload: { type: "JSAPI" },
  providerMerchantId: "merchant-1",
  providerAppId: "official-app",
  createdAt: new Date("2026-09-11T12:24:02.000Z"),
};

const success = {
  appid: pending.providerAppId,
  mchid: pending.providerMerchantId,
  out_trade_no: pending.paymentNo,
  transaction_id: "wechat-transaction-1",
  trade_state: "SUCCESS",
  amount: { total: pending.amountCents, currency: pending.currency },
};

const alipayPending = {
  ...pending,
  id: "00000000-0000-4000-8000-000000000903",
  paymentNo: "PAY-reconcile-alipay-1",
  channel: PaymentChannel.ALIPAY_WAP,
  providerPayload: { type: "FORM" },
  providerMerchantId: null,
  providerAppId: "alipay-app",
};

const alipaySuccess = {
  code: "10000",
  out_trade_no: alipayPending.paymentNo,
  trade_no: "alipay-transaction-1",
  trade_status: "TRADE_SUCCESS",
  total_amount: "9.80",
};

function fixture(payload: Record<string, unknown> = success) {
  const prisma = { paymentIntent: { findFirst: vi.fn()
    .mockResolvedValueOnce(pending)
    .mockResolvedValueOnce({ ...pending, status: PaymentStatus.SUCCEEDED, providerPayload: payload }) } };
  const providers = { queryWechatPayment: vi.fn().mockResolvedValue(payload) };
  const service = new BillingService(prisma as any, providers as any, {} as any);
  const markPaid = vi.spyOn(service, "markPaid").mockResolvedValue();
  vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);
  return { prisma, providers, service, markPaid };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("member payment status reconciliation", () => {
  it("changes a pending payment only from a fully bound successful WeChat query", async () => {
    const h = fixture();
    await expect(h.service.payment("member-1", pending.id)).resolves.toMatchObject({ status: "succeeded" });
    expect(h.providers.queryWechatPayment).toHaveBeenCalledWith(pending);
    expect(h.markPaid).toHaveBeenCalledWith(pending.paymentNo, success.transaction_id, pending.amountCents, success, { integrationKey: "wechat_pay" });
    expect(h.prisma.paymentIntent.findFirst).toHaveBeenCalledTimes(2);
  });

  it.each([
    { trade_state: "NOTPAY" },
    { trade_state: "SUCCESS", out_trade_no: "another-payment" },
    { trade_state: "SUCCESS", mchid: "another-merchant" },
    { trade_state: "SUCCESS", appid: "another-app" },
    { trade_state: "SUCCESS", amount: { total: 979, currency: "CNY" } },
    { trade_state: "SUCCESS", amount: { total: 980, currency: "USD" } },
  ])("does not mark an unconfirmed or mismatched WeChat result as paid: %j", async patch => {
    const h = fixture({ ...success, ...patch });
    await expect(h.service.payment("member-1", pending.id)).resolves.toMatchObject({ status: "pending" });
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("keeps the existing pending result when the provider query is temporarily unavailable", async () => {
    const h = fixture(); h.providers.queryWechatPayment.mockRejectedValue(new Error("synthetic timeout"));
    await expect(h.service.payment("member-1", pending.id)).resolves.toMatchObject({ status: "pending" });
    expect(h.markPaid).not.toHaveBeenCalled();
  });

  it("does not query an already successful payment", async () => {
    const h = fixture(); h.prisma.paymentIntent.findFirst.mockReset().mockResolvedValue({ ...pending, status: PaymentStatus.SUCCEEDED });
    await expect(h.service.payment("member-1", pending.id)).resolves.toMatchObject({ status: "succeeded" });
    expect(h.providers.queryWechatPayment).not.toHaveBeenCalled();
  });

  it("changes a pending payment only from a bound successful Alipay query", async () => {
    const prisma = { paymentIntent: { findFirst: vi.fn()
      .mockResolvedValueOnce(alipayPending)
      .mockResolvedValueOnce({ ...alipayPending, status: PaymentStatus.SUCCEEDED, providerPayload: alipaySuccess }) } };
    const providers = { queryAlipayPayment: vi.fn().mockResolvedValue(alipaySuccess) };
    const service = new BillingService(prisma as any, providers as any, {} as any);
    const markPaid = vi.spyOn(service, "markPaid").mockResolvedValue();
    vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);

    await expect(service.payment("member-1", alipayPending.id)).resolves.toMatchObject({ status: "succeeded" });
    expect(providers.queryAlipayPayment).toHaveBeenCalledWith(alipayPending);
    expect(markPaid).toHaveBeenCalledWith(alipayPending.paymentNo, alipaySuccess.trade_no, alipayPending.amountCents, alipaySuccess, { alipayAppId: alipayPending.providerAppId, integrationKey: "alipay" });
  });

  it("accepts Alipay's signed numeric total_amount response", async () => {
    const payload = { ...alipaySuccess, total_amount: 9.8 };
    const prisma = { paymentIntent: { findFirst: vi.fn()
      .mockResolvedValueOnce(alipayPending)
      .mockResolvedValueOnce({ ...alipayPending, status: PaymentStatus.SUCCEEDED, providerPayload: payload }) } };
    const providers = { queryAlipayPayment: vi.fn().mockResolvedValue(payload) };
    const service = new BillingService(prisma as any, providers as any, {} as any);
    const markPaid = vi.spyOn(service, "markPaid").mockResolvedValue();

    await expect(service.payment("member-1", alipayPending.id)).resolves.toMatchObject({ status: "succeeded" });
    expect(markPaid).toHaveBeenCalledWith(alipayPending.paymentNo, alipaySuccess.trade_no, alipayPending.amountCents, payload, { alipayAppId: alipayPending.providerAppId, integrationKey: "alipay" });
  });

  it.each([
    { trade_status: "WAIT_BUYER_PAY" },
    { out_trade_no: "another-payment" },
    { total_amount: "9.79" },
    { total_amount: "bad" },
  ])("does not mark an unconfirmed or mismatched Alipay result as paid: %j", async patch => {
    const payload = { ...alipaySuccess, ...patch };
    const prisma = { paymentIntent: { findFirst: vi.fn().mockResolvedValue(alipayPending) } };
    const providers = { queryAlipayPayment: vi.fn().mockResolvedValue(payload) };
    const service = new BillingService(prisma as any, providers as any, {} as any);
    const markPaid = vi.spyOn(service, "markPaid").mockResolvedValue();
    vi.spyOn((service as any).logger, "warn").mockImplementation(() => undefined);

    await expect(service.payment("member-1", alipayPending.id)).resolves.toMatchObject({ status: "pending" });
    expect(markPaid).not.toHaveBeenCalled();
  });
});
