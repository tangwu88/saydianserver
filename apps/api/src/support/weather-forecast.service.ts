import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

type Forecast = {
  source: string;
  sourceUrl: string;
  licenseUrl: string;
  timeseries: unknown[];
  updatedAt: string;
};
type CachedForecast = {
  data: Forecast;
  expiresAt: number;
  lastModified: string | null;
};

@Injectable()
export class WeatherForecastService {
  private readonly cache = new Map<string, CachedForecast>();

  async forecast(
    latitude: string | undefined,
    longitude: string | undefined,
  ): Promise<Forecast> {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (
      !latitude?.trim() ||
      !longitude?.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      throw new BadRequestException("天气位置无效");
    }
    // Weather uses a coarse grid, never a member/account identifier or exact GPS.
    const grid = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = this.cache.get(grid);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const url = new URL(
      "https://api.met.no/weatherapi/locationforecast/2.0/compact",
    );
    const [gridLat, gridLon] = grid.split(",");
    url.searchParams.set("lat", gridLat!);
    url.searchParams.set("lon", gridLon!);
    const headers: Record<string, string> = {
      "User-Agent":
        "SAYDIANHealth/1.0 https://app.saydian.cn/global/health/support",
      ...(cached?.lastModified
        ? { "If-Modified-Since": cached.lastModified }
        : {}),
    };
    try {
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      let data: Forecast;
      if (response.status === 304 && cached) {
        data = cached.data;
      } else {
        if (!response.ok) throw new Error("Weather provider unavailable");
        const body = (await response.json()) as {
          properties?: {
            meta?: { updated_at?: string };
            timeseries?: unknown[];
          };
        };
        const properties = body.properties;
        if (
          !Array.isArray(properties?.timeseries) ||
          !properties.timeseries.length ||
          !properties.meta?.updated_at ||
          !Number.isFinite(Date.parse(properties.meta.updated_at))
        ) {
          throw new Error("Invalid weather forecast");
        }
        data = {
          source: "MET Norway",
          sourceUrl: "https://api.met.no/",
          licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
          updatedAt: properties.meta.updated_at,
          timeseries: properties.timeseries,
        };
      }
      const expiresAt = Date.parse(response.headers.get("Expires") ?? "");
      if (this.cache.size >= 256 && !this.cache.has(grid))
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(grid, {
        data,
        expiresAt:
          Number.isFinite(expiresAt) && expiresAt > Date.now()
            ? expiresAt
            : Date.now() + 15 * 60_000,
        lastModified:
          response.headers.get("Last-Modified") ?? cached?.lastModified ?? null,
      });
      return data;
    } catch {
      throw new ServiceUnavailableException("天气数据暂时不可用，请稍后重试");
    }
  }
}
