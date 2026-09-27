import { afterEach, describe, expect, it, vi } from "vitest";
import { JPushProvider, MockPushProvider } from "./push-provider";

afterEach(() => vi.unstubAllGlobals());

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

describe("application-bound JPush provider", () => {
  it("sends only registrations belonging to the configured Say Ring provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new JPushProvider(
      "say-ring-app-key",
      "say-ring-master-secret",
      undefined,
      "jpush_say_ring",
      "say_ring_push",
    );

    await provider.deliver(
      [
        { provider: "jpush", registrationId: "legacy-registration", locale: "zh-Hans" },
        { provider: "jpush_say_ring", registrationId: "ring-registration", locale: "zh-Hans" },
      ] as any,
      { eventId: "event-1", type: "system" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.audience.registration_id).toEqual(["ring-registration"]);
  });
});
