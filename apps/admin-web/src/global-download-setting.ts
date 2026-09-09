import { downloadPlatforms, type DownloadManifestContract } from "@saydian/app-contracts/download";
import { downloadEditorToManifest, downloadManifestFromPublicData, downloadManifestToEditor, type DownloadManifestEditor } from "./download-setting";

export type { DownloadManifestEditor } from "./download-setting";

const packageIds = { android: "cn.saydian.app.global", ios: "cn.saydian.app.global", harmonyos: "cn.saydian.app.global.hm" } as const;

export function createGlobalDownloadDraft(): DownloadManifestEditor {
  return {
    publishedAt: "",
    releases: Object.fromEntries(downloadPlatforms.map(platform => [platform, {
      platform, versionName: "", buildNumber: undefined, status: "coming_soon",
      destinationKind: platform === "ios" ? "testflight" : "direct",
      url: "", fileName: "", sizeBytes: 0, sha256: "",
    }])) as DownloadManifestEditor["releases"],
  };
}

function domesticValidationPath(url: string): string {
  if (!url.startsWith("/global/down/files/")) throw new Error("国际版下载地址必须使用 /global/down/files/");
  return url.slice("/global".length);
}

function withGlobalIdentity(manifest: DownloadManifestContract) {
  return {
    ...manifest,
    realm: "global" as const,
    releases: manifest.releases.map(release => ({
      ...release,
      packageId: packageIds[release.platform],
      ...(release.destination?.kind === "direct" ? { destination: { ...release.destination, url: `/global${release.destination.url}` } } : {}),
    })),
  };
}

export function globalDownloadManifestFromPublicData(input: unknown) {
  const wrapper = input as Record<string, unknown> | null;
  const candidate = wrapper && typeof wrapper === "object" && "value" in wrapper ? wrapper.value : input;
  if (!candidate || typeof candidate !== "object") throw new Error("国际版下载配置必须是 JSON 对象");
  const body = candidate as Record<string, unknown>;
  if (body.realm !== "global" || !Array.isArray(body.releases)) throw new Error("请使用明确标记国际版的下载配置");
  const releases = body.releases.map((inputRelease: unknown) => {
    const release = inputRelease as Record<string, any> | null;
    if (!release || !downloadPlatforms.includes(release.platform) || release.packageId !== packageIds[release.platform as keyof typeof packageIds]) {
      throw new Error("安装包标识与国际版 App 不一致");
    }
    return release.destination?.kind === "direct"
      ? { ...release, destination: { ...release.destination, url: domesticValidationPath(String(release.destination.url ?? "")) } }
      : release;
  });
  return withGlobalIdentity(downloadManifestFromPublicData({ ...body, releases }));
}

export function globalDownloadManifestToEditor(input: unknown): DownloadManifestEditor {
  const manifest = globalDownloadManifestFromPublicData(input);
  const editor = downloadManifestToEditor({
    ...manifest,
    releases: manifest.releases.map(release => ({
      ...release,
      ...(release.destination?.kind === "direct" ? { destination: { ...release.destination, url: domesticValidationPath(release.destination.url) } } : {}),
    })),
  });
  for (const platform of downloadPlatforms) {
    if (editor.releases[platform].destinationKind === "direct" && editor.releases[platform].url) editor.releases[platform].url = `/global${editor.releases[platform].url}`;
  }
  return editor;
}

export function globalDownloadEditorToManifest(editor: DownloadManifestEditor) {
  const releases = Object.fromEntries(downloadPlatforms.map(platform => {
    const release = editor.releases[platform];
    return [platform, {
      ...release,
      ...(platform !== "ios" && release.status === "available" ? { url: domesticValidationPath(release.url) } : {}),
    }];
  })) as DownloadManifestEditor["releases"];
  return withGlobalIdentity(downloadEditorToManifest({ ...editor, releases }));
}
