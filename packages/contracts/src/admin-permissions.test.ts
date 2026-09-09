import { describe, expect, it } from "vitest";
import { canAdminResource } from "./admin-permissions";

describe("shared administrator resource permissions", () => {
  it("unions multiple roles without giving commerce operators financial write privileges", () => {
    expect(canAdminResource("COMMERCE_OPERATIONS", "commerce-orders", "write")).toBe(true);
    expect(canAdminResource("COMMERCE_OPERATIONS", "commerce-after-sales", "refund")).toBe(false);
    expect(canAdminResource(["COMMERCE_OPERATIONS", "FINANCE"], "commerce-after-sales", "refund")).toBe(true);
  });
  it("restricts sensitive reads and treats missing or unknown resources as denied", () => {
    expect(canAdminResource("CONTENT_EDITOR", "members")).toBe(false);
    expect(canAdminResource("COMMERCE_OPERATIONS", "commerce-withdrawals")).toBe(false);
    expect(canAdminResource("FINANCE", "commerce-withdrawals")).toBe(true);
    expect(canAdminResource("READ_ONLY", "commerce-orders")).toBe(true);
    expect(canAdminResource("READ_ONLY", "commerce-orders", "write")).toBe(false);
    expect(canAdminResource([], "dashboard")).toBe(false);
    expect(canAdminResource("READ_ONLY", "new-unconfigured-module")).toBe(false);
  });
});
