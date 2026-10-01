import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Readable } from "node:stream";
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

  it("stores a validated package and streams it back through the public route", async () => {
    const h = packageFixture();
    const uploaded = await h.service.uploadAdminAppPackage(
      "admin-1",
      h.file,
      "android",
    );

    expect(uploaded).toMatchObject({
      fileName: expect.stringMatching(
        /^say-ring-android-\d+-[a-f0-9]{8}\.apk$/,
      ),
      url: expect.stringMatching(
        /^\/global\/api\/saydian-app\/v2\/support\/app-package\//,
      ),
      sizeBytes: h.bytes.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(h.rows[0]).toMatchObject({
      ownerUserId: null,
      purpose: "app-package:say-ring",
      contentType: "application/vnd.android.package-archive",
    });
    expect(h.send.mock.calls[0]![0].input).toMatchObject({
      Bucket: "app-packages",
      Key: expect.stringMatching(/^app-packages\/say-ring\/android\//),
    });

    const downloaded = await h.service.publicAppPackage(uploaded.fileName);
    expect(downloaded).toMatchObject({
      contentType: "application/vnd.android.package-archive",
      byteSize: h.bytes.length,
      sha256: uploaded.sha256,
    });
    expect(h.send.mock.calls[1]![0].input.Key).toBe(h.rows[0].objectKey);
  });

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
