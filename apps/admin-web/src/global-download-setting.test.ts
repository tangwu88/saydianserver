import { describe, expect, it } from "vitest";
import { createGlobalDownloadDraft, globalDownloadEditorToManifest, globalDownloadManifestFromPublicData, globalDownloadManifestToEditor } from "./global-download-setting";

const manifest = {
  schemaVersion: 1, audience: "internal_test", realm: "global", publishedAt: "2026-09-10T00:00:00Z",
  releases: [
    { platform: "android", packageId: "cn.saydian.app.global", versionName: "0.1.0", buildNumber: 1, status: "available", destination: { kind: "direct", url: "/global/down/files/global-1.apk", fileName: "global-1.apk", sizeBytes: 12345, sha256: "a".repeat(64) } },
    { platform: "ios", packageId: "cn.saydian.app.global", versionName: "0.1.0", buildNumber: 1, status: "coming_soon" },
    { platform: "harmonyos", packageId: "cn.saydian.app.global.hm", versionName: "0.1.0", buildNumber: 1, status: "coming_soon" },
  ],
};

describe("international download settings", () => {
  it("creates separate empty drafts without invented publication or version data", () => {
    const draft = createGlobalDownloadDraft();
    expect(draft.publishedAt).toBe("");
    for (const release of Object.values(draft.releases)) {
      expect(release.status).toBe("coming_soon"); expect(release.versionName).toBe("");
      expect(release.buildNumber).toBeUndefined(); expect(release.url).toBe("");
    }
    expect(() => globalDownloadEditorToManifest(draft)).toThrow();
    draft.releases.android.versionName = "local-unsaved-edit";
    expect(createGlobalDownloadDraft().releases.android.versionName).toBe("");
  });
  it("retains international identity and URLs through editor roundtrips", () => {
    const parsed = globalDownloadManifestFromPublicData({ value: manifest });
    const editor = globalDownloadManifestToEditor(parsed);
    expect(editor.releases.android.url).toBe("/global/down/files/global-1.apk");
    editor.releases.android.versionName = "0.1.1";
    const saved = globalDownloadEditorToManifest(editor);
    expect(saved.realm).toBe("global"); expect(saved.releases[0]).toMatchObject({ packageId: "cn.saydian.app.global", versionName: "0.1.1", destination: { url: "/global/down/files/global-1.apk" } });
    expect(saved.releases[1]).not.toHaveProperty("destination");
    expect(saved.releases[2]?.packageId).toBe("cn.saydian.app.global.hm");
  });

  it("rejects manifests without international identity or with another package ID", () => {
    expect(() => globalDownloadManifestFromPublicData({ ...manifest, realm: undefined })).toThrow(/国际版/);
    expect(() => globalDownloadManifestFromPublicData({ ...manifest, releases: manifest.releases.map(release => ({ ...release, packageId: "cn.saydian.app" })) })).toThrow(/标识/);
  });

  it("rejects domestic paths on both read and save", () => {
    const invalid = { ...manifest, releases: manifest.releases.map(release => release.destination ? { ...release, destination: { ...release.destination, url: "/down/files/global-1.apk" } } : release) };
    expect(() => globalDownloadManifestFromPublicData(invalid)).toThrow(/国际版下载地址/);
    const editor = globalDownloadManifestToEditor(manifest); editor.releases.android.url = "/down/files/global-1.apk";
    expect(() => globalDownloadEditorToManifest(editor)).toThrow(/国际版下载地址/);
  });

  it("keeps shared filename and hash validation for international downloads", () => {
    const editor = globalDownloadManifestToEditor(manifest); editor.releases.android.fileName = "other.apk";
    expect(() => globalDownloadEditorToManifest(editor)).toThrow(/文件名/);
  });
});
