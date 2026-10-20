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

export function productManifestFromApiData(
  data: unknown,
  product: "health" | "ring" | "cn",
): DownloadManifestContract {
  const candidate = manifestSource(data);
  const packageId = product === "cn" ? "cc.saidian.app" :
    product === "health" ? "cn.saydian.app.global" : "cn.saydian.ring";
  if (
    !isRecord(candidate) ||
    candidate.realm !== "global" ||
    (product === "cn" && candidate.product !== "saydian-app-cn") ||
    !Array.isArray(candidate.releases) ||
    candidate.releases.some(
      (release) =>
        !isRecord(release) ||
        release.packageId !== (product === "cn" && release.platform === "ios" ? "" :
          `${packageId}${release.platform === "harmonyos" ? ".hm" : ""}`) ||
        (product === "cn" && release.platform !== "android" &&
          (release.status !== "coming_soon" || release.destination)) ||
        (product === "cn" && isRecord(release.destination) &&
          release.destination.kind === "direct" &&
          !String(release.destination.fileName).startsWith("saydian-app-cn-")) ||
        (isRecord(release.destination) &&
          release.destination.kind === "direct" &&
          !String(release.destination.url).startsWith("/global/")),
    )
  ) {
    throw new Error(
      `${product === "cn" ? "赛电中文" : product === "health" ? "赛电国际" : "赛电戒指"} 下载信息无效`,
    );
  }
  return manifestFromApiData(data);
}

function manifestSource(data: unknown): unknown {
  return isRecord(data) && "value" in data ? data.value : data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
