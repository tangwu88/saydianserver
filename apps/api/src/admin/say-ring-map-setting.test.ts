import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { writeSayRingMapSetting } from "./say-ring-map-setting";
import { SafeHttpExceptionFilter } from "../common/http-exception.filter";

const syntheticKey = "a".repeat(32);
function harness(existing = false) {
  const order: string[] = [];
  let hasSecret = existing;
  const tx = {
    integrationConfig: {
      upsert: vi.fn(async () => {
        order.push("parent");
        return {};
      }),
    },
    integrationSecret: {
      upsert: vi.fn(async () => {
        order.push("secret");
        hasSecret = true;
        return {};
      }),
      findUnique: vi.fn(async () =>
        hasSecret ? { integrationKey: "say_ring_amap" } : null,
      ),
    },
    appSetting: {
      upsert: vi.fn(async (args: any) => {
        order.push("setting");
        return args.create;
      }),
    },
  };
  const prisma = { $transaction: vi.fn(async (callback: any) => callback(tx)) };
  const secrets = {
    prepare: vi.fn(() => {
      order.push("encrypt");
      return {
        ciphertext: "encrypted-fixture",
        iv: "iv",
        authTag: "tag",
        keyVersion: 1,
      };
    }),
  };
  return {
    tx,
    prisma,
    secrets,
    order,
    save: (input: unknown) =>
      writeSayRingMapSetting(prisma as any, secrets as any, input),
  };
}
const enabled = (webServiceKey?: string) => ({
  value: { enabled: true },
  public: true,
  ...(webServiceKey === undefined ? {} : { webServiceKey }),
});

describe("Say Ring map atomic configuration", () => {
  it("encrypts before the transaction, inserts the FK parent before its secret and publishes last", async () => {
    const h = harness();
    const saved = await h.save(enabled(` ${syntheticKey} `));
    expect(h.order).toEqual(["encrypt", "parent", "secret", "setting"]);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.secrets.prepare).toHaveBeenCalledWith("say_ring_amap", {
      webServiceKey: syntheticKey,
    });
    expect(h.tx.integrationConfig.upsert).toHaveBeenCalledWith({
      where: { key: "say_ring_amap" },
      create: {
        key: "say_ring_amap",
        state: "UNCONFIGURED",
        publicConfig: { provider: "amap" },
      },
      update: {},
    });
    expect(saved).toEqual({
      key: "say_ring_map",
      value: { provider: "amap", enabled: true, configured: true },
      public: true,
    });
    expect(JSON.stringify(saved)).not.toContain(syntheticKey);
    expect(
      JSON.stringify(h.tx.integrationSecret.upsert.mock.calls),
    ).not.toContain(syntheticKey);
  });

  it("keeps the encrypted key and parent metadata untouched when the key is blank", async () => {
    const h = harness(true);
    expect(await h.save(enabled("  "))).toMatchObject({
      value: { configured: true },
    });
    expect(h.secrets.prepare).not.toHaveBeenCalled();
    expect(h.tx.integrationConfig.upsert).not.toHaveBeenCalled();
    expect(h.tx.integrationSecret.upsert).not.toHaveBeenCalled();
  });

  it("does not accept a client configured=true flag without stored credentials", async () => {
    const h = harness();
    await expect(
      h.save({ value: { enabled: true, configured: true }, public: true }),
    ).rejects.toMatchObject({
      response: { errorKey: "say_ring_map_key_required" },
    });
    expect(h.tx.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("can save an explicitly disabled map without creating a fake secret", async () => {
    const h = harness();
    const result = await h.save({
      value: { enabled: false, configured: true },
      public: false,
    });
    expect(result).toMatchObject({
      public: false,
      value: { enabled: false, configured: false },
    });
    expect(h.tx.integrationConfig.upsert).not.toHaveBeenCalled();
    expect(h.tx.integrationSecret.upsert).not.toHaveBeenCalled();
  });

  it.each(["invalid-key!", 123, {}, true])(
    "rejects invalid credentials without echoing input or writing",
    async (webServiceKey) => {
      const h = harness();
      await expect(
        h.save({ ...enabled(), webServiceKey }),
      ).rejects.toMatchObject({
        response: { errorKey: "say_ring_map_key_invalid" },
      });
      expect(h.secrets.prepare).not.toHaveBeenCalled();
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid switch types rather than silently publishing defaults", async () => {
    const h = harness();
    await expect(
      h.save({ value: { enabled: "true" }, public: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.save({ value: { enabled: true }, public: "true" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not enter a write transaction when encryption is unavailable", async () => {
    const h = harness();
    h.secrets.prepare.mockImplementation(() => {
      throw new ServiceUnavailableException("private encryption detail");
    });
    await expect(h.save(enabled(syntheticKey))).rejects.toMatchObject({
      response: { errorKey: "say_ring_map_storage_unavailable" },
    });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reports a fixed localized save failure without SQL or secret material", async () => {
    const h = harness();
    h.prisma.$transaction.mockRejectedValueOnce(
      new Error(`SQL-private-detail ${syntheticKey}`),
    );
    let failure: unknown;
    try {
      await h.save(enabled(syntheticKey));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json };
    new SafeHttpExceptionFilter().catch(failure, {
      switchToHttp: () => ({
        getRequest: () => ({
          originalUrl: "/api/saydian-app/admin/v1/settings/say_ring_map",
          requestId: "synthetic-map-request",
        }),
        getResponse: () => response,
      }),
    } as any);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      code: 503,
      errorKey: "say_ring_map_save_failed",
      message: "地图配置保存失败，未更改原配置，请稍后重试",
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain(syntheticKey);
    expect(JSON.stringify(json.mock.calls)).not.toContain("SQL-private-detail");
  });
});
