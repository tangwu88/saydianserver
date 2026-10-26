import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { AdminService } from "./admin.service";

// Explicit loopback fixture only. Refuse pre-existing map rows rather than overwriting them.
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")(
  "Say Ring map PostgreSQL FK and rollback acceptance",
  () => {
    const syntheticKey = "a".repeat(32);
    const replacement = "b".repeat(32);
    let prisma: PrismaClient;
    let ownsFixture = false;
    let secrets: IntegrationSecretsService;
    let service: AdminService;
    async function cleanup() {
      await prisma.$transaction([
        prisma.appSetting.deleteMany({ where: { key: "say_ring_map" } }),
        prisma.integrationSecret.deleteMany({
          where: { integrationKey: "say_ring_amap" },
        }),
        prisma.integrationConfig.deleteMany({
          where: { key: "say_ring_amap" },
        }),
      ]);
    }
    const input = (webServiceKey = syntheticKey) => ({
      value: { enabled: true },
      public: true,
      webServiceKey,
    });
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !/test/i.test(url.pathname)
      )
        throw new Error("Only a loopback test database is allowed");
      prisma = new PrismaClient();
      const existing = await Promise.all([
        prisma.appSetting.findUnique({ where: { key: "say_ring_map" } }),
        prisma.integrationConfig.findUnique({
          where: { key: "say_ring_amap" },
        }),
        prisma.integrationSecret.findUnique({
          where: { integrationKey: "say_ring_amap" },
        }),
      ]);
      if (existing.some(Boolean))
        throw new Error("Existing map configuration retained; fixture refused");
      ownsFixture = true;
      vi.stubEnv("INTEGRATION_MASTER_KEY", randomBytes(32).toString("hex"));
      secrets = new IntegrationSecretsService(prisma as any);
      service = new AdminService(prisma as any, secrets);
    });
    beforeEach(async () => {
      if (ownsFixture) await cleanup();
    });
    afterAll(async () => {
      if (ownsFixture) await cleanup();
      if (prisma) await prisma.$disconnect();
      vi.unstubAllEnvs();
    });

    it("reproduces the former secret-only first-save foreign-key failure", async () => {
      await expect(
        secrets.save("say_ring_amap", { webServiceKey: syntheticKey }),
      ).rejects.toMatchObject({ code: "P2003" });
      expect(
        await prisma.integrationSecret.count({
          where: { integrationKey: "say_ring_amap" },
        }),
      ).toBe(0);
    });

    it("saves a new map with the real FK, encrypted storage and a redacted public setting", async () => {
      const saved = await service.updateSetting("say_ring_map", input());
      expect(saved).toMatchObject({
        public: true,
        value: { provider: "amap", enabled: true, configured: true },
      });
      const ciphertext = await prisma.integrationSecret.findUniqueOrThrow({
        where: { integrationKey: "say_ring_amap" },
      });
      expect(ciphertext.ciphertext).not.toContain(syntheticKey);
      expect(await secrets.read("say_ring_amap")).toEqual({
        webServiceKey: syntheticKey,
      });
      expect(JSON.stringify(saved)).not.toContain(syntheticKey);
      const parent = await prisma.integrationConfig.findUniqueOrThrow({
        where: { key: "say_ring_amap" },
      });
      expect(parent.state).toBe("UNCONFIGURED");
      expect(parent.lastCheckedAt).toBeNull();
    });

    it("keeps credentials and existing integration metadata on a blank-key toggle", async () => {
      await service.updateSetting("say_ring_map", input());
      await prisma.integrationConfig.update({
        where: { key: "say_ring_amap" },
        data: { state: "DISABLED", publicConfig: { retained: true } },
      });
      const before = await prisma.integrationSecret.findUniqueOrThrow({
        where: { integrationKey: "say_ring_amap" },
      });
      await service.updateSetting("say_ring_map", {
        value: { enabled: false },
        public: false,
        webServiceKey: " ",
      });
      expect(
        await prisma.integrationSecret.findUniqueOrThrow({
          where: { integrationKey: "say_ring_amap" },
        }),
      ).toEqual(before);
      expect(
        await prisma.integrationConfig.findUniqueOrThrow({
          where: { key: "say_ring_amap" },
        }),
      ).toMatchObject({ state: "DISABLED", publicConfig: { retained: true } });
    });

    function failingFinalWrite() {
      const db = {
        $transaction: (callback: any) =>
          prisma.$transaction((tx) =>
            callback({
              integrationConfig: tx.integrationConfig,
              integrationSecret: tx.integrationSecret,
              appSetting: {
                upsert: () => {
                  throw new Error("synthetic final setting write failure");
                },
              },
            }),
          ),
      };
      return new AdminService(db as any, secrets);
    }

    it("rolls back parent and secret when first publication fails", async () => {
      await expect(
        failingFinalWrite().updateSetting("say_ring_map", input()),
      ).rejects.toMatchObject({
        response: { errorKey: "say_ring_map_save_failed" },
      });
      expect(
        await prisma.integrationConfig.count({
          where: { key: "say_ring_amap" },
        }),
      ).toBe(0);
      expect(
        await prisma.integrationSecret.count({
          where: { integrationKey: "say_ring_amap" },
        }),
      ).toBe(0);
      expect(
        await prisma.appSetting.count({ where: { key: "say_ring_map" } }),
      ).toBe(0);
    });

    it("rolls back a replacement key and retains the previous published configuration", async () => {
      await service.updateSetting("say_ring_map", input());
      const before = await prisma.integrationSecret.findUniqueOrThrow({
        where: { integrationKey: "say_ring_amap" },
      });
      const previous = await prisma.appSetting.findUniqueOrThrow({
        where: { key: "say_ring_map" },
      });
      await expect(
        failingFinalWrite().updateSetting("say_ring_map", input(replacement)),
      ).rejects.toMatchObject({
        response: { errorKey: "say_ring_map_save_failed" },
      });
      expect(
        await prisma.integrationSecret.findUniqueOrThrow({
          where: { integrationKey: "say_ring_amap" },
        }),
      ).toEqual(before);
      expect(
        await prisma.appSetting.findUniqueOrThrow({
          where: { key: "say_ring_map" },
        }),
      ).toEqual(previous);
      expect(await secrets.read("say_ring_amap")).toEqual({
        webServiceKey: syntheticKey,
      });
    });
  },
);
