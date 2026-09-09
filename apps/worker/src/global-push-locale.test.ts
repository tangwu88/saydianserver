import { afterEach, describe, expect, it, vi } from "vitest";
import { globalPushAlert } from "./global-push-locale";
import { JPushProvider } from "./push-provider";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("global push language grouping", () => {
  it("supports the eight app languages and falls back to English", () => {
    const languages = ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"];
    expect(new Set(languages.map(globalPushAlert)).size).toBe(8);
    expect(globalPushAlert("zh-TW")).toBe(globalPushAlert("zh-Hant")); expect(globalPushAlert("ru")).toBe(globalPushAlert("en"));
  });
  it("sends each installation only its own language using mocked transport", async () => {
    vi.stubEnv("APP_REALM", "global"); const fetch = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", fetch);
    await new JPushProvider("synthetic-app", "synthetic-secret").deliver([{ provider: "jpush", registrationId: "one", locale: "de" }, { provider: "jpush", registrationId: "two", locale: "ja" }, { provider: "jpush", registrationId: "three", locale: "de" }] as any, { eventId: "synthetic-event", type: "system" } as any);
    expect(fetch).toHaveBeenCalledTimes(2);
    const requests = fetch.mock.calls.map(call => JSON.parse((call as any)[1].body));
    expect(requests.find(item => item.notification.alert === globalPushAlert("de")).audience.registration_id).toEqual(["one", "three"]);
    expect(requests.find(item => item.notification.alert === globalPushAlert("ja")).audience.registration_id).toEqual(["two"]);
  });
});
