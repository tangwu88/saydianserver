import { describe, expect, it } from "vitest";
import { publicPushPayload } from "./notification-payload";

describe("push payload privacy", () => {
  it("keeps only routing metadata", () => {
    expect(
      publicPushPayload({
        eventId: "evt-1",
        type: "health_warning",
        deepLink: "/warnings/evt-1",
        mobile: "13800000000",
        healthValue: "180",
        accessToken: "secret",
      }),
    ).toEqual({
      eventId: "evt-1",
      type: "health_warning",
      deepLink: "/warnings/evt-1",
    });
  });
});
