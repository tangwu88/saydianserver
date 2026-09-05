import {
  parseDownloadManifest,
  type DownloadManifestContract,
} from "@saydian/app-contracts/download";

export function manifestFromApiData(data: unknown): DownloadManifestContract {
  const candidate = isRecord(data) && "value" in data ? data.value : data;
  return parseDownloadManifest(candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
