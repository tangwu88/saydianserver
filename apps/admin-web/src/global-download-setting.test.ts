import { describe, expect, it } from "vitest";
import {
  createGlobalDownloadDraft,
  globalDownloadEditorToManifest,
  globalDownloadManifestFromPublicData,
  globalDownloadManifestToEditor,
  sayRingDownloadEditorToManifest,
  sayRingDownloadManifestFromPublicData,
  sayRingDownloadManifestToEditor,
} from "./global-download-setting";

const manifest = {
  schemaVersion: 1,
  audience: "internal_test",
  realm: "global",
  publishedAt: "2026-09-10T00:00:00Z",
  releases: [
    {
      platform: "android",
      packageId: "cn.saydian.app.global",
      versionName: "0.1.0",
      buildNumber: 1,
      status: "available",
      destination: {
        kind: "direct",
        url: "/global/down/files/global-1.apk",
        fileName: "global-1.apk",
        sizeBytes: 12345,
        sha256: "a".repeat(64),
      },
    },
    {
      platform: "ios",
      packageId: "cn.saydian.app.global",
      versionName: "0.1.0",
      buildNumber: 1,
      status: "coming_soon",
    },
    {
      platform: "harmonyos",
      packageId: "cn.saydian.app.global.hm",
      versionName: "0.1.0",
      buildNumber: 1,
      status: "coming_soon",
    },
  ],
};

describe("international download settings", () => {
  it("creates separate empty drafts without invented publication or version data", () => {
    const draft = createGlobalDownloadDraft();
    expect(draft.publishedAt).toBe("");
    for (const release of Object.values(draft.releases)) {
      expect(release.status).toBe("coming_soon");
      expect(release.versionName).toBe("");
      expect(release.buildNumber).toBeUndefined();
      expect(release.url).toBe("");
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
    expect(saved.realm).toBe("global");
    expect(saved.releases[0]).toMatchObject({
      packageId: "cn.saydian.app.global",
      versionName: "0.1.1",
      destination: { url: "/global/down/files/global-1.apk" },
    });
    expect(saved.releases[1]).not.toHaveProperty("destination");
    expect(saved.releases[2]?.packageId).toBe("cn.saydian.app.global.hm");
  });

  it("rejects manifests without international identity or with another package ID", () => {
    expect(() =>
      globalDownloadManifestFromPublicData({ ...manifest, realm: undefined }),
    ).toThrow(/国际版/);
    expect(() =>
      globalDownloadManifestFromPublicData({
        ...manifest,
        releases: manifest.releases.map((release) => ({
          ...release,
          packageId: "cn.saydian.app",
        })),
      }),
    ).toThrow(/标识/);
  });

  it("rejects domestic paths on both read and save", () => {
    const invalid = {
      ...manifest,
      releases: manifest.releases.map((release) =>
        release.destination
          ? {
              ...release,
              destination: {
                ...release.destination,
                url: "/down/files/global-1.apk",
              },
            }
          : release,
      ),
    };
    expect(() => globalDownloadManifestFromPublicData(invalid)).toThrow(
      /国际版下载地址/,
    );
    const editor = globalDownloadManifestToEditor(manifest);
    editor.releases.android.url = "/down/files/global-1.apk";
    expect(() => globalDownloadEditorToManifest(editor)).toThrow(
      /国际版下载地址/,
    );
  });

  it("keeps shared filename and hash validation for international downloads", () => {
    const editor = globalDownloadManifestToEditor(manifest);
    editor.releases.android.fileName = "other.apk";
    expect(() => globalDownloadEditorToManifest(editor)).toThrow(/文件名/);
  });

  it("roundtrips an Android market link and a backend-uploaded Harmony package", () => {
    const editor = globalDownloadManifestToEditor(manifest);
    editor.releases.android.destinationKind = "market";
    editor.releases.android.url = "https://example.com/say-ring";
    editor.releases.harmonyos = {
      ...editor.releases.harmonyos,
      versionName: "1.0.0",
      buildNumber: 10,
      status: "available",
      destinationKind: "direct",
      url: "/global/api/saydian-app/v2/support/app-package/say-ring-10.hap",
      fileName: "say-ring-10.hap",
      sizeBytes: 123,
      sha256: "c".repeat(64),
    };
    const saved = globalDownloadEditorToManifest(editor);
    expect(saved.releases[0]?.destination).toEqual({
      kind: "market",
      url: "https://example.com/say-ring",
    });
    expect(saved.releases[2]?.destination?.url).toContain("/global/api/");
  });

  it("keeps Say Ring package identities isolated from the older global App", () => {
    const sayRingManifest = {
      ...manifest,
      releases: manifest.releases.map((release) => ({
        ...release,
        packageId:
          release.platform === "harmonyos"
            ? "cn.saydian.ring.hm"
            : "cn.saydian.ring",
      })),
    };
    const parsed = sayRingDownloadManifestFromPublicData(sayRingManifest);
    const editor = sayRingDownloadManifestToEditor(parsed);
    const saved = sayRingDownloadEditorToManifest(editor);
    expect(saved.releases).toMatchObject([
      { platform: "android", packageId: "cn.saydian.ring" },
      { platform: "ios", packageId: "cn.saydian.ring" },
      { platform: "harmonyos", packageId: "cn.saydian.ring.hm" },
    ]);
    expect(() => globalDownloadManifestFromPublicData(sayRingManifest)).toThrow(
      /标识/,
    );
    expect(() => sayRingDownloadManifestFromPublicData(manifest)).toThrow(
      /标识/,
    );
  });

  it("derives the hidden coming-soon Harmony identity from the Android version", () => {
    const editor = createGlobalDownloadDraft();
    editor.publishedAt = "2026-09-27T00:00:00Z";
    editor.releases.android = {
      ...editor.releases.android,
      versionName: "0.1.22",
      buildNumber: 1005,
      status: "available",
      url: "/global/down/files/SayRing-0.1.22.apk",
      fileName: "SayRing-0.1.22.apk",
      sizeBytes: 12345,
      sha256: "b".repeat(64),
    };
    editor.releases.ios = {
      ...editor.releases.ios,
      versionName: "0.1.22",
      buildNumber: 1005,
    };

    const saved = sayRingDownloadEditorToManifest(editor);
    expect(saved.releases[2]).toMatchObject({
      platform: "harmonyos",
      packageId: "cn.saydian.ring.hm",
      versionName: "0.1.22",
      buildNumber: 1005,
      status: "coming_soon",
    });
  });
});
