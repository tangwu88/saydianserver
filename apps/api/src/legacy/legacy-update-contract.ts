import { BadRequestException } from "@nestjs/common";
import { safeObject } from "../common/crypto";

export interface LegacyAppRelease {
  platform: "android" | "ios";
  version: number;
  version_code: string;
  lowwer: number;
  force: 0 | 1;
  status: 0 | 1;
  android_type?: 0 | 1;
  android?: string;
  ios?: string;
  sha256?: string;
  title?: string;
  description?: string;
}

export interface LegacyAppUpdate {
  schemaVersion: 1;
  audience: "production";
  releases: LegacyAppRelease[];
}

/** The production updater is intentionally separate from the QA download manifest. */
export function parseLegacyAppUpdate(input: unknown): LegacyAppUpdate {
  const body = safeObject(input);
  if (body.schemaVersion !== 1 || body.audience !== "production" || !Array.isArray(body.releases)) {
    throw new BadRequestException("正式更新配置需要 schemaVersion=1、audience=production 和 releases 数组");
  }
  if (body.releases.length > 2) throw new BadRequestException("每个平台只能保留一个当前更新版本");
  const platforms = new Set<string>();
  const releases = body.releases.map((inputRelease): LegacyAppRelease => {
    const release = safeObject(inputRelease);
    const platform = String(release.platform ?? "").trim();
    if ((platform !== "android" && platform !== "ios") || platforms.has(platform)) {
      throw new BadRequestException("更新平台无效或重复");
    }
    platforms.add(platform);
    const version = integer(release.version, 1, 2_147_483_647, "版本构建号");
    const versionCode = String(release.version_code ?? "").trim();
    if (!versionCode || versionCode.length > 32) throw new BadRequestException("版本名称必须为1至32字");
    const result: LegacyAppRelease = {
      platform,
      version,
      version_code: versionCode,
      lowwer: integer(release.lowwer ?? 0, 0, version, "最低支持构建号"),
      force: flag(release.force ?? 0, "强制更新"),
      status: flag(release.status ?? 1, "发布状态"),
    };
    for (const key of ["title", "description"] as const) {
      const value = String(release[key] ?? "").trim();
      if (value.length > (key === "title" ? 200 : 10000)) throw new BadRequestException("更新说明过长");
      if (value) result[key] = value;
    }
    if (platform === "android") {
      result.android_type = flag(release.android_type ?? 1, "Android 更新方式");
      if (release.android || result.status === 1) result.android = downloadUrl(release.android, platform);
      const hash = String(release.sha256 ?? "").trim().toLowerCase();
      if (hash && !/^[a-f0-9]{64}$/.test(hash)) throw new BadRequestException("Android 安装包 SHA-256 无效");
      if (result.status === 1 && result.android_type === 1 && !hash) {
        throw new BadRequestException("Android 安装包必须配置 SHA-256");
      }
      if (hash) result.sha256 = hash;
    } else if (release.ios || result.status === 1) {
      result.ios = downloadUrl(release.ios, platform);
    }
    return result;
  });
  return { schemaVersion: 1, audience: "production", releases };
}

export function selectLegacyAppUpdate(config: LegacyAppUpdate, platformInput: unknown, buildInput: unknown) {
  const platform = String(platformInput ?? "").trim().toLowerCase();
  if (platform !== "android" && platform !== "ios") throw new BadRequestException("更新平台必须为 android 或 ios");
  const currentBuild = integer(buildInput ?? 0, 0, 2_147_483_647, "当前构建号");
  const release = config.releases.find((row) => row.platform === platform && row.status === 1);
  return release && release.version > currentBuild ? release : null;
}

function integer(input: unknown, min: number, max: number, label: string) {
  if (input === null || typeof input === "boolean" || String(input).trim() === "") throw new BadRequestException(`${label}无效`);
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new BadRequestException(`${label}无效`);
  return value;
}

function flag(value: unknown, label: string): 0 | 1 {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;
  throw new BadRequestException(`${label}必须为0或1`);
}

function downloadUrl(input: unknown, platform: "android" | "ios") {
  const value = String(input ?? "").trim();
  if (platform === "android" && /^\/(?!\/)[A-Za-z0-9/_.,%+-]+$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new BadRequestException("更新下载地址无效"); }
  if (url.protocol !== "https:" || url.username || url.password || (platform === "ios" && url.hostname !== "apps.apple.com")) {
    throw new BadRequestException("更新下载地址必须为可信的 HTTPS 地址，iOS 必须使用 App Store");
  }
  return url.toString();
}
