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
  return { ...tx, prisma, service: new AdminService(prisma as any, {} as any) };
}

beforeEach(() => vi.stubEnv("APP_REALM", "global"));
afterEach(() => vi.unstubAllEnvs());

describe("global admin support and download configuration", () => {
  it("lists only the two keys that the global application actually reads", async () => {
    const h = harness();
    await h.service.settings();
    expect(h.appSetting.findMany).toHaveBeenCalledWith({ where: { key: { in: ["global_support", "global_app_update"] } }, orderBy: { key: "asc" } });
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
    expect(h.appSetting.findMany).toHaveBeenCalledWith({ where: { key: { in: ["support", "app_update", "legacy_app_update"] } }, orderBy: { key: "asc" } });
    await h.service.updateSetting("support", { value: { configured: false } });
    expect(h.appSetting.upsert.mock.calls[0]?.[0].where).toEqual({ key: "support" });
    expect(() => h.service.updateSetting("global_app_update", { value: manifest() })).toThrow("设置项不存在");
    expect(h.appSetting.upsert).toHaveBeenCalledTimes(1);
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
