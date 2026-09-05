import type { DownloadPlatform } from "@saydian/app-contracts/download";

export type VisitorPlatform = DownloadPlatform | "desktop";

export function detectVisitorPlatform(
  userAgent: string,
  navigatorPlatform = "",
  maxTouchPoints = 0,
): VisitorPlatform {
  const ua = userAgent.toLowerCase();
  if (/harmonyos|openharmony|\bohos\b/.test(ua)) return "harmonyos";
  if (
    /iphone|ipad|ipod/.test(ua) ||
    (navigatorPlatform === "MacIntel" && maxTouchPoints > 1)
  )
    return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function formatPackageSize(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "—";
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
