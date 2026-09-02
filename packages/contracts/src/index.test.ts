import { describe, expect, it } from "vitest";
import { buildSafePushPayload, isAdminRole, isHealthMetric } from "./index";

describe("public contracts", () => {
  it("accepts only canonical health metrics", () => {
    expect(isHealthMetric("heart_rate")).toBe(true);
    expect(isHealthMetric("heartReat")).toBe(false);
  });

  it("keeps admin roles explicit", () => {
    expect(isAdminRole("HEALTH_AUDITOR")).toBe(true);
    expect(isAdminRole("ADMIN")).toBe(false);
  });

  it("keeps push payload free of health values and phone numbers", () => {
    const input = {
      eventId: "warning-1",
      type: "health_warning",
      deepLink: "/warnings/1",
      mobile: "13800000000",
      value: 188,
    };
    expect(buildSafePushPayload(input)).toEqual({
      eventId: "warning-1",
      type: "health_warning",
      deepLink: "/warnings/1",
    });
  });
});
