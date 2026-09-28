import {
  downloadPlatforms,
  type DownloadManifestContract,
} from "@saydian/app-contracts/download";
import {
  downloadEditorToManifest,
  downloadManifestFromPublicData as parseDownloadManifestFromPublicData,
  downloadManifestToEditor,
  type DownloadManifestEditor,
} from "./download-setting";

export type { DownloadManifestEditor } from "./download-setting";

const globalPackageIds = {
  android: "cn.saydian.app.global",
  ios: "cn.saydian.app.global",
  harmonyos: "cn.saydian.app.global.hm",
} as const;
const sayRingPackageIds = {
  android: "cn.saydian.ring",
  ios: "cn.saydian.ring",
  harmonyos: "cn.saydian.ring.hm",
} as const;
type PackageIds = Record<(typeof downloadPlatforms)[number], string>;

export function createGlobalDownloadDraft(): DownloadManifestEditor {
  return {
    publishedAt: "",
    releases: Object.fromEntries(
      downloadPlatforms.map((platform) => [
        platform,
        {
          platform,
          versionName: "",
          buildNumber: undefined,
          status: "coming_soon",
          destinationKind: platform === "ios" ? "testflight" : "direct",
          url: "",
          fileName: "",
          sizeBytes: 0,
          sha256: "",
        },
      ]),
    ) as DownloadManifestEditor["releases"],
  };
}

function domesticValidationPath(url: string): string {
  if (
    !url.startsWith("/global/down/files/") &&
    !url.startsWith("/global/api/saydian-app/v2/support/app-package/")
  ) {
    throw new Error("国际版下载地址必须使用后台生成的同源地址");
  }
  return url.slice("/global".length);
}

function withGlobalIdentity(
  manifest: DownloadManifestContract,
  packageIds: PackageIds,
) {
  return {
    ...manifest,
    realm: "global" as const,
    releases: manifest.releases.map((release) => ({
      ...release,
      packageId: packageIds[release.platform],
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

function downloadManifestFromPublicData(
  input: unknown,
  packageIds: PackageIds,
) {
  const wrapper = input as Record<string, unknown> | null;
  const candidate =
    wrapper && typeof wrapper === "object" && "value" in wrapper
      ? wrapper.value
      : input;
  if (!candidate || typeof candidate !== "object")
    throw new Error("国际版下载配置必须是 JSON 对象");
  const body = candidate as Record<string, unknown>;
  if (body.realm !== "global" || !Array.isArray(body.releases))
    throw new Error("请使用明确标记国际版的下载配置");
  const releases = body.releases.map((inputRelease: unknown) => {
    const release = inputRelease as Record<string, any> | null;
    if (
      !release ||
      !downloadPlatforms.includes(release.platform) ||
      release.packageId !==
        packageIds[release.platform as keyof typeof packageIds]
    ) {
      throw new Error("安装包标识与国际版 App 不一致");
    }
    return release.destination?.kind === "direct"
      ? {
          ...release,
          destination: {
            ...release.destination,
            url: domesticValidationPath(String(release.destination.url ?? "")),
          },
        }
      : release;
  });
  return withGlobalIdentity(
    parseDownloadManifestFromPublicData({ ...body, releases }),
    packageIds,
  );
}

function manifestToEditor(
  input: unknown,
  packageIds: PackageIds,
): DownloadManifestEditor {
  const manifest = downloadManifestFromPublicData(input, packageIds);
  const editor = downloadManifestToEditor({
    ...manifest,
    releases: manifest.releases.map((release) => ({
      ...release,
      ...(release.destination?.kind === "direct"
        ? {
            destination: {
              ...release.destination,
              url: domesticValidationPath(release.destination.url),
            },
          }
        : {}),
    })),
  });
  for (const platform of downloadPlatforms) {
    if (
      editor.releases[platform].destinationKind === "direct" &&
      editor.releases[platform].url
    )
      editor.releases[platform].url = `/global${editor.releases[platform].url}`;
  }
  return editor;
}

function editorToManifest(
  editor: DownloadManifestEditor,
  packageIds: PackageIds,
) {
  const releases = Object.fromEntries(
    downloadPlatforms.map((platform) => {
      const release = editor.releases[platform];
      return [
        platform,
        {
          ...release,
          ...(platform !== "ios" &&
          release.status === "available" &&
          release.destinationKind === "direct"
            ? { url: domesticValidationPath(release.url) }
            : {}),
        },
      ];
    }),
  ) as DownloadManifestEditor["releases"];
  return withGlobalIdentity(
    downloadEditorToManifest({ ...editor, releases }),
    packageIds,
  );
}

export function globalDownloadManifestFromPublicData(input: unknown) {
  return downloadManifestFromPublicData(input, globalPackageIds);
}

export function globalDownloadManifestToEditor(
  input: unknown,
): DownloadManifestEditor {
  return manifestToEditor(input, globalPackageIds);
}

export function globalDownloadEditorToManifest(editor: DownloadManifestEditor) {
  return editorToManifest(editor, globalPackageIds);
}

export const createSayRingDownloadDraft = createGlobalDownloadDraft;

export function sayRingDownloadManifestFromPublicData(input: unknown) {
  return downloadManifestFromPublicData(input, sayRingPackageIds);
}

export function sayRingDownloadManifestToEditor(
  input: unknown,
): DownloadManifestEditor {
  return manifestToEditor(input, sayRingPackageIds);
}

export function sayRingDownloadEditorToManifest(
  editor: DownloadManifestEditor,
) {
  const android = editor.releases.android;
  const harmonyos = editor.releases.harmonyos;
  const normalized =
    harmonyos.status === "coming_soon" &&
    !harmonyos.versionName.trim() &&
    harmonyos.buildNumber == null
      ? {
          ...editor,
          releases: {
            ...editor.releases,
            harmonyos: {
              ...harmonyos,
              versionName: android.versionName,
              buildNumber: android.buildNumber,
            },
          },
        }
      : editor;
  return editorToManifest(normalized, sayRingPackageIds);
}
