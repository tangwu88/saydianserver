import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentChannel, PaymentStatus, RefundStatus } from "@prisma/client";
import { BillingService, assertNewExecutionOwner, assertPaymentOutboundEnabled, assertProviderResultIdentity, assertRefundResultBinding } from "./billing.service";

const id = "00000000-0000-4000-8000-000000000001";
const refundInput = { amountCents: 100, reason: "售后退款", idempotencyKey: "refund-safe-001" };
function harness(existing: unknown = null) {
  const intent = { id, executionOwner: "NEW_SYSTEM", channel: PaymentChannel.WECHAT_APP, status: PaymentStatus.SUCCEEDED,
    amountCents: 100, currency: "CNY", refunds: [], commerceOrder: null, paymentNo: "PAY001", providerTransactionId: "TX001", providerAppId: "app", providerMerchantId: "merchant" };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    paymentIntent: { findUnique: vi.fn().mockResolvedValue(intent), update: vi.fn().mockResolvedValue(intent) },
    paymentRefund: { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn().mockImplementation(({ data }) => ({ id: "refund-id", ...data })) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async work => work(tx)), paymentRefund: { ...tx.paymentRefund, updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
  const providers = { assertIdentity: vi.fn(), refund: vi.fn().mockRejectedValue(new Error("timeout after provider accepted")) };
  return { service: new BillingService(prisma as any, providers as any, {} as any), prisma, tx, providers, intent };
}

function refundCallbackHarness(status: RefundStatus = RefundStatus.PROCESSING) {
  const intent = { id, executionOwner: "NEW_SYSTEM", channel: PaymentChannel.WECHAT_APP, amountCents: 100,
    currency: "CNY", paymentNo: "PAY1", providerTransactionId: "TX1", providerMerchantId: "M1", providerAppId: "APP1", commerceOrderId: null };
  const refund = { id: "r1", refundNo: "REF1", paymentIntentId: id, paymentIntent: intent, executionOwner: "NEW_SYSTEM", amountCents: 100, providerRefundId: "WXREF1", status };
  const tx = { $queryRaw: vi.fn().mockResolvedValue([]),
    paymentRefund: { findUnique: vi.fn().mockResolvedValue(refund), findUniqueOrThrow: vi.fn().mockResolvedValue(refund), updateMany: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: status === RefundStatus.SUCCEEDED ? 100 : 0 } }), count: vi.fn().mockResolvedValue(status === RefundStatus.SUCCEEDED ? 0 : 1) },
    paymentIntent: { findUniqueOrThrow: vi.fn().mockResolvedValue(intent), update: vi.fn() } };
  const prisma = { ...tx, $transaction: vi.fn(async work => work(tx)) };
  const payload = { out_refund_no: "REF1", refund_id: "WXREF1", out_trade_no: "PAY1", transaction_id: "TX1", mchid: "M1", refund_status: "PROCESSING", amount: { refund: 100, currency: "CNY" } };
  return { service: new BillingService(prisma as any, {} as any, {} as any), prisma, tx, refund, payload };
}

afterEach(() => vi.unstubAllEnvs());
describe("transaction ownership and money request safety", () => {
  it("requires the official-account payer binding before reserving a pending JSAPI payment", async () => {
    const prisma = { paymentIntent: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn() };
    const providers = { identity: vi.fn().mockResolvedValue({ merchantId: "merchant", appId: "official-app" }),
      resolveOfficialPayer: vi.fn().mockRejectedValue(new Error("公众号身份未绑定")) };
    const service = new BillingService(prisma as any, providers as any, {} as any);
    vi.spyOn(service as any, "resolveBusiness").mockResolvedValue({ businessId: "o", commerceOrderId: "o", amountCents: 1, currency: "CNY", description: "test" });
    const input = { businessType: "commerce_order", businessId: "o", channel: "wechat_jsapi", idempotencyKey: "jsapi-binding-check" };
    await expect(service.createPayment("u", input, {})).rejects.toThrow("未绑定");
    expect(providers.resolveOfficialPayer).toHaveBeenCalledWith("u", "official-app");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    providers.identity.mockResolvedValue({ merchantId: "merchant", appId: null as any });
    await expect(service.createPayment("u", input, {})).rejects.toThrow("应用尚未配置");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("fails closed for untransferred transactions and paused outbound requests", () => {
    expect(() => assertNewExecutionOwner({ executionOwner: "LEGACY_SYSTEM" })).toThrow(/接管/);
    expect(() => assertNewExecutionOwner({ executionOwner: "NEW_SYSTEM" })).not.toThrow();
    expect(() => assertPaymentOutboundEnabled({ WORKER_OUTBOUND_PAUSED: "true" })).toThrow(/暂停/);
    expect(() => assertPaymentOutboundEnabled({ BUSINESS_WRITES_PAUSED: "true" })).toThrow();
  });
  it("checks callback merchant, app and currency", () => {
    const identity = { channel: PaymentChannel.WECHAT_APP, currency: "CNY", providerMerchantId: "m1", providerAppId: "a1" };
    expect(() => assertProviderResultIdentity(identity, { mchid: "m2", appid: "a1" })).toThrow(/商户/);
    expect(() => assertProviderResultIdentity(identity, { mchid: "m1", appid: "a2" })).toThrow(/应用/);
    expect(() => assertProviderResultIdentity(identity, { mchid: "m1", appid: "a1", amount: { currency: "USD" } })).toThrow(/币种/);
  });
  it("never resends an existing processing refund", async () => {
    const existing = { id: "r1", paymentIntentId: id, amountCents: 100, afterSaleId: null, status: RefundStatus.PROCESSING };
    const { service, providers, tx } = harness(existing);
    await expect(service.createRefund(id, refundInput)).resolves.toEqual(existing);
    expect(providers.refund).not.toHaveBeenCalled();
    expect(tx.paymentRefund.create).not.toHaveBeenCalled();
  });
  it("rejects reuse with changed amount", async () => {
    const { service, providers } = harness({ paymentIntentId: id, amountCents: 99, afterSaleId: null });
    await expect(service.createRefund(id, refundInput)).rejects.toThrow(/不同参数/);
    expect(providers.refund).not.toHaveBeenCalled();
  });
  it("holds uncertain refunds and their quota for reconciliation", async () => {
    const { service, prisma, providers, tx } = harness();
    await expect(service.createRefund(id, refundInput)).rejects.toThrow(/timeout/);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(providers.refund).toHaveBeenCalledOnce();
    expect(prisma.paymentRefund.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: RefundStatus.PROCESSING, providerPayload: expect.objectContaining({ reconciliationRequired: true }) }) }));
  });
  it("includes in-flight refunds in the available quota", async () => {
    const { service, intent, providers } = harness();
    (intent.refunds as any[]).push({ amountCents: 1, status: RefundStatus.PROCESSING });
    await expect(service.createRefund(id, refundInput)).rejects.toThrow(/超过可退/);
    expect(providers.refund).not.toHaveBeenCalled();
  });
});

describe("durable verified callback inbox", () => {
  it("non-final refund notifications do not release the reserved amount", async () => {
    const { service, prisma, tx, payload } = refundCallbackHarness();
    await (service as any).applyWechatRefundResult(payload);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(prisma.paymentRefund.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: RefundStatus.PROCESSING }) }));
    expect(prisma.paymentIntent.update).toHaveBeenCalledWith({ where: { id }, data: { status: PaymentStatus.REFUNDING } });
  });
  it("a stale refund notification cannot undo a successful refund", async () => {
    const { service, tx, payload } = refundCallbackHarness(RefundStatus.SUCCEEDED);
    await (service as any).applyWechatRefundResult({ ...payload, refund_status: "CLOSED" });
    expect(tx.paymentRefund.updateMany).not.toHaveBeenCalled();
    expect(tx.paymentIntent.update).not.toHaveBeenCalled();
  });
  it("rechecks ownership under the payment lock for non-success notifications", async () => {
    const { service, refund, tx, payload } = refundCallbackHarness();
    refund.executionOwner = "LEGACY_SYSTEM";
    await expect((service as any).applyWechatRefundResult({ ...payload, refund_status: "CLOSED" })).rejects.toThrow(/接管/);
    expect(tx.paymentRefund.updateMany).not.toHaveBeenCalled();
  });
  it("rejects mismatched amount, original transaction, merchant and refund identity", () => {
    const { refund, payload } = refundCallbackHarness();
    expect(() => assertRefundResultBinding(refund, payload, 99, "WXREF1")).toThrow(/金额/);
    expect(() => assertRefundResultBinding(refund, { ...payload, transaction_id: "other" }, 100, "WXREF1")).toThrow(/原渠道交易/);
    expect(() => assertRefundResultBinding(refund, { ...payload, mchid: undefined }, 100, "WXREF1")).toThrow(/商户/);
    expect(() => assertRefundResultBinding(refund, payload, 100, "other")).toThrow(/退款编号/);
  });
  it("acknowledges a signed event only after persistence while business processing is paused", async () => {
    vi.stubEnv("CALLBACK_PROCESSING_PAUSED", "true");
    const row = { create: vi.fn(), findUnique: vi.fn().mockResolvedValue(null), updateMany: vi.fn() };
    const decoded = { trade_state: "SUCCESS", transaction_id: "tx", out_trade_no: "pay", amount: { total: 100 } };
    const providers = { decodeWechatNotification: vi.fn().mockResolvedValue(decoded) };
    const service = new BillingService({ providerEvent: row } as any, providers as any, {} as any);
    const paid = vi.spyOn(service, "markPaid");
    await expect(service.handleWechatNotification({}, { id: "event-1" }, Buffer.from("{}"))).resolves.toEqual({ code: "SUCCESS", message: "成功" });
    expect(row.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: decoded, verifiedAt: expect.any(Date), processingState: "DEFERRED" }) });
    expect(paid).not.toHaveBeenCalled();
  });
  it("does not acknowledge events when durable persistence fails", async () => {
    vi.stubEnv("CALLBACK_PROCESSING_PAUSED", "true");
    const service = new BillingService({ providerEvent: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue(new Error("database unavailable")) } } as any,
      { decodeWechatNotification: vi.fn().mockResolvedValue({ transaction_id: "tx" }) } as any, {} as any);
    await expect(service.handleWechatNotification({}, { id: "event-2" }, Buffer.from("{}"))).rejects.toThrow(/database unavailable/);
  });
  it("does not persist an unverified callback", async () => {
    const create = vi.fn();
    const service = new BillingService({ providerEvent: { create } } as any, { decodeWechatNotification: vi.fn().mockRejectedValue(new Error("signature invalid")) } as any, {} as any);
    await expect(service.handleWechatNotification({}, {}, Buffer.from("{}"))).rejects.toThrow(/signature invalid/);
    expect(create).not.toHaveBeenCalled();
  });
});
