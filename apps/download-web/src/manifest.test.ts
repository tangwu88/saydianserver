import { describe, expect, it } from "vitest";
import { manifestFromApiData } from "./manifest";

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
        fileName: "Saydian-Android-0.1.19-build23-QA.apk",
        url: "/down/files/Saydian-Android-0.1.19-build23-QA.apk",
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
        fileName: "Saydian-HarmonyOS-0.1.3-build5.hap",
        url: "/down/files/Saydian-HarmonyOS-0.1.3-build5.hap",
        sizeBytes: 8_595_228,
        sha256:
          "22c03c4b88448e11412f1bb1397275760aa29e72135d395e008f97d53b40358f",
      },
    },
  ],
};

describe("download manifest API compatibility", () => {
  it("accepts the current public API data shape", () => {
    expect(manifestFromApiData(manifest).schemaVersion).toBe(1);
  });

  it("accepts the legacy public setting wrapper during rollout", () => {
    expect(
      manifestFromApiData({ value: manifest, public: true }).releases,
    ).toHaveLength(3);
  });

  it("rejects missing manifest data", () => {
    expect(() => manifestFromApiData({ public: true })).toThrow();
  });
});
