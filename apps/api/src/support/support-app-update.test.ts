import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";
import { parseDownloadManifest } from "@saydian/app-contracts";
import { parseGlobalDownloadManifest } from "./global-download-manifest";
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
  it("returns review-pending iPhone metadata without an install destination", async () => {
    const value = {
      ...validManifest,
      releases: validManifest.releases.map((release) =>
        release.platform === "ios"
          ? {
              ...release,
              versionName: "1.0.1",
              buildNumber: 1013,
              pendingReason: "review",
            }
          : release,
      ),
    };
    const saved = await serviceWith({ public: true, value }).appUpdateConfig();
    expect(saved.releases[1]).toMatchObject({
      status: "coming_soon",
      pendingReason: "review",
    });
    expect(saved.releases[1]).not.toHaveProperty("destination");
    for (const release of [
      {
        ...value.releases[1]!,
        destination: {
          kind: "testflight",
          url: "https://testflight.apple.com/join/fixture",
        },
      },
      { ...value.releases[1]!, pendingReason: "approved" },
      { ...validManifest.releases[0]!, pendingReason: "review" },
    ])
      await expect(
        serviceWith({
          public: true,
          value: {
            ...value,
            releases: value.releases.map((item) =>
              item.platform === release.platform ? release : item,
            ),
          },
        }).appUpdateConfig(),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it("reads only the global manifest key and never exposes domestic direct package paths", async () => {
    vi.stubEnv("APP_REALM", "global");
    const globalManifest = {
      ...validManifest,
      realm: "global",
      releases: validManifest.releases.map((release) => ({
        ...release,
        packageId:
          release.platform === "harmonyos"
            ? "cn.saydian.app.global.hm"
            : "cn.saydian.app.global",
        ...(release.destination
          ? {
              destination: {
                ...release.destination,
                url: `/global${release.destination.url}`,
              },
            }
          : {}),
      })),
    };
    const findUnique = vi.fn(async ({ where }: any) =>
      where.key === "global_app_update"
        ? { public: true, value: globalManifest }
        : null,
    );
    const service = new SupportService(
      { appSetting: { findUnique } } as any,
      {} as any,
    );
    const manifest = await service.appUpdateConfig("saydian-global");
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: "global_app_update" },
    });
    expect(manifest.releases[0]?.destination?.url).toBe(
      `/global/down/files/${manifest.releases[0]?.destination?.fileName}`,
    );
    expect(manifest.releases[1]?.destination).toBeUndefined();
    expect(manifest).toMatchObject({
      realm: "global",
      releases: [
        { packageId: "cn.saydian.app.global" },
        { packageId: "cn.saydian.app.global" },
        { packageId: "cn.saydian.app.global.hm" },
      ],
    });
    expect(
      validManifest.releases[0]?.destination?.url.startsWith("/down/files/"),
    ).toBe(true);
  });
  it("rejects missing global identity, a domestic package ID, and domestic direct URLs", async () => {
    vi.stubEnv("APP_REALM", "global");
    for (const value of [
      validManifest,
      { ...validManifest, realm: "global" },
      {
        ...validManifest,
        realm: "global",
        releases: validManifest.releases.map((release) => ({
          ...release,
          packageId:
            release.platform === "harmonyos"
              ? "cn.saydian.app.global.hm"
              : "cn.saydian.app.global",
        })),
      },
    ]) {
      await expect(
        serviceWith({ public: true, value }).appUpdateConfig("saydian-global"),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    }
  });
  it("routes Say Ring to its own package-bound manifest", async () => {
    vi.stubEnv("APP_REALM", "global");
    const sayRingManifest = {
      ...validManifest,
      realm: "global",
      releases: validManifest.releases.map((release) => ({
        ...release,
        packageId:
          release.platform === "harmonyos"
            ? "cn.saydian.ring.hm"
            : "cn.saydian.ring",
        ...(release.destination
          ? {
              destination: {
                ...release.destination,
                url: `/global${release.destination.url}`,
              },
            }
          : {}),
      })),
    };
    const findUnique = vi.fn(async ({ where }: any) =>
      where.key === "say_ring_app_update"
        ? { public: true, value: sayRingManifest }
        : null,
    );
    const service = new SupportService(
      { appSetting: { findUnique } } as any,
      {} as any,
    );

    await expect(service.appUpdateConfig("say-ring")).resolves.toMatchObject({
      realm: "global",
      releases: [
        { packageId: "cn.saydian.ring" },
        { packageId: "cn.saydian.ring" },
        { packageId: "cn.saydian.ring.hm" },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: "say_ring_app_update" },
    });
    await expect(
      service.appUpdateConfig("unknown-product"),
    ).rejects.toBeInstanceOf(NotFoundException);
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

describe("Say Ring package upload and download", () => {
  function packageFixture() {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    const rows: any[] = [];
    const send = vi.fn(async (command: any) =>
      command.constructor.name === "GetObjectCommand"
        ? { Body: Readable.from(bytes) }
        : {},
    );
    const db = {
      fileObject: {
        create: vi.fn(async ({ data }: any) => {
          const row = {
            id: "package-1",
            status: "ACTIVE",
            createdAt: new Date(),
            ...data,
          };
          rows.push(row);
          return row;
        }),
        findFirst: vi.fn(
          async ({ where }: any) =>
            rows.find((row) =>
              Object.entries(where).every(([key, value]) => row[key] === value),
            ) ?? null,
        ),
      },
      integrationConfig: {
        findUnique: vi.fn(async () => null),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const service = new SupportService(db as any, {} as any);
    (service as any).storage = vi.fn(async () => ({
      s3: { send },
      bucket: "app-packages",
    }));
    const file = {
      buffer: bytes,
      size: bytes.length,
      mimetype: "application/vnd.android.package-archive",
      originalname: "Say-Ring.apk",
    } as Express.Multer.File;
    return { service, db, send, rows, file, bytes };
  }

  it.each(["say-ring", "saidian", "saydian-global"])(
    "stores and downloads packages for %s with a saveable manifest",
    async (product) => {
      const h = packageFixture();
      const uploaded = await h.service.uploadAdminAppPackage(
        "admin-1",
        h.file,
        "android",
        product,
      );

      expect(uploaded).toMatchObject({
        fileName: expect.stringMatching(
          new RegExp(`^${product}-android-\\d+-[a-f0-9]{8}\\.apk$`),
        ),
        url: expect.stringMatching(
          new RegExp(
            `^${product === "saidian" ? "" : "/global"}/api/saydian-app/v2/support/app-package/`,
          ),
        ),
        sizeBytes: h.bytes.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(h.rows[0]).toMatchObject({
        ownerUserId: null,
        purpose: `app-package:${product}`,
        contentType: "application/vnd.android.package-archive",
      });
      expect(h.send.mock.calls[0]![0].input).toMatchObject({
        Bucket: "app-packages",
        Key: expect.stringMatching(
          new RegExp(`^app-packages/${product}/android/`),
        ),
      });

      const downloaded = await h.service.publicAppPackage(uploaded.fileName);
      expect(downloaded).toMatchObject({
        contentType: "application/vnd.android.package-archive",
        byteSize: h.bytes.length,
        sha256: uploaded.sha256,
      });
      expect(h.send.mock.calls[1]![0].input.Key).toBe(h.rows[0].objectKey);
      const manifest = structuredClone(validManifest);
      manifest.releases[0]!.destination = { kind: "direct", ...uploaded };
      // Only Android is available in this fixture, so other platforms need no package.
      manifest.releases[2] = {
        platform: "harmonyos",
        versionName: "1.0.0",
        buildNumber: 1,
        status: "coming_soon",
      } as any;
      if (product === "saidian") {
        expect(
          parseDownloadManifest(manifest).releases[0]?.destination?.url,
        ).toBe(uploaded.url);
      } else {
        const packageId =
          product === "say-ring" ? "cn.saydian.ring" : "cn.saydian.app.global";
        const globalManifest = {
          ...manifest,
          realm: "global",
          releases: manifest.releases.map((r) => ({
            ...r,
            packageId:
              r.platform === "harmonyos" ? `${packageId}.hm` : packageId,
          })),
        };
        expect(
          parseGlobalDownloadManifest(
            globalManifest,
            product as "say-ring" | "saydian-global",
          ).releases[0]?.destination?.url,
        ).toBe(uploaded.url);
      }
    },
  );

  it("keeps the existing default and rejects unknown products before storage", async () => {
    const h = packageFixture();
    await expect(
      h.service.uploadAdminAppPackage("admin-1", h.file, "android", "unknown"),
    ).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
    const uploaded = await h.service.uploadAdminAppPackage(
      "admin-1",
      h.file,
      "android",
    );
    expect(uploaded.fileName).toMatch(/^say-ring-/);
    h.rows[0].purpose = "app-package:saidian";
    await expect(
      h.service.publicAppPackage(uploaded.fileName),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(["saidian", "saydian-global", "say-ring"])(
    "uploads HarmonyOS packages for %s",
    async (product) => {
      const h = packageFixture();
      const uploaded = await h.service.uploadAdminAppPackage(
        "admin-1",
        { ...h.file, originalname: "app.hap" },
        "harmonyos",
        product,
      );
      expect(uploaded.fileName).toMatch(
        new RegExp(`^${product}-harmonyos-.*\\.hap$`),
      );
      const downloaded = await h.service.publicAppPackage(uploaded.fileName);
      expect(downloaded.contentType).toBe("application/octet-stream");
      expect(h.send.mock.calls[1]![0].input.Key).toContain(
        `app-packages/${product}/harmonyos/`,
      );
    },
  );

  it("rejects a mismatched platform, extension, header, and size before storage", async () => {
    const h = packageFixture();
    for (const [platform, file] of [
      ["ios", h.file],
      ["harmonyos", h.file],
      ["android", { ...h.file, originalname: "Say-Ring.zip" }],
      ["android", { ...h.file, buffer: Buffer.from("not a zip"), size: 9 }],
      ["android", { ...h.file, size: 128 * 1024 * 1024 + 1 }],
    ] as const) {
      await expect(
        h.service.uploadAdminAppPackage(
          "admin-1",
          file as Express.Multer.File,
          platform,
        ),
      ).rejects.toThrow();
    }
    expect(h.send).not.toHaveBeenCalled();
    expect(h.db.fileObject.create).not.toHaveBeenCalled();
  });

  it("does not expose unknown or unsafe package names", async () => {
    const h = packageFixture();
    await expect(
      h.service.publicAppPackage("../Say-Ring.apk"),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.publicAppPackage("missing.apk"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.send).not.toHaveBeenCalled();
  });
});

describe("Chinese app isolated updates", () => {
  function cnManifest() {
    return {
      ...validManifest,
      product: "saydian-app-cn",
      realm: "global",
      releases: validManifest.releases.map((release) =>
        release.platform === "android"
          ? {
              ...release,
              packageId: "cc.saidian.app",
              destination: {
                ...release.destination!,
                url: "/global/down/files/saydian-app-cn-fixture.apk",
                fileName: "saydian-app-cn-fixture.apk",
              },
            }
          : {
              platform: release.platform,
              versionName: release.versionName,
              buildNumber: release.buildNumber,
              status: "coming_soon",
              packageId: release.platform === "ios" ? "" : "cc.saidian.app.hm",
            },
      ),
    };
  }
  it("reads only cn_app_update without falling back to other products", async () => {
    vi.stubEnv("APP_REALM", "global");
    const findUnique = vi.fn(async ({ where }: any) =>
      where.key === "cn_app_update"
        ? { public: true, value: cnManifest() }
        : null,
    );
    const service = new SupportService(
      { appSetting: { findUnique } } as never,
      {} as never,
    );
    await expect(
      service.appUpdateConfig("saydian-app-cn"),
    ).resolves.toMatchObject({
      product: "saydian-app-cn",
      releases: [
        { packageId: "cc.saidian.app" },
        { status: "coming_soon" },
        { status: "coming_soon" },
      ],
    });
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { key: "cn_app_update" },
    });
  });
  it("rejects another product, package or package filename", () => {
    const value = cnManifest();
    for (const invalid of [
      { ...value, product: "saydian-global" },
      { ...value, product: undefined },
      {
        ...value,
        releases: value.releases.map((r) =>
          r.platform === "android" ? { ...r, packageId: "cn.saydian.ring" } : r,
        ),
      },
      {
        ...value,
        releases: value.releases.map((r) =>
          r.platform === "android"
            ? {
                ...r,
                destination: {
                  ...("destination" in r ? r.destination : {}),
                  url: "/global/down/files/say-ring-fixture.apk",
                },
              }
            : r,
        ),
      },
    ])
      expect(() =>
        parseGlobalDownloadManifest(invalid, "saydian-app-cn"),
      ).toThrow();
  });
});
