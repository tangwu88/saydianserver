import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { safeObject } from "../common/crypto";

type Coordinate = { latitude: number; longitude: number };

export function parseSportRoute(input: unknown): Coordinate[] {
  const raw = safeObject(input).points;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 80) {
    throw new BadRequestException("运动轨迹需包含 2 至 80 个定位点");
  }
  return raw.map((item) => {
    const point = safeObject(item);
    const latitude = Number(point.latitude);
    const longitude = Number(point.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
        (latitude === 0 && longitude === 0)) {
      throw new BadRequestException("运动轨迹包含无效坐标");
    }
    return { latitude, longitude };
  });
}

function pair(point: Coordinate): string {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}

async function convertedCoordinates(points: Coordinate[], key: string): Promise<string[]> {
  const converted: string[] = [];
  for (let start = 0; start < points.length; start += 40) {
    const batch = points.slice(start, start + 40);
    const url = new URL("https://restapi.amap.com/v3/assistant/coordinate/convert");
    url.searchParams.set("key", key);
    url.searchParams.set("coordsys", "gps");
    url.searchParams.set("locations", batch.map(pair).join("|"));
    let data: Record<string, unknown>;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("provider unavailable");
      data = await response.json() as Record<string, unknown>;
    } catch {
      throw new ServiceUnavailableException("地图坐标转换暂时不可用");
    }
    const result = String(data.locations ?? "").split(";");
    if (String(data.status) !== "1" || result.length !== batch.length ||
        result.some((value) => !/^[-\d.]+,[-\d.]+$/.test(value))) {
      throw new ServiceUnavailableException("地图坐标转换暂时不可用");
    }
    converted.push(...result);
  }
  return converted;
}

export async function renderAmapSportRoute(
  points: Coordinate[], webServiceKey: string,
): Promise<{ body: Buffer; contentType: string }> {
  const converted = await convertedCoordinates(points, webServiceKey);
  const longitude = converted.map((value) => Number(value.split(",")[0]));
  const latitude = converted.map((value) => Number(value.split(",")[1]));
  const span = Math.max(
    Math.max(...longitude) - Math.min(...longitude),
    Math.max(...latitude) - Math.min(...latitude),
    0.0001,
  );
  const zoom = Math.max(5, Math.min(17, Math.floor(14 + Math.log2(0.02 / span))));
  const url = new URL("https://restapi.amap.com/v3/staticmap");
  url.searchParams.set("key", webServiceKey);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", "720*320");
  url.searchParams.set("paths", `5,0x316EF5,1,,:${converted.join(";")}`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!response.ok || !["image/png", "image/jpeg"].includes(contentType)) {
      throw new Error("provider unavailable");
    }
    const size = Number(response.headers.get("content-length") ?? 0);
    if (size > 2 * 1024 * 1024) throw new Error("provider image too large");
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length || body.length > 2 * 1024 * 1024) throw new Error("provider image invalid");
    return { body, contentType };
  } catch {
    throw new ServiceUnavailableException("运动地图暂时不可用");
  }
}
