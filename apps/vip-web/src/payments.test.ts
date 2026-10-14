import { describe, expect, it } from "vitest";
import {
  alipayTransport,
  partnerPaymentChannels,
  trustedPaymentUrl,
} from "./payments";
describe("partner environment payments", () => {
  it("routes WeChat, mobile and desktop to their supported channels", () => {
    expect(partnerPaymentChannels("iPhone MicroMessenger")).toEqual([
      "wechat_jsapi",
    ]);
    expect(partnerPaymentChannels("Android Chrome")).toEqual([
      "wechat_h5",
      "alipay_wap",
    ]);
    expect(partnerPaymentChannels("Macintosh Chrome")).toEqual([
      "wechat_native",
      "alipay_page",
    ]);
  });
  it("preserves signed Chinese business content in UTF8 form body and puts transport fields in query", () => {
    const content = JSON.stringify({
      subject: "赛电充值",
      total_amount: "10000.00",
    });
    const result = alipayTransport({
      type: "FORM",
      url: "https://openapi.alipay.com/gateway.do",
      fields: {
        app_id: "synthetic",
        charset: "utf-8",
        sign: "a+/=",
        biz_content: content,
        return_url: "https://app.saydian.cn/vip/recharges/test",
      },
    });
    const url = new URL(result.url);
    expect(url.searchParams.get("charset")).toBe("utf-8");
    expect(url.searchParams.get("sign")).toBe("a+/=");
    expect(result.fields).toEqual({ biz_content: content });
  });
  it.each([
    "http://openapi.alipay.com/gateway.do",
    "https://openapi.alipay.com.evil.invalid/gateway.do",
    "https://user:pass@wx.tenpay.com/path",
    "https://wx.tenpay.com:8080/path",
    "javascript:alert(1)",
  ])("rejects untrusted redirect %s", (value) => {
    expect(() => trustedPaymentUrl(value)).toThrow();
  });
});
