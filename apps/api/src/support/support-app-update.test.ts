import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";
afterEach(() => vi.unstubAllEnvs());

const validManifest = {
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

function serviceWith(setting: unknown): SupportService {
  return new SupportService(
    { appSetting: { findUnique: vi.fn().mockResolvedValue(setting) } } as never,
    {} as never,
  );
}

describe("public App download manifest", () => {
  it("reads only the global manifest key and never exposes domestic direct package paths", async () => {
    vi.stubEnv("APP_REALM", "global");
    const globalManifest = { ...validManifest, realm: "global", releases: validManifest.releases.map(release => ({ ...release, packageId: release.platform === "harmonyos" ? "cn.saydian.app.global.hm" : "cn.saydian.app.global", ...(release.destination ? { destination: { ...release.destination, url: `/global${release.destination.url}` } } : {}) })) };
    const findUnique = vi.fn(async ({ where }: any) => where.key === "global_app_update" ? { public: true, value: globalManifest } : null);
    const service = new SupportService({ appSetting: { findUnique } } as any, {} as any);
    const manifest = await service.appUpdateConfig();
    expect(findUnique).toHaveBeenCalledWith({ where: { key: "global_app_update" } });
    expect(manifest.releases[0]?.destination?.url).toBe(`/global/down/files/${manifest.releases[0]?.destination?.fileName}`);
    expect(manifest.releases[1]?.destination).toBeUndefined();
    expect(manifest).toMatchObject({ realm: "global", releases: [{ packageId: "cn.saydian.app.global" }, { packageId: "cn.saydian.app.global" }, { packageId: "cn.saydian.app.global.hm" }] });
    expect(validManifest.releases[0]?.destination?.url.startsWith("/down/files/")).toBe(true);
  });
  it("rejects missing global identity, a domestic package ID, and domestic direct URLs", async () => {
    vi.stubEnv("APP_REALM", "global");
    for (const value of [validManifest, { ...validManifest, realm: "global" }, { ...validManifest, realm: "global", releases: validManifest.releases.map(release => ({ ...release, packageId: release.platform === "harmonyos" ? "cn.saydian.app.global.hm" : "cn.saydian.app.global" })) }]) {
      await expect(serviceWith({ public: true, value }).appUpdateConfig()).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });
  it("returns 404 until a public manifest is published", async () => {
    await expect(serviceWith(null).appUpdateConfig()).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      serviceWith({ public: false, value: validManifest }).appUpdateConfig(),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("fails closed when stored download metadata is invalid", async () => {
    await expect(
      serviceWith({
        public: true,
        value: { ...validManifest, audience: "production" },
      }).appUpdateConfig(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("returns only the normalized validated manifest", async () => {
    await expect(
      serviceWith({ public: true, value: validManifest }).appUpdateConfig(),
    ).resolves.toEqual(validManifest);
  });
});
