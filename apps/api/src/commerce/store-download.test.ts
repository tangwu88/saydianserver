import { expect, it, vi } from "vitest";
import { AdminService } from "../admin/admin.service";
import { CommerceStoreService } from "./commerce-store.service";
import { defaultStoreDownload, STORE_DOWNLOAD_KEY } from "@saydian/app-contracts";
it("publishes only the explicit storefront presentation allowlist including download config", async () => {
  const configs = { findMany: vi.fn(async () => [{ key: STORE_DOWNLOAD_KEY, enabled: false, value: defaultStoreDownload }]) };
  const db: any = { commerceBanner: { findMany: async () => [] }, commerceCategory: { findMany: async () => [] }, commerceProduct: { findMany: async () => [] }, commerceBusinessConfig: configs };
  const result = await new CommerceStoreService(db).bootstrap();
  expect(configs.findMany).toHaveBeenCalledWith({ where: { key: { in: ["store.name", "store.notice", STORE_DOWNLOAD_KEY, "customer.service", "policies"] } } });
  expect(result.configs[STORE_DOWNLOAD_KEY]?.enabled).toBe(false);
});
it("validates download URLs before an admin config write and preserves other config behavior", async () => {
  const upsert = vi.fn(async (value: any) => value), context = { prisma: { commerceBusinessConfig: { upsert } } };
  const save = (key: string, body: unknown) => AdminService.prototype.updateCommerceBusinessConfig.call(context as any, key, body);
  await expect(save(STORE_DOWNLOAD_KEY, { value: { cnUrl: "https://evil.test/down" }, enabled: true })).rejects.toThrow();
  expect(upsert).not.toHaveBeenCalled();
  await save(STORE_DOWNLOAD_KEY, { label: "首页 APP 下载入口", value: {}, enabled: true });
  expect(upsert.mock.calls[0]?.[0].create.value).toEqual(defaultStoreDownload);
  await save("shipping.default", { value: { amountCents: 500 }, enabled: true });
  expect(upsert.mock.calls[1]?.[0].create.value).toEqual({ amountCents: 500 });
});
