import { describe, expect, it } from "vitest";
import { MockPushProvider } from "./push-provider";

describe("mock push provider", () => {
  it("accepts an empty installation list without external access", async () => {
    await expect(
      new MockPushProvider().deliver([], {
        eventId: "event-1",
        type: "system",
      }),
    ).resolves.toBeUndefined();
  });
});
