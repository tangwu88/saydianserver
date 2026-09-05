import { describe, expect, it } from "vitest";
import {
  hasConfiguredAlipay,
  hasConfiguredCommerce,
  hasConfiguredObjectStorage,
  hasConfiguredWechatPay,
  hasConfiguredWeCom,
  shouldSeedPreviewContent,
} from "./seed-policy";

describe("production seed policy", () => {
  it("does not publish preview content in production", () => {
    expect(shouldSeedPreviewContent({ NODE_ENV: "production" })).toBe(false);
    expect(
      shouldSeedPreviewContent({
        NODE_ENV: "production",
        SEED_PREVIEW_CONTENT: "true",
      }),
    ).toBe(true);
  });

  it("requires every object storage setting before marking it configured", () => {
    expect(
      hasConfiguredObjectStorage({
        OBJECT_STORAGE_ENDPOINT: "https://cos.ap-beijing.myqcloud.com",
        OBJECT_STORAGE_BUCKET: "private-bucket",
        OBJECT_STORAGE_ACCESS_KEY: "access-key",
      }),
    ).toBe(false);
    expect(
      hasConfiguredObjectStorage({
        OBJECT_STORAGE_ENDPOINT: "https://cos.ap-beijing.myqcloud.com",
        OBJECT_STORAGE_BUCKET: "private-bucket",
        OBJECT_STORAGE_ACCESS_KEY: "access-key",
        OBJECT_STORAGE_SECRET_KEY: "secret-key",
      }),
    ).toBe(true);
  });

  it("uses integrated commerce unless an external compatibility mode is explicit", () => {
    expect(hasConfiguredCommerce({})).toBe(true);
    expect(hasConfiguredCommerce({ COMMERCE_MODE: "external" })).toBe(false);
  });

  it("requires complete payment credentials before marking providers configured", () => {
    expect(hasConfiguredWechatPay({ WECHAT_PAY_MERCHANT_ID: "merchant" })).toBe(false);
    expect(
      hasConfiguredWechatPay({
        WECHAT_PAY_MERCHANT_ID: "merchant",
        WECHAT_PAY_SERIAL_NO: "serial",
        WECHAT_PAY_PRIVATE_KEY_PEM: "private",
        WECHAT_PAY_API_V3_KEY: "12345678901234567890123456789012",
        WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM: "public",
        WECHAT_PAY_PLATFORM_SERIAL_NO: "platform-serial",
      }),
    ).toBe(true);
    expect(hasConfiguredAlipay({ ALIPAY_APP_ID: "app" })).toBe(false);
    expect(
      hasConfiguredAlipay({
        ALIPAY_APP_ID: "app",
        ALIPAY_PRIVATE_KEY_PEM: "private",
        ALIPAY_PUBLIC_KEY_PEM: "public",
      }),
    ).toBe(true);
  });

  it("requires complete enterprise WeChat settings before enabling employee login", () => {
    expect(hasConfiguredWeCom({ WECOM_CORP_ID: "corp" })).toBe(false);
    expect(
      hasConfiguredWeCom({
        WECOM_CORP_ID: "corp",
        WECOM_AGENT_ID: "1000001",
        WECOM_SECRET: "secret",
        COMMERCE_STOREFRONT_URL: "https://app.saydian.cn/saidian-mall",
      }),
    ).toBe(true);
  });
});
