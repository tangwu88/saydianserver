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
  product: "health" | "ring",
): DownloadManifestContract {
  const candidate = manifestSource(data);
  const packageId =
    product === "health" ? "cn.saydian.app.global" : "cn.saydian.ring";
  if (
    !isRecord(candidate) ||
    candidate.realm !== "global" ||
    !Array.isArray(candidate.releases) ||
    candidate.releases.some(
      (release) =>
        !isRecord(release) ||
        release.packageId !==
          `${packageId}${release.platform === "harmonyos" ? ".hm" : ""}` ||
        (isRecord(release.destination) &&
          release.destination.kind === "direct" &&
          !String(release.destination.url).startsWith("/global/")),
    )
  ) {
    throw new Error(
      `${product === "health" ? "SAYDIAN Health" : "Say Ring"} 下载信息无效`,
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
