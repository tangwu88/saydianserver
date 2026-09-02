import { describe, expect, it } from "vitest";
import {
  hasConfiguredCommerce,
  hasConfiguredObjectStorage,
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

  it("keeps commerce unconfigured without an internal service token", () => {
    expect(hasConfiguredCommerce({})).toBe(false);
    expect(hasConfiguredCommerce({ MALL_SERVICE_TOKEN: "service-token" })).toBe(
      true,
    );
  });
});
