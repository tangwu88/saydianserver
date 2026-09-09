import { describe, expect, it } from "vitest";
import { assertCutoverWindow, paymentTakeoverProblems } from "./takeover";

describe("one-time transaction takeover gates", () => {
  const paid = { id: "old-payment", channel: "WECHAT_APP", status: "SUCCEEDED", providerMerchantId: "verified-old-merchant", providerAppId: "verified-old-app", providerTransactionId: "original-transaction" };
  it("does not infer original merchant configuration from the new integration", () => {
    expect(paymentTakeoverProblems([{ ...paid, providerMerchantId: null }])).toContain("payment:old-payment:original_wechat_merchant_or_app_missing");
    expect(paymentTakeoverProblems([{ ...paid, providerTransactionId: null }])).toContain("payment:old-payment:provider_transaction_missing");
  });
  it("allows unpaid orders without a provider transaction but still requires original channel identities", () => {
    expect(paymentTakeoverProblems([{ ...paid, status: "PENDING", providerTransactionId: null }])).toEqual([]);
    expect(paymentTakeoverProblems([paid])).toEqual([]);
    expect(paymentTakeoverProblems([{ ...paid, channel: "ALIPAY_APP", providerAppId: null }])).toContain("payment:old-payment:original_alipay_app_missing");
  });
  it("fails closed when the 30-minute window expires, including immediately before commit", () => {
    const start = "2026-09-09T00:00:00Z";
    const epoch = Date.parse(start);
    expect(() => assertCutoverWindow(start, epoch + 29 * 60_000)).not.toThrow();
    expect(() => assertCutoverWindow(start, epoch + 30 * 60_000)).toThrow("expired");
    expect(() => assertCutoverWindow("", epoch)).toThrow("expired");
    expect(() => assertCutoverWindow(start, epoch - 1)).toThrow("expired");
  });
});
