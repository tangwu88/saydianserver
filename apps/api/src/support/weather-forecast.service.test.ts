import { afterEach, describe, expect, it, vi } from "vitest";
import { WeatherForecastService } from "./weather-forecast.service";

const body = {
  properties: {
    meta: { updated_at: "2026-10-03T09:00:00Z" },
    timeseries: [{ time: "2026-10-03T10:00:00Z", data: {} }],
  },
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("public weather forecast", () => {
  it("uses an identified fixed provider and coarse grid, then honors cache expiration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T10:00:00Z"));
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(body), {
        headers: {
          Expires: "Sat, 03 Oct 2026 10:30:00 GMT",
          "Last-Modified": "Sat, 03 Oct 2026 09:00:00 GMT",
        },
      }),
    );
    const service = new WeatherForecastService();
    const first = await service.forecast("39.904123", "116.403987");
    expect(first).toMatchObject({
      source: "MET Norway",
      timeseries: body.properties.timeseries,
    });
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=39.90&lon=116.40",
    );
    expect(options).toMatchObject({
      redirect: "error",
      headers: { "User-Agent": expect.stringContaining("SAYDIANHealth/") },
    });
    expect(await service.forecast("39.9041", "116.4039")).toBe(first);
    expect(fetcher).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date("2026-10-03T10:31:00Z"));
    fetcher.mockResolvedValueOnce(
      new Response(null, {
        status: 304,
        headers: { Expires: "Sat, 03 Oct 2026 11:00:00 GMT" },
      }),
    );
    expect(await service.forecast("39.9041", "116.4039")).toBe(first);
    expect(fetcher.mock.calls[1]![1]?.headers).toMatchObject({
      "If-Modified-Since": "Sat, 03 Oct 2026 09:00:00 GMT",
    });
  });

  it.each([
    [undefined, "1"],
    ["", "1"],
    ["NaN", "1"],
    ["91", "1"],
    ["1", "181"],
  ])("rejects invalid coordinates before network access", async (lat, lon) => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    await expect(
      new WeatherForecastService().forecast(lat, lon),
    ).rejects.toThrow("天气位置无效");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    new Response("{}", { status: 429 }),
    new Response("{}"),
    new Response("invalid"),
  ])(
    "does not manufacture weather on a bad provider response",
    async (response) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
      await expect(
        new WeatherForecastService().forecast("39.9", "116.4"),
      ).rejects.toThrow("天气数据暂时不可用");
    },
  );
});
