import { afterEach, describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import { sayRingIosHealthDisplayOrClosed, sayRingIosHealthSettingKey } from "@saydian/app-contracts";

const unavailable = {
  configured: false,
  message: "Support is temporarily unavailable. Please try again later.",
};
afterEach(() => vi.unstubAllEnvs());
function harness(rows: Array<{ key: string; public: boolean; value: unknown }>) {
  const findFirst = vi.fn(async ({ where, select }: any) => {
    const row = rows.find((item) => item.key === where.key && item.public === where.public);
    return row && select.value ? { value: row.value } : null;
  });
  const findUnique = vi.fn(() => {
    throw new Error("Unfiltered settings read must not be used");
  });
  const secrets = { resolve: vi.fn() };
  const service = new SupportService({ appSetting: { findFirst, findUnique } } as unknown as PrismaService, secrets as unknown as IntegrationSecretsService);
  return { service, findFirst, findUnique, secrets };
}
describe("public support configuration boundary", () => {
  it("does not reuse domestic support settings in the global account deployment", async () => {
    vi.stubEnv("APP_REALM", "global");
    const h = harness([{ key: "support", public: true, value: { configured: true } }]);
    expect(await h.service.supportConfig()).toEqual({
      configured: false,
      message: "Support is temporarily unavailable. Please try again later.",
    });
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { key: "global_support", public: true },
      select: { value: true },
    });
  });
  it("normalizes the legacy numeric configured field into the published phone contract", async () => {
    vi.stubEnv("APP_REALM", "global");
    const h = harness([
      {
        key: "global_support",
        public: true,
        value: { configured: 13600136000 },
      },
    ]);
    expect(await h.service.supportConfig()).toEqual({
      configured: true,
      phone: "13600136000",
    });
  });
  it("whitelists valid global contact fields and drops unrelated saved data", async () => {
    vi.stubEnv("APP_REALM", "global");
    const h = harness([
      {
        key: "global_support",
        public: true,
        value: {
          configured: true,
          phone: "400 638 6738",
          officialAccount: "赛电",
          serviceHours: "工作日 09:00-18:00",
          message: "请先准备设备信息",
          internalNote: "must-not-be-public",
        },
      },
    ]);
    expect(await h.service.supportConfig()).toEqual({
      configured: true,
      phone: "400 638 6738",
      officialAccount: "赛电",
      serviceHours: "工作日 09:00-18:00",
      message: "请先准备设备信息",
    });
  });
  it("fails closed when a published global contact has no usable channel", async () => {
    vi.stubEnv("APP_REALM", "global");
    const h = harness([
      {
        key: "global_support",
        public: true,
        value: {
          configured: true,
          phone: "invalid phone",
          internalNote: "must-not-be-public",
        },
      },
    ]);
    expect(await h.service.supportConfig()).toEqual({
      configured: false,
      message: "Support is temporarily unavailable. Please try again later.",
    });
  });
  it("filters by both exact support key and explicit publication at the database boundary", async () => {
    const h = harness([]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { key: "global_support", public: true },
      select: { value: true },
    });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.secrets.resolve).not.toHaveBeenCalled();
  });
  it("never even loads a non-public support JSON value", async () => {
    let privateValueReads = 0;
    const privateRow = {
      key: "global_support",
      public: false,
      get value() {
        privateValueReads++;
        return { internalNote: "SYSTEM-QA-private-only", configured: true };
      },
    };
    const h = harness([privateRow]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
    expect(privateValueReads).toBe(0);
  });
  it("preserves the published support contract", async () => {
    const value = {
      configured: true,
      phone: "400 638 6738",
      message: "SYSTEM-QA-public-help",
      serviceHours: "SYSTEM-QA",
    };
    const h = harness([{ key: "global_support", public: true, value }]);
    expect(await h.service.supportConfig()).toEqual(value);
  });
  it("does not return another setting even when that setting is public", async () => {
    const h = harness([
      {
        key: "another-setting",
        public: true,
        value: { internalNote: "SYSTEM-QA-other-setting" },
      },
    ]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
  });
  it("fails closed to the normal unavailable value for a null published payload", async () => {
    const h = harness([{ key: "global_support", public: true, value: null }]);
    expect(await h.service.supportConfig()).toEqual(unavailable);
  });
});

describe("Say Ring public AI visibility", () => {
  it("preserves existing display behavior until a flag is published", async () => {
    const h = harness([]);
    expect(await h.service.appDisplayConfig("say-ring")).toEqual({
      product: "say-ring",
      hideAi: false,
    });
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { key: "say_ring_app_display", public: true },
      select: { value: true },
    });
  });

  it.each([true, false])("returns only the explicitly published boolean %s", async (hideAi) => {
    const h = harness([
      {
        key: "say_ring_app_display",
        public: true,
        value: { hideAi, privateNote: "not-public" },
      },
    ]);
    expect(await h.service.appDisplayConfig("say-ring")).toEqual({
      product: "say-ring",
      hideAi,
    });
    expect(h.findUnique).not.toHaveBeenCalled();
    expect(h.secrets.resolve).not.toHaveBeenCalled();
  });

  it("does not load private display configuration", async () => {
    const h = harness([
      {
        key: "say_ring_app_display",
        public: false,
        get value() {
          throw new Error("private value read");
        },
      },
    ]);
    expect(await h.service.appDisplayConfig("say-ring")).toEqual({
      product: "say-ring",
      hideAi: false,
    });
  });

  it.each([undefined, "saydian-global", "another-app"])("refuses product %s without a settings read", async (product) => {
    const h = harness([]);
    await expect(h.service.appDisplayConfig(product)).rejects.toThrow("应用显示设置不存在");
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it("does not turn a malformed saved flag into a false success", async () => {
    const h = harness([{ key: "say_ring_app_display", public: true, value: { hideAi: "true" } }]);
    await expect(h.service.appDisplayConfig("say-ring")).rejects.toThrow("应用显示设置暂时无法读取");
  });
});

describe("CN display product isolation", () => {
  it.each([true, false])(
    "reads only CN flag %s without Ring fallback",
    async (hideAi) => {
      const h = harness([
        {
          key: "cn_app_display",
          public: true,
          value: { hideAi, privateNote: "discard", sleepAiEnabled: true },
        },
        {
          key: "say_ring_app_display",
          public: true,
          value: { hideAi: !hideAi },
        },
      ]);
      expect(await h.service.appDisplayConfig("saydian-app-cn")).toEqual({
        product: "saydian-app-cn",
        hideAi,
      });
      expect(h.findFirst).toHaveBeenCalledWith({
        where: { key: "cn_app_display", public: true },
        select: { value: true },
      });
      expect(await h.service.appDisplayConfig("say-ring")).toEqual({
        product: "say-ring",
        hideAi: !hideAi,
      });
    },
  );
  it("does not reuse Ring when CN has no published value", async () => {
    const h = harness([
      { key: "say_ring_app_display", public: true, value: { hideAi: true } },
    ]);
    expect(await h.service.appDisplayConfig("saydian-app-cn")).toEqual({
      product: "saydian-app-cn",
      hideAi: false,
    });
  });
});

describe("Say Ring iOS public read-only lease", () => {
  it("preserves AI flags and exposes only the fixed iOS display contract", async () => {
    const value = sayRingIosHealthDisplayOrClosed(); value.metrics.heart_rate = true;
    const h = harness([
      { key: "say_ring_app_display", public: true, value: { hideAi: true, sleepAiEnabled: true, privateNote: "discard" } },
      { key: sayRingIosHealthSettingKey, public: true, value },
    ]);
    expect(await h.service.appDisplayConfig("say-ring", "ios")).toEqual({ product: "say-ring", platform: "ios", hideAi: true, sleepAiEnabled: true, readOnlyHealth: { ...value, validForSeconds: 300 }, moduleVisibility: { schemaVersion: 1, validForSeconds: 300, modules: { health_library: false, mall: false } } });
    expect(h.findUnique).not.toHaveBeenCalled(); expect(h.secrets.resolve).not.toHaveBeenCalled();
  });
  it.each([undefined, null, { schemaVersion: 2 }, { ...sayRingIosHealthDisplayOrClosed(), metrics: { heart_rate: "true" } }])("closes absent or malformed config", async value => {
    const h = harness(value === undefined ? [] : [{ key: sayRingIosHealthSettingKey, public: true, value }]);
    expect((await h.service.appDisplayConfig("say-ring", "ios")).readOnlyHealth).toEqual({ ...sayRingIosHealthDisplayOrClosed(), validForSeconds: 300 });
  });
  it("never reads an unpublished health display value", async () => {
    const h = harness([{ key: sayRingIosHealthSettingKey, public: false, get value() { throw new Error("private read"); } }]);
    expect((await h.service.appDisplayConfig("say-ring", "ios")).readOnlyHealth?.metrics.heart_rate).toBe(false);
  });
  it.each([["say-ring", "android"], ["say-ring", undefined], ["saydian-app-cn", "ios"]])("keeps %s/%s responses unchanged", async (product, platform) => {
    const h = harness([]);
    expect(await h.service.appDisplayConfig(product, platform)).toEqual({ product, hideAi: false });
    expect(h.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("independent Say Ring iOS module visibility", () => {
  const closed = { schemaVersion: 1, modules: { health_library: false, mall: false }, validForSeconds: 300 };
  it("adds a closed sibling without expanding the five physiological keys", async () => {
    const h = harness([]);
    const result = await h.service.appDisplayConfig("say-ring", "ios");
    expect(result).toHaveProperty("moduleVisibility", closed);
    expect(Object.keys(result.readOnlyHealth!.metrics)).toEqual(["heart_rate", "hrv", "blood_oxygen", "body_temperature", "stress"]);
  });
  it.each([true, false])("publishes the independent strict booleans %s", async enabled => {
    const value = { schemaVersion: 1, modules: { health_library: enabled, mall: !enabled } };
    const h = harness([{ key: "say_ring_ios_module_display", public: true, value }]);
    expect(await h.service.appDisplayConfig("say-ring", "ios")).toHaveProperty("moduleVisibility", { ...value, validForSeconds: 300 });
  });
  it.each([null, { schemaVersion: 2 }, { schemaVersion: 1, modules: { health_library: "true", mall: true } }, { schemaVersion: 1, modules: { health_library: true, mall: true, payment: true } }])("closes malformed values without poisoning physiology", async value => {
    const health = sayRingIosHealthDisplayOrClosed(); health.metrics.heart_rate = true;
    const h = harness([{ key: sayRingIosHealthSettingKey, public: true, value: health }, { key: "say_ring_ios_module_display", public: true, value }]);
    const result = await h.service.appDisplayConfig("say-ring", "ios");
    expect(result).toHaveProperty("moduleVisibility", closed);
    expect(result.readOnlyHealth!.metrics.heart_rate).toBe(true);
  });
  it("never reads private module content", async () => {
    const h = harness([{ key: "say_ring_ios_module_display", public: false, get value() { throw new Error("private read"); } }]);
    expect(await h.service.appDisplayConfig("say-ring", "ios")).toHaveProperty("moduleVisibility", closed);
  });
  it("contains module read failure without revoking the independent health lease", async () => {
    const health = sayRingIosHealthDisplayOrClosed(); health.metrics.heart_rate = true;
    const h = harness([]);
    h.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.key === "say_ring_ios_module_display") throw new Error("module query failed");
      return where.key === sayRingIosHealthSettingKey ? { value: health } : null;
    });
    const result = await h.service.appDisplayConfig("say-ring", "ios");
    expect(result).toHaveProperty("moduleVisibility", closed);
    expect(result.readOnlyHealth!.metrics.heart_rate).toBe(true);
  });
});
