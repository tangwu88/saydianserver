import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";
import { parseSportRoute, renderAmapSportRoute } from "./sport-route-map";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Say Ring AMap route boundary", () => {
  it("rejects malformed coordinates before a provider call", () => {
    expect(() => parseSportRoute({ points: [{ latitude: 31, longitude: 121 }] })).toThrow();
    expect(() => parseSportRoute({ points: [
      { latitude: 31, longitude: 121 }, { latitude: 999, longitude: 121 },
    ] })).toThrow();
  });

  it("keeps the key private and fails closed until the map is published", async () => {
    vi.stubEnv("APP_REALM", "global");
    const findFirst = vi.fn().mockResolvedValue(null);
    const resolve = vi.fn().mockResolvedValue({ webServiceKey: "a".repeat(32) });
    const service = new SupportService({ appSetting: { findFirst } } as any, { resolve } as any);
    expect(await service.sportMapConfig()).toEqual({ provider: "amap", configured: false });
    await expect(service.sportRouteMap({ points: [
      { latitude: 31, longitude: 121 }, { latitude: 31.001, longitude: 121.001 },
    ] })).rejects.toThrow("尚未配置");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("converts GPS coordinates before requesting the static route image", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      calls.push(url.toString());
      return url.pathname.includes("convert")
        ? { ok: true, json: async () => ({ status: "1", locations: "121.001,31.001;121.002,31.002" }) }
        : { ok: true, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer };
    }));
    const image = await renderAmapSportRoute([
      { latitude: 31, longitude: 121 }, { latitude: 31.001, longitude: 121.001 },
    ], "a".repeat(32));
    expect(image.contentType).toBe("image/png");
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]!).searchParams.get("coordsys")).toBe("gps");
    expect(new URL(calls[1]!).searchParams.get("paths")).toContain("121.002,31.002");
  });
});
