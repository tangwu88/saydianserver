import { describe, expect, it } from "vitest";
import { PermanentCampaignError } from "./notification-campaign-worker";

describe("notification campaign worker boundary", () => {
  it("uses a distinct permanent error for invalid campaigns", () => {
    expect(new PermanentCampaignError("invalid")).toBeInstanceOf(Error);
  });
});
