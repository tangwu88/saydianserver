import { describe, expect, it } from "vitest";
import {
  buildSafePushPayload,
  isAdminRole,
  isBusinessType,
  isHealthMetric,
  isPaymentChannel,
  parseDownloadManifest,
} from "./index";

describe("public contracts", () => {
  it("accepts only canonical health metrics", () => {
    expect(isHealthMetric("heart_rate")).toBe(true);
    expect(isHealthMetric("heartReat")).toBe(false);
  });

  it("keeps admin roles explicit", () => {
    expect(isAdminRole("HEALTH_AUDITOR")).toBe(true);
    expect(isAdminRole("COMMERCE_OPERATIONS")).toBe(true);
    expect(isAdminRole("ADMIN")).toBe(false);
  });

  it("keeps billing values explicit", () => {
    expect(isBusinessType("health_report")).toBe(true);
    expect(isBusinessType("report")).toBe(false);
    expect(isPaymentChannel("apple_iap")).toBe(true);
    expect(isPaymentChannel("cash")).toBe(false);
  });

  it("keeps push payload free of health values and phone numbers", () => {
    const input = {
      eventId: "warning-1",
      type: "health_warning",
      deepLink: "/warnings/1",
      mobile: "13800000000",
      value: 188,
    };
    expect(buildSafePushPayload(input)).toEqual({
      eventId: "warning-1",
      type: "health_warning",
      deepLink: "/warnings/1",
    });
  });

  it("accepts one validated release for every download platform", () => {
    const manifest = parseDownloadManifest({
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
    });
    expect(manifest.releases.map((release) => release.platform)).toEqual([
      "android",
      "ios",
      "harmonyos",
    ]);
  });

  it("rejects unsafe downloads and direct iPhone packages", () => {
    const base = {
      schemaVersion: 1,
      audience: "internal_test",
      publishedAt: "2026-09-06T00:00:00+08:00",
    };
    expect(() => parseDownloadManifest({ ...base, releases: [] })).toThrow(
      /Android/,
    );
    expect(() =>
      parseDownloadManifest({
        ...base,
        releases: [
          {
            platform: "android",
            versionName: "1",
            buildNumber: 1,
            status: "available",
            destination: {
              kind: "direct",
              url: "https://example.com/app.apk",
              fileName: "app.apk",
              sizeBytes: 1,
              sha256: "x".repeat(64),
            },
          },
          {
            platform: "ios",
            versionName: "1",
            buildNumber: 1,
            status: "available",
            destination: { kind: "direct", url: "/down/files/app.ipa" },
          },
          {
            platform: "harmonyos",
            versionName: "1",
            buildNumber: 1,
            status: "coming_soon",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseDownloadManifest({
        ...base,
        releases: [
          {
            platform: "android",
            versionName: "1",
            buildNumber: 1,
            status: "coming_soon",
          },
          {
            platform: "ios",
            versionName: "1",
            buildNumber: 1,
            status: "available",
            destination: { kind: "direct", url: "/down/files/app.ipa" },
          },
          {
            platform: "harmonyos",
            versionName: "1",
            buildNumber: 1,
            status: "coming_soon",
          },
        ],
      }),
    ).toThrow(/iPhone/);
  });
});
