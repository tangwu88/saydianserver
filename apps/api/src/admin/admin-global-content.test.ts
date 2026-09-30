import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

function manifest() {
  return {
    schemaVersion: 1,
    realm: "global",
    audience: "internal_test",
    publishedAt: "2026-09-10T00:00:00Z",
    releases: [
      {
        platform: "android", packageId: "cn.saydian.app.global", versionName: "0.1.0", buildNumber: 1, status: "available",
        destination: { kind: "direct", url: "/global/down/files/global-qa.apk", fileName: "global-qa.apk", sizeBytes: 1024, sha256: "a".repeat(64) },
      },
      { platform: "ios", packageId: "cn.saydian.app.global", versionName: "0.1.0", buildNumber: 1, status: "coming_soon" },
      { platform: "harmonyos", packageId: "cn.saydian.app.global.hm", versionName: "0.1.0", buildNumber: 1, status: "coming_soon" },
    ],
  };
}

function sayRingManifest() {
  const value = manifest();
  value.releases = value.releases.map(release => ({
    ...release,
    packageId: release.platform === "harmonyos" ? "cn.saydian.ring.hm" : "cn.saydian.ring",
  }));
  return value;
}

function harness() {
  const appSetting = {
    findMany: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(async (args: any) => args.create),
  };
  const legalDocument = {
    findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  };
  const globalLegalDocument = {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(async (args: any) => ({ id: "global-document", ...args.data })),
    update: vi.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = { appSetting, legalDocument, globalLegalDocument };
  const prisma = { ...tx, $transaction: vi.fn(async (callback: any) => callback(tx)) };
  const secrets = { save: vi.fn().mockResolvedValue(undefined) };
  return { ...tx, prisma, secrets, service: new AdminService(prisma as any, secrets as any) };
}

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

describe("global admin support and download configuration", () => {
  it("lists support, updates and the independent Say Ring map setting", async () => {
    const h = harness();
    await h.service.settings();
    expect(h.appSetting.findMany).toHaveBeenCalledWith({ where: { key: { in: ["global_support", "global_app_update", "say_ring_app_update", "say_ring_app_display", "say_ring_map"] } }, orderBy: { key: "asc" } });
  });

  it("encrypts the Say Ring AMap key separately from the public setting", async () => {
    const h = harness();
    const saved = await h.service.updateSetting("say_ring_map", {
      value: { provider: "amap", enabled: true },
      webServiceKey: "a".repeat(32),
      public: true,
    });
    expect(h.secrets.save).toHaveBeenCalledWith("say_ring_amap", { webServiceKey: "a".repeat(32) });
    expect(saved.value).toEqual({ provider: "amap", enabled: true, configured: true });
    expect(JSON.stringify(h.appSetting.upsert.mock.calls[0]?.[0])).not.toContain("a".repeat(32));
  });

  it("saves global support publication without aliasing it to domestic support", async () => {
    const h = harness();
    const value = { configured: false, message: "Global support is not configured yet." };
    await h.service.updateSetting("global_support", { value, public: false });
    expect(h.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "global_support" },
      create: { key: "global_support", value, public: false },
      update: { value, public: false },
    });
  });

  it.each(["support", "app_update", "legacy_app_update", "arbitrary_setting"])("refuses the unrelated key %s without any write", (key) => {
    const h = harness();
    expect(() => h.service.updateSetting(key, { value: { configured: true } })).toThrow("设置项不存在");
    expect(h.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("preserves global package identities and the global download path on save", async () => {
    const h = harness();
    const saved = await h.service.updateSetting("global_app_update", { value: manifest(), public: true });
    expect(saved.value).toMatchObject({ realm: "global", releases: [
      { platform: "android", packageId: "cn.saydian.app.global", destination: { url: "/global/down/files/global-qa.apk" } },
      { platform: "ios", packageId: "cn.saydian.app.global" },
      { platform: "harmonyos", packageId: "cn.saydian.app.global.hm" },
    ] });
    expect(h.appSetting.upsert.mock.calls[0]?.[0].where).toEqual({ key: "global_app_update" });
  });

  it("saves Say Ring metadata only under the Say Ring setting key", async () => {
    const h = harness();
    const saved = await h.service.updateSetting("say_ring_app_update", {
      value: sayRingManifest(),
      public: true,
    });
    expect(saved.value).toMatchObject({
      realm: "global",
      releases: [
        { platform: "android", packageId: "cn.saydian.ring" },
        { platform: "ios", packageId: "cn.saydian.ring" },
        { platform: "harmonyos", packageId: "cn.saydian.ring.hm" },
      ],
    });
    expect(h.appSetting.upsert.mock.calls[0]?.[0].where).toEqual({
      key: "say_ring_app_update",
    });
  });

  it("saves a Say Ring Android market link and returns an actionable manifest validation error", async () => {
    const h = harness();
    const value: any = sayRingManifest();
    value.publishedAt = "2026-09-29T03:28:31.100Z";
    value.releases[0].versionName = "0.1.2";
    value.releases[0].destination = { kind: "market", url: "https://www.baidu.com/" };
    const saved = await h.service.updateSetting("say_ring_app_update", { value, public: true });
    expect((saved.value as any).releases[0].destination).toEqual({ kind: "market", url: "https://www.baidu.com/" });

    value.publishedAt = "";
    let validationError: any;
    try {
      h.service.updateSetting("say_ring_app_update", { value });
    } catch (error) { validationError = error; }
    expect(validationError?.getResponse()).toMatchObject({
      errorKey: "download_manifest_invalid",
      message: "publishedAt 长度无效",
    });
    expect(h.appSetting.upsert).toHaveBeenCalledTimes(1);
  });

  it.each(["realm", "package", "path"])("rejects a manifest with the wrong %s before persistence", (field) => {
    const h = harness();
    const value = manifest();
    if (field === "realm") value.realm = "domestic";
    if (field === "package") value.releases[0]!.packageId = "cn.saydian.app";
    if (field === "path") value.releases[0]!.destination!.url = "/down/files/domestic.apk";
    expect(() => h.service.updateSetting("global_app_update", { value })).toThrow();
    expect(h.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("preserves the existing domestic settings contract", async () => {
    vi.stubEnv("APP_REALM", "domestic");
    const h = harness();
    await h.service.settings();
    expect(h.appSetting.findMany).toHaveBeenCalledWith({ where: { key: { in: ["support", "app_update", "legacy_app_update", "say_ring_app_display"] } }, orderBy: { key: "asc" } });
    await h.service.updateSetting("support", { value: { configured: false } });
    expect(h.appSetting.upsert.mock.calls[0]?.[0].where).toEqual({ key: "support" });
    expect(() => h.service.updateSetting("global_app_update", { value: manifest() })).toThrow("设置项不存在");
    expect(h.appSetting.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("Say Ring AI visibility administration", () => {
  it.each(["global", "domestic"])("publishes the explicit flag in the %s realm", async (realm) => {
    vi.stubEnv("APP_REALM", realm);
    const h = harness();
    for (const hideAi of [true, false]) {
      const result = await h.service.updateSetting("say_ring_app_display", {
        value: { hideAi, privateNote: "must-not-persist" }, public: true,
      });
      expect(result).toEqual({ key: "say_ring_app_display", value: { hideAi }, public: true });
    }
    expect(h.appSetting.upsert).toHaveBeenCalledTimes(2);
  });

  it.each(["false", 0, null, undefined])("rejects an ambiguous flag %s without changing the setting", (hideAi) => {
    const h = harness();
    expect(() => h.service.updateSetting("say_ring_app_display", { value: { hideAi } })).toThrow("隐藏 AI 内容必须为开启或关闭");
    expect(h.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("does not save a hidden draft that an operator might mistake for an active switch", () => {
    const h = harness();
    expect(() => h.service.updateSetting("say_ring_app_display", { value: { hideAi: true }, public: false })).toThrow("显示设置必须公开");
    expect(h.appSetting.upsert).not.toHaveBeenCalled();
  });
});

describe("global administrator legal-document data source", () => {
  const input = {
    documentType: "privacy_policy", locale: "en", version: "global-qa-2026-09-10",
    title: "Global QA privacy notice", contentHtml: "<p>Synthetic pre-release test notice.</p>",
    active: true, reviewed: true, publishedAt: "2026-09-10T00:00:00Z",
  };

  it("lists the global QA documents rather than the empty legacy table", async () => {
    const h = harness();
    h.globalLegalDocument.findMany.mockResolvedValue([input]);
    expect(await h.service.legalDocuments()).toEqual([input]);
    expect(h.globalLegalDocument.findMany).toHaveBeenCalledWith({ orderBy: [{ locale: "asc" }, { documentType: "asc" }, { publishedAt: "desc" }] });
    expect(h.legalDocument.findMany).not.toHaveBeenCalled();
  });

  it("saves a reviewed global revision and only deactivates documents of the same locale and type", async () => {
    const h = harness();
    const saved = await h.service.saveLegalDocument("existing-global-document", input);
    expect(saved).toMatchObject({ id: "existing-global-document", locale: "en", reviewed: true, active: true });
    expect(h.globalLegalDocument.updateMany).toHaveBeenCalledWith({ where: {
      documentType: "privacy_policy", locale: "en", id: { not: "existing-global-document" },
    }, data: { active: false } });
    expect(h.globalLegalDocument.update).toHaveBeenCalled();
    expect(h.legalDocument.update).not.toHaveBeenCalled();
    expect(h.legalDocument.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the existing review gate before publication", async () => {
    const h = harness();
    await expect(h.service.saveLegalDocument(undefined, { ...input, reviewed: false })).rejects.toThrow("Review the global document");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.globalLegalDocument.create).not.toHaveBeenCalled();
  });

  it("allows an unreviewed inactive draft without replacing published global documents", async () => {
    const h = harness();
    expect(await h.service.saveLegalDocument(undefined, { ...input, reviewed: false, active: false })).toMatchObject({ reviewed: false, active: false });
    expect(h.globalLegalDocument.create).toHaveBeenCalled();
    expect(h.globalLegalDocument.updateMany).not.toHaveBeenCalled();
  });
});
