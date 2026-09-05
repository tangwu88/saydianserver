import { describe, expect, it } from "vitest";
import { BusinessType, PaymentChannel } from "@prisma/client";
import { enforceDigitalPlatformPolicy } from "./billing.service";

describe("digital payment policy", () => {
  it("requires StoreKit for digital content in iOS", () => {
    expect(() =>
      enforceDigitalPlatformPolicy(
        BusinessType.HEALTH_REPORT,
        PaymentChannel.WECHAT_APP,
        "ios",
      ),
    ).toThrow(/苹果应用内购买/);
  });

  it("allows WeChat for physical orders on iOS", () => {
    expect(() =>
      enforceDigitalPlatformPolicy(
        BusinessType.COMMERCE_ORDER,
        PaymentChannel.WECHAT_APP,
        "ios",
      ),
    ).not.toThrow();
  });

  it("rejects StoreKit outside iOS", () => {
    expect(() =>
      enforceDigitalPlatformPolicy(
        BusinessType.HEALTH_MEMBERSHIP,
        PaymentChannel.APPLE_IAP,
        "android",
      ),
    ).toThrow(/不支持苹果应用内购买/);
  });
});
