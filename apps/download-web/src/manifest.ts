import {
  parseDownloadManifest,
  type DownloadManifestContract,
} from "@saydian/app-contracts/download";

export function manifestFromApiData(data: unknown): DownloadManifestContract {
  const candidate = isRecord(data) && "value" in data ? data.value : data;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
