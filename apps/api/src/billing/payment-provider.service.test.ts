import { describe, expect, it } from "vitest";
import {
  extractJsonObject,
  validateWechatNotificationHeaders,
} from "./payment-provider.service";

describe("payment provider response parsing", () => {
  it("extracts the exact signed Alipay response object", () => {
    const raw =
      '{"alipay_trade_refund_response":{"code":"10000","msg":"Success","detail":{"note":"a}b"}},"sign":"signature"}';

    expect(extractJsonObject(raw, "alipay_trade_refund_response")).toBe(
      '{"code":"10000","msg":"Success","detail":{"note":"a}b"}}',
    );
  });

  it("does not accept a missing or unterminated response object", () => {
    expect(extractJsonObject('{"other":{}}', "alipay_trade_refund_response")).toBe("");
    expect(
      extractJsonObject(
        '{"alipay_trade_refund_response":{"code":"10000"',
        "alipay_trade_refund_response",
      ),
    ).toBe("");
  });

  it("rejects stale or mismatched WeChat payment notifications", () => {
    const now = 1_788_480_000_000;
    const validHeaders = {
      "wechatpay-timestamp": "1788480000",
      "wechatpay-nonce": "callback-nonce",
      "wechatpay-signature": "signed-value",
      "wechatpay-serial": "PLATFORM-SERIAL",
    };
    expect(
      validateWechatNotificationHeaders(validHeaders, "platform-serial", now),
    ).toMatchObject({ nonce: "callback-nonce" });
    expect(() =>
      validateWechatNotificationHeaders(
        { ...validHeaders, "wechatpay-timestamp": "1788479000" },
        "platform-serial",
        now,
      ),
    ).toThrow(/已过期/);
    expect(() =>
      validateWechatNotificationHeaders(
        { ...validHeaders, "wechatpay-serial": "other-serial" },
        "platform-serial",
        now,
      ),
    ).toThrow(/证书不匹配/);
  });
});
