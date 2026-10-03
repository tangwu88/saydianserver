import {
  parseDownloadManifest,
  type DownloadManifestContract,
} from "@saydian/app-contracts/download";

export function manifestFromApiData(data: unknown): DownloadManifestContract {
  const candidate = manifestSource(data);
  if (
    isRecord(candidate) &&
    candidate.realm === "global" &&
    Array.isArray(candidate.releases)
  ) {
    const normalized = {
      ...candidate,
      releases: candidate.releases.map((release) => {
        if (
          !isRecord(release) ||
          !isRecord(release.destination) ||
          release.destination.kind !== "direct"
        )
          return release;
        const url = String(release.destination.url ?? "");
        return {
          ...release,
          destination: {
            ...release.destination,
            url: url.startsWith("/global/") ? url.slice("/global".length) : url,
          },
        };
      }),
    };
    const parsed = parseDownloadManifest(normalized);
    return {
      ...parsed,
      releases: parsed.releases.map((release) => ({
        ...release,
        ...(release.destination?.kind === "direct"
          ? {
              destination: {
                ...release.destination,
                url: `/global${release.destination.url}`,
              },
            }
          : {}),
      })),
    };
  }
  return parseDownloadManifest(candidate);
}

export function healthAndroidManifestFromApiData(
  data: unknown,
): DownloadManifestContract {
  const candidate = manifestSource(data);
  const android =
    isRecord(candidate) && Array.isArray(candidate.releases)
      ? candidate.releases.find(
          (release) => isRecord(release) && release.platform === "android",
        )
      : undefined;
  if (
    !isRecord(candidate) ||
    candidate.realm !== "global" ||
    !isRecord(android) ||
    android.packageId !== "cn.saydian.app.global"
  ) {
    throw new Error("Saydian Health 安卓下载信息无效");
  }
  return manifestFromApiData(data);
}

function manifestSource(data: unknown): unknown {
  return isRecord(data) && "value" in data ? data.value : data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
