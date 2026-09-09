import { afterEach, describe, expect, it, vi } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { IntegrationState, PaymentChannel } from "@prisma/client";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import { PaymentProviderService, parseAlipayRefundResponse, parseWechatRefundResponse, verifyWechatResponse, type RefundForProvider } from "./payment-provider.service";

// Ephemeral test-only keys. No real provider network request or account is used.
const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const request: RefundForProvider = { refundNo: "REF-partial-1", paymentNo: "PAY-original-1", providerTransactionId: "provider-original-1",
  amountCents: 101, totalCents: 1000, currency: "CNY", reason: "测试退款", channel: PaymentChannel.WECHAT_APP };
const wechat = (extra: Record<string, unknown> = {}) => ({ status: "SUCCESS", refund_id: "wx-refund-1", out_refund_no: request.refundNo,
  out_trade_no: request.paymentNo, transaction_id: request.providerTransactionId, amount: { total: 1000, refund: 101, currency: "CNY" }, ...extra });
const alipay = (extra: Record<string, unknown> = {}) => ({ code: "10000", trade_no: request.providerTransactionId,
  out_trade_no: request.paymentNo, refund_fee: "1.01", ...extra });
function sign(value: string) { const signer = createSign("RSA-SHA256"); signer.update(value); return signer.sign(keys.privateKey, "base64"); }
function signedWechat(raw: string) {
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = "test-response-nonce";
  return new Headers({ "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Serial": "PLATFORM-SERIAL",
    "Wechatpay-Signature": sign(`${timestamp}\n${nonce}\n${raw}\n`) });
}
function fixture(extraSecrets: Record<string, string | undefined> = {}) {
  const prisma = { integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: IntegrationState.CONFIGURED,
    publicConfig: { refundNotifyUrl: "https://example.invalid/refund-notify", gateway: "https://example.invalid/alipay" } }), updateMany: vi.fn() } };
  const secrets = { resolve: vi.fn().mockResolvedValue({ merchantId: "merchant-1", serialNo: "MERCHANT-SERIAL", appId: "app-1", privateKeyPem: keys.privateKey,
    publicKeyPem: keys.publicKey, platformPublicKeyPem: keys.publicKey, platformSerialNo: "PLATFORM-SERIAL", ...extraSecrets }) };
  return new PaymentProviderService(prisma as unknown as PrismaService, secrets as unknown as IntegrationSecretsService);
}
afterEach(() => vi.unstubAllGlobals());

describe("provider refund response contract", () => {
  it("returns actual WeChat amount and complete request/transaction binding", () => {
    expect(parseWechatRefundResponse(wechat(), request)).toMatchObject({ completed: true, amountCents: 101, currency: "CNY",
      refundNo: request.refundNo, paymentNo: request.paymentNo, providerTransactionId: request.providerTransactionId, providerRefundId: "wx-refund-1" });
    expect(parseWechatRefundResponse(wechat({ status: "PROCESSING" }), request).completed).toBe(false);
  });
  it.each([undefined, null, "101", 101.5, 0])("does not replace absent/invalid WeChat refund amount %s with requested money", (refund) => {
    expect(() => parseWechatRefundResponse(wechat({ amount: { refund, total: 1000, currency: "CNY" } }), request)).toThrow("金额");
  });
  it("rejects wrong refund amount, original total, currency or bound identifiers", () => {
    expect(() => parseWechatRefundResponse(wechat({ amount: { refund: 100, total: 1000, currency: "CNY" } }), request)).toThrow("实际金额不一致");
    expect(() => parseWechatRefundResponse(wechat({ amount: { refund: 101, total: 999, currency: "CNY" } }), request)).toThrow("原交易金额");
    expect(() => parseWechatRefundResponse(wechat({ amount: { refund: 101, total: 1000, currency: "USD" } }), request)).toThrow("币种");
    for (const field of ["out_refund_no", "out_trade_no", "transaction_id"]) {
      expect(() => parseWechatRefundResponse(wechat({ [field]: "other" }), request)).toThrow("不匹配");
      expect(() => parseWechatRefundResponse(wechat({ [field]: undefined }), request)).toThrow("缺失");
    }
    expect(() => parseWechatRefundResponse(wechat({ refund_id: null }), request)).toThrow("退款号缺失");
  });
  it("Alipay partial refunds of one trade have different stable refund IDs", () => {
    const first = parseAlipayRefundResponse(alipay(), request);
    const second = parseAlipayRefundResponse(alipay(), { ...request, refundNo: "REF-partial-2" });
    expect(first).toMatchObject({ completed: true, amountCents: 101, refundNo: "REF-partial-1", providerRefundId: "alipay:provider-original-1:REF-partial-1", currency: null });
    expect(second.providerRefundId).not.toBe(first.providerRefundId);
    expect(parseAlipayRefundResponse(alipay({ out_request_no: request.refundNo }), request).providerRefundId).toBe(first.providerRefundId);
  });
  it.each([undefined, null, "", 1.01, "1.011", "1e2", "-1", "0.00", " 1.01"])('rejects invalid Alipay actual money "%s"', (refund_fee) => {
    expect(() => parseAlipayRefundResponse(alipay({ refund_fee }), request)).toThrow("金额");
  });
  it("parses cents without rounding and never substitutes original transaction identifiers", () => {
    expect(parseAlipayRefundResponse(alipay({ refund_fee: "0.29" }), { ...request, amountCents: 29 }).amountCents).toBe(29);
    expect(() => parseAlipayRefundResponse(alipay({ refund_fee: "1.00" }), request)).toThrow("实际金额不一致");
    expect(() => parseAlipayRefundResponse(alipay({ out_request_no: "wrong" }), request)).toThrow("不匹配");
    expect(() => parseAlipayRefundResponse(alipay({ trade_no: undefined }), request)).toThrow("原渠道交易号缺失");
    expect(() => parseAlipayRefundResponse(alipay({ out_trade_no: undefined }), request)).toThrow("原支付单号缺失");
    expect(() => parseAlipayRefundResponse(alipay({ trade_no: "wrong" }), request)).toThrow("不匹配");
    expect(() => parseAlipayRefundResponse(alipay({ refund_currency: "USD" }), request)).toThrow("币种");
  });
  it("verifies the exact signed WeChat response and rejects forged or missing response headers", () => {
    const raw = JSON.stringify(wechat()); const headers = signedWechat(raw);
    expect(verifyWechatResponse(raw, headers, keys.publicKey, "PLATFORM-SERIAL")).toEqual(wechat());
    expect(() => verifyWechatResponse(raw.replace('"refund":101', '"refund":999'), headers, keys.publicKey, "PLATFORM-SERIAL")).toThrow("签名验证失败");
    expect(() => verifyWechatResponse(raw, new Headers(), keys.publicKey, "PLATFORM-SERIAL")).toThrow();
    expect(() => verifyWechatResponse(raw, headers, keys.publicKey, "wrong-serial")).toThrow("证书不匹配");
  });
  it("public WeChat refund path consumes signed raw responses and rejects missing verifier config before dispatch", async () => {
    const raw = JSON.stringify(wechat()); const fetchMock = vi.fn().mockResolvedValue(new Response(raw, { status: 200, headers: signedWechat(raw) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fixture().refund(request)).toMatchObject({ amountCents: 101, paymentNo: request.paymentNo });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(fixture({ platformPublicKeyPem: undefined }).refund(request)).rejects.toThrow("不能发起交易请求");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("public Alipay refund path validates signed actual amount before returning completion", async () => {
    const result = alipay(); const content = JSON.stringify(result);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ alipay_trade_refund_response: result, sign: sign(content) }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const completed = await fixture().refund({ ...request, channel: PaymentChannel.ALIPAY_APP });
    expect(completed.providerRefundId).toBe("alipay:provider-original-1:REF-partial-1");
    const body = new URLSearchParams(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(JSON.parse(body.get("biz_content") || "{}").out_request_no).toBe(request.refundNo);
    const badResult = alipay({ refund_fee: "0.01" }); const badContent = JSON.stringify(badResult);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ alipay_trade_refund_response: badResult, sign: sign(badContent) }), { status: 200 }));
    await expect(fixture().refund({ ...request, channel: PaymentChannel.ALIPAY_APP })).rejects.toThrow("实际金额不一致");
  });
});
