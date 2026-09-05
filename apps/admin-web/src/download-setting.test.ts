import { describe, expect, it } from "vitest";
import {
  downloadEditorToManifest,
  downloadManifestFromPublicData,
  downloadManifestToEditor,
  type DownloadManifestEditor,
} from "./download-setting";

const manifest = {
  schemaVersion: 1,
  audience: "internal_test",
  publishedAt: "2026-09-06T00:00:00+08:00",
  releases: [
    {
      platform: "android",
      versionName: "0.1.19",
      buildNumber: 23,
      status: "available",
      destination: {
        kind: "direct",
        url: "/down/files/Saydian-Android-0.1.19-build23-QA.apk",
        fileName: "Saydian-Android-0.1.19-build23-QA.apk",
        sizeBytes: 64_401_320,
        sha256:
          "d81d46ed1b100b13aca43bf3e0323a5c0d2e1004840831a10c2f3cd385c1bf26",
      },
    },
    {
      platform: "ios",
      versionName: "0.1.19",
      buildNumber: 23,
      status: "coming_soon",
    },
    {
      platform: "harmonyos",
      versionName: "0.1.3",
      buildNumber: 5,
      status: "available",
      destination: {
        kind: "direct",
        url: "/down/files/Saydian-HarmonyOS-0.1.3-build5.hap",
        fileName: "Saydian-HarmonyOS-0.1.3-build5.hap",
        sizeBytes: 8_595_228,
        sha256:
          "22c03c4b88448e11412f1bb1397275760aa29e72135d395e008f97d53b40358f",
      },
    },
  ],
};

describe("download setting editor", () => {
  it("reads a fallback manifest from the public setting wrapper", () => {
    expect(
      downloadManifestFromPublicData({ value: manifest, public: true }).releases,
    ).toHaveLength(3);
  });

  it("maps the published manifest into named platform fields", () => {
    const editor = downloadManifestToEditor(manifest);
    expect(editor.releases.android.versionName).toBe("0.1.19");
    expect(editor.releases.ios.status).toBe("coming_soon");
    expect(editor.releases.harmonyos.sizeBytes).toBe(8_595_228);
  });

  it("builds a validated manifest after editing versions and links", () => {
    const editor = downloadManifestToEditor(manifest);
    editor.releases.android.versionName = "0.1.20";
    editor.releases.android.buildNumber = 24;
    editor.releases.android.fileName = "Saydian-Android-0.1.20-build24-QA.apk";
    editor.releases.android.url =
      "/down/files/Saydian-Android-0.1.20-build24-QA.apk";
    const updated = downloadEditorToManifest(editor);
    expect(updated.releases[0]?.versionName).toBe("0.1.20");
    expect(updated.releases[0]?.destination?.url).toContain("build24");
  });

  it("keeps a coming-soon iPhone release free of a fake link", () => {
    const editor = downloadManifestToEditor(manifest);
    const updated = downloadEditorToManifest(editor);
    expect(
      updated.releases.find((release) => release.platform === "ios"),
    ).not.toHaveProperty("destination");
  });

  it("rejects an unsafe direct download link before saving", () => {
    const editor = downloadManifestToEditor(manifest) as DownloadManifestEditor;
    editor.releases.android.url = "https://example.com/app.apk";
    expect(() => downloadEditorToManifest(editor)).toThrow(
      /download address|\u4e0b\u8f7d\u5730\u5740/,
    );
  });
});
