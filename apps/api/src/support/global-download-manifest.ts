import { parseDownloadManifest } from "@saydian/app-contracts";
import { safeObject } from "../common/crypto";

export type GlobalDownloadProduct =
  "saydian-global" | "say-ring" | "saydian-app-cn";

const packageIdsByProduct: Record<
  GlobalDownloadProduct,
  Record<string, string>
> = {
  "saydian-global": {
    android: "cn.saydian.app.global",
    ios: "cn.saydian.app.global",
    harmonyos: "cn.saydian.app.global.hm",
  },
  "saydian-app-cn": {
    android: "cc.saidian.app",
    ios: "",
    harmonyos: "cc.saidian.app.hm",
  },
  "say-ring": {
    android: "cn.saydian.ring",
    ios: "cn.saydian.ring",
    harmonyos: "cn.saydian.ring.hm",
  },
};

/** Metadata must be explicitly published for the independent application; never add identity to domestic metadata. */
export function parseGlobalDownloadManifest(
  input: unknown,
  product: GlobalDownloadProduct = "saydian-global",
) {
  const body = safeObject(input);
  if (body.realm !== "global" || !Array.isArray(body.releases))
    throw new Error("A global release manifest is required.");
  if (product === "saydian-app-cn" && body.product !== product)
    throw new Error("The Chinese app product identity is required.");
  const packageIds = packageIdsByProduct[product];
  const publishedReleases = body.releases;
  const releases = publishedReleases.map((value) => {
    const release = safeObject(value);
    const platform = String(release.platform ?? "");
    if (
      product === "saydian-app-cn" &&
      platform !== "android" &&
      (release.status !== "coming_soon" || release.destination)
    )
      throw new Error("Only Android is published for the Chinese app.");
    if (!(platform in packageIds) || release.packageId !== packageIds[platform])
      throw new Error(
        "The release package identity does not match the global application.",
      );
    const destination = safeObject(release.destination);
    if (
      product === "saydian-app-cn" &&
      destination.kind === "direct" &&
      !String(destination.url ?? "")
        .split("/")
        .pop()
        ?.startsWith("saydian-app-cn-")
    )
      throw new Error("The package must belong to the Chinese app.");
    if (destination.kind !== "direct") return release;
    const path = String(destination.url ?? "");
    if (
      !path.startsWith("/global/down/files/") &&
      !path.startsWith("/global/api/saydian-app/v2/support/app-package/")
    ) {
      throw new Error("The global package path is required.");
    }
    return {
      ...release,
      destination: { ...destination, url: path.slice("/global".length) },
    };
  });
  const manifest = parseDownloadManifest({ ...body, releases });
  return {
    ...manifest,
    ...(product === "saydian-app-cn" ? { product } : {}),
    realm: "global" as const,
    releases: manifest.releases.map((release, index) => ({
      ...release,
      packageId: String(safeObject(publishedReleases[index]).packageId),
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
