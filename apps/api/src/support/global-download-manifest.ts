import { parseDownloadManifest } from "@saydian/app-contracts";
import { safeObject } from "../common/crypto";

const packageIds: Record<string, string> = { android: "cn.saydian.app.global", ios: "cn.saydian.app.global", harmonyos: "cn.saydian.app.global.hm" };

/** Metadata must be explicitly published for the independent application; never add identity to domestic metadata. */
export function parseGlobalDownloadManifest(input: unknown) {
  const body = safeObject(input);
  if (body.realm !== "global" || !Array.isArray(body.releases)) throw new Error("A global release manifest is required.");
  const publishedReleases = body.releases;
  const releases = publishedReleases.map(value => {
    const release = safeObject(value);
    const platform = String(release.platform ?? "");
    if (!packageIds[platform] || release.packageId !== packageIds[platform]) throw new Error("The release package identity does not match the global application.");
    const destination = safeObject(release.destination);
    if (destination.kind !== "direct") return release;
    const path = String(destination.url ?? "");
    if (!path.startsWith("/global/down/files/")) throw new Error("The global package path is required.");
    return { ...release, destination: { ...destination, url: path.slice("/global".length) } };
  });
  const manifest = parseDownloadManifest({ ...body, releases });
  return { ...manifest, realm: "global" as const, releases: manifest.releases.map((release, index) => ({
    ...release, packageId: String(safeObject(publishedReleases[index]).packageId),
    ...(release.destination?.kind === "direct" ? { destination: { ...release.destination, url: `/global${release.destination.url}` } } : {}),
  })) };
}
