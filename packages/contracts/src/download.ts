export const downloadPlatforms = ["android", "ios", "harmonyos"] as const;
export type DownloadPlatform = (typeof downloadPlatforms)[number];
export type DownloadReleaseStatus = "available" | "coming_soon";
export type DownloadDestinationKind = "direct" | "testflight" | "app_store";

export interface DownloadDestinationContract {
  kind: DownloadDestinationKind;
  url: string;
  fileName?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface DownloadReleaseContract {
  platform: DownloadPlatform;
  versionName: string;
  buildNumber: number;
  status: DownloadReleaseStatus;
  destination?: DownloadDestinationContract;
}

export interface DownloadManifestContract {
  schemaVersion: 1;
  audience: "internal_test";
  publishedAt: string;
  releases: DownloadReleaseContract[];
}

const directExtensions: Record<Exclude<DownloadPlatform, "ios">, string> = {
  android: ".apk",
  harmonyos: ".hap",
};

export function parseDownloadManifest(
  input: unknown,
): DownloadManifestContract {
  const source = recordValue(input, "下载配置必须是 JSON 对象");
  if (source.schemaVersion !== 1)
    throw new Error("下载配置 schemaVersion 必须为 1");
  if (source.audience !== "internal_test")
    throw new Error("下载配置必须标记为内部测试版");
  const publishedAt = requiredString(source.publishedAt, "publishedAt", 64);
  if (!Number.isFinite(Date.parse(publishedAt)))
    throw new Error("publishedAt 必须是有效时间");
  if (
    !Array.isArray(source.releases) ||
    source.releases.length !== downloadPlatforms.length
  ) {
    throw new Error("下载配置必须同时包含 Android、iPhone 和 HarmonyOS");
  }
  const releases = source.releases.map(parseDownloadRelease);
  for (const platform of downloadPlatforms) {
    if (
      releases.filter((release) => release.platform === platform).length !== 1
    ) {
      throw new Error(`下载配置必须且只能包含一个 ${platform} 版本`);
    }
  }
  return { schemaVersion: 1, audience: "internal_test", publishedAt, releases };
}

function parseDownloadRelease(input: unknown): DownloadReleaseContract {
  const source = recordValue(input, "版本配置必须是 JSON 对象");
  const platform = requiredString(source.platform, "platform", 20);
  if (!(downloadPlatforms as readonly string[]).includes(platform))
    throw new Error("下载平台不受支持");
  const typedPlatform = platform as DownloadPlatform;
  const versionName = requiredString(
    source.versionName,
    `${platform}.versionName`,
    32,
  );
  const buildNumber = source.buildNumber;
  if (!Number.isInteger(buildNumber) || Number(buildNumber) <= 0) {
    throw new Error(`${platform}.buildNumber 必须是正整数`);
  }
  const status = source.status;
  if (status !== "available" && status !== "coming_soon")
    throw new Error(`${platform}.status 无效`);
  if (status === "coming_soon") {
    if (source.destination !== undefined && source.destination !== null) {
      throw new Error(`${platform} 待开放时不得配置下载地址`);
    }
    return {
      platform: typedPlatform,
      versionName,
      buildNumber: Number(buildNumber),
      status,
    };
  }
  const destination = parseDownloadDestination(
    typedPlatform,
    source.destination,
  );
  return {
    platform: typedPlatform,
    versionName,
    buildNumber: Number(buildNumber),
    status,
    destination,
  };
}

function parseDownloadDestination(
  platform: DownloadPlatform,
  input: unknown,
): DownloadDestinationContract {
  const source = recordValue(input, `${platform}.destination 必须是 JSON 对象`);
  const kind = requiredString(
    source.kind,
    `${platform}.destination.kind`,
    20,
  ) as DownloadDestinationKind;
  const url = requiredString(source.url, `${platform}.destination.url`, 500);
  if (platform === "ios") {
    if (kind !== "testflight" && kind !== "app_store")
      throw new Error("iPhone 只允许 TestFlight 或 App Store 地址");
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new Error("iPhone 下载地址无效");
    }
    const expectedHost =
      kind === "testflight" ? "testflight.apple.com" : "apps.apple.com";
    if (target.protocol !== "https:" || target.hostname !== expectedHost) {
      throw new Error(
        `iPhone ${kind === "testflight" ? "TestFlight" : "App Store"} 地址不受信任`,
      );
    }
    return { kind, url: target.toString() };
  }
  if (kind !== "direct") throw new Error(`${platform} 只允许直接下载`);
  const fileName = requiredString(
    source.fileName,
    `${platform}.destination.fileName`,
    160,
  );
  const expectedExtension = directExtensions[platform];
  if (
    !/^[A-Za-z0-9._-]+$/.test(fileName) ||
    !fileName.toLowerCase().endsWith(expectedExtension)
  ) {
    throw new Error(`${platform} 安装包文件名无效`);
  }
  if (url !== `/down/files/${fileName}`)
    throw new Error(`${platform} 下载地址必须与文件名一致`);
  const sizeBytes = source.sizeBytes;
  if (!Number.isInteger(sizeBytes) || Number(sizeBytes) <= 0)
    throw new Error(`${platform}.sizeBytes 必须是正整数`);
  const sha256 = requiredString(
    source.sha256,
    `${platform}.destination.sha256`,
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new Error(`${platform}.sha256 无效`);
  return { kind, url, fileName, sizeBytes: Number(sizeBytes), sha256 };
}

function recordValue(input: unknown, message: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(message);
  return input as Record<string, unknown>;
}

function requiredString(
  input: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof input !== "string") throw new Error(`${field} 必须是字符串`);
  const value = input.trim();
  if (!value || value.length > maxLength) throw new Error(`${field} 长度无效`);
  return value;
}
