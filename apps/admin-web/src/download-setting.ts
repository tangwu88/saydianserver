import {
  downloadPlatforms,
  parseDownloadManifest,
  type DownloadDestinationKind,
  type DownloadManifestContract,
  type DownloadPlatform,
  type DownloadReleaseStatus,
} from "@saydian/app-contracts/download";

export interface DownloadReleaseEditor {
  platform: DownloadPlatform;
  versionName: string;
  buildNumber: number;
  status: DownloadReleaseStatus;
  destinationKind: DownloadDestinationKind;
  url: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface DownloadManifestEditor {
  publishedAt: string;
  releases: Record<DownloadPlatform, DownloadReleaseEditor>;
}

export function downloadManifestToEditor(
  input: unknown,
): DownloadManifestEditor {
  const manifest = parseDownloadManifest(input);
  const releases = Object.fromEntries(
    manifest.releases.map((release) => [
      release.platform,
      {
        platform: release.platform,
        versionName: release.versionName,
        buildNumber: release.buildNumber,
        status: release.status,
        destinationKind:
          release.destination?.kind ??
          (release.platform === "ios" ? "testflight" : "direct"),
        url: release.destination?.url ?? "",
        fileName: release.destination?.fileName ?? "",
        sizeBytes: release.destination?.sizeBytes ?? 0,
        sha256: release.destination?.sha256 ?? "",
      } satisfies DownloadReleaseEditor,
    ]),
  ) as Record<DownloadPlatform, DownloadReleaseEditor>;
  return { publishedAt: manifest.publishedAt, releases };
}

export function downloadEditorToManifest(
  editor: DownloadManifestEditor,
): DownloadManifestContract {
  const releases = downloadPlatforms.map((platform) => {
    const release = editor.releases[platform];
    const base = {
      platform,
      versionName: release.versionName,
      buildNumber: Number(release.buildNumber),
      status: release.status,
    };
    if (release.status === "coming_soon") return base;
    if (platform === "ios") {
      return {
        ...base,
        destination: {
          kind: release.destinationKind,
          url: release.url,
        },
      };
    }
    return {
      ...base,
      destination: {
        kind: "direct" as const,
        url: release.url,
        fileName: release.fileName,
        sizeBytes: Number(release.sizeBytes),
        sha256: release.sha256,
      },
    };
  });
  return parseDownloadManifest({
    schemaVersion: 1,
    audience: "internal_test",
    publishedAt: editor.publishedAt,
    releases,
  });
}
