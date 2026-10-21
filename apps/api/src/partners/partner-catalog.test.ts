import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PartnerAdminService } from "./partner-admin.service";
import { PartnerCommerceService } from "./partner-commerce.service";

const levelId = randomUUID(), skuId = randomUUID(), productId = randomUUID();
function harness() {
  const product = { id: productId, name: "商城商品", displayName: null, source: "ERP", status: "PUBLISHED", localArchived: false, erpItemId: "same-spu" };
  const sku = { id: skuId, productId, erpSkuId: "same-erp-sku", specification: "商城规格", salePriceCents: 20000, stock: 10, enabled: true, product };
  let record: any = null;
  const tx: any = {
    $executeRaw: vi.fn(),
    partnerLevel: { findUnique: vi.fn(async () => ({ id: levelId })) },
    commerceSku: { findUnique: vi.fn(async () => sku), findMany: vi.fn(async () => [sku]), count: vi.fn(async () => 1) },
    partnerSkuPrice: {
      createMany: vi.fn(async ({ data }: any) => { if (record) return { count: 0 }; record = { ...data[0], updatedAt: new Date() }; return { count: 1 }; }),
      findUnique: vi.fn(async () => record),
      upsert: vi.fn(async ({ update, create }: any) => record = { ...(record ? { ...record, ...update } : create), updatedAt: new Date() }),
      deleteMany: vi.fn(async ({ where }: any) => { if (record?.levelId !== where.levelId || record?.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 }; record = null; return { count: 1 }; }),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: any) => typeof fn === "function" ? fn(tx) : Promise.all(fn)) };
  return { service: new PartnerAdminService(prisma as any, {} as any), prisma, tx, sku, get record() { return record; } };
}
describe("partner catalog import and binding", () => {
  it("imports disabled snapshots, preserves ERP identity and does not overwrite edited entries on repeat", async () => {
    const h = harness(), original = structuredClone(h.sku);
    expect(await h.service.importPrices("actor", levelId, { skuIds: [skuId] }, "request")).toEqual({ imported: 1, skipped: 0 });
    expect(h.record).toMatchObject({ skuId, levelId, productName: "商城商品", specification: "商城规格", retailPriceCents: 20000, enabled: false });
    await h.service.savePrice("actor", levelId, skuId, { productName: "伙伴定制名", specification: "礼盒规格", retailPriceCents: 30000, priceCents: 12000, enabled: true, updatedAt: h.record.updatedAt.toISOString() }, "edit");
    expect(await h.service.importPrices("actor", levelId, { skuIds: [skuId] }, "repeat")).toEqual({ imported: 0, skipped: 1 });
    expect(h.record).toMatchObject({ productName: "伙伴定制名", specification: "礼盒规格", priceCents: 12000, retailPriceCents: 30000 });
    expect(h.sku).toEqual(original);
    expect(h.tx.commerceSku.findMany.mock.calls[0][0].where).toMatchObject({ product: { localArchived: false } });
  });
  it.each([{ skuIds: [] }, { skuIds: [skuId, skuId] }, { skuIds: ["not-uuid"] }, { skuIds: Array(101).fill(skuId) }])("rejects invalid import selections before transactions", async ({ skuIds }) => {
    const h = harness(); await expect(h.service.importPrices("actor", levelId, { skuIds }, "request")).rejects.toThrow();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("rejects missing source rows, binding changes, invalid prices and stale edits", async () => {
    const h = harness();
    h.tx.commerceSku.findMany.mockResolvedValueOnce([]);
    await expect(h.service.importPrices("actor", levelId, { skuIds: [skuId] }, "request")).rejects.toThrow("已删除");
    await h.service.importPrices("actor", levelId, { skuIds: [skuId] }, "request");
    const body = { priceCents: 100, updatedAt: h.record.updatedAt.toISOString() };
    await expect(h.service.savePrice("actor", levelId, skuId, { ...body, erpSkuId: "different" }, "request")).rejects.toThrow("不能更换");
    await expect(h.service.savePrice("actor", levelId, skuId, { ...body, retailPriceCents: -1 }, "request")).rejects.toThrow("零售价");
    await expect(h.service.savePrice("actor", levelId, skuId, { ...body, updatedAt: "2000-01-01" }, "request")).rejects.toThrow("已变化");
  });
  it("rejects stale deletion and removes only the matching level configuration", async () => {
    const h = harness(); await h.service.importPrices("actor", levelId, { skuIds: [skuId] }, "request");
    await expect(h.service.deletePrices("actor", levelId, { items: [{ skuId, updatedAt: "2000-01-01" }] }, "stale")).rejects.toThrow("已变化");
    expect(h.record).not.toBeNull();
    expect(await h.service.deletePrices("actor", levelId, { items: [{ skuId, updatedAt: h.record.updatedAt.toISOString() }] }, "remove")).toEqual({ deleted: 1 });
    expect(h.sku.erpSkuId).toBe("same-erp-sku");
    expect(h.tx.auditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "PARTNER_PRODUCTS_REMOVED" }) }));
  });
  it("uses partner display overrides and original ERP SKU together in quotes", async () => {
    const h = harness(); await h.service.importPrices("actor", levelId, { skuIds: [skuId] }, "request");
    const price = { ...h.record, productName: "伙伴名称", specification: "伙伴规格", enabled: true, sku: h.sku };
    const tx: any = { brandPartner: { findFirst: vi.fn(async () => ({ id: "partner", active: true, levelId, level: { active: true, name: "测试等级" } })) }, partnerSkuPrice: { findMany: vi.fn(async () => [price]) }, commerceBusinessConfig: { findUnique: vi.fn(async () => null) } };
    const service = new PartnerCommerceService({ $transaction: (fn: any) => fn(tx) } as any);
    const result = await service.quote("partner", { items: [{ skuId, quantity: 1 }] });
    expect(result.lines[0]).toMatchObject({ name: "伙伴名称", specification: "伙伴规格", erpSkuId: "same-erp-sku", skuId, productId });
    price.productName = "再次修改";
    expect((await service.quote("partner", { items: [{ skuId, quantity: 1 }] })).fingerprint).not.toBe(result.fingerprint);
  });
  it.each([0, -1])("rejects new quotes and orders at stock %s before any order or money write", async (stock) => {
    const h = harness();
    h.sku.stock = stock;
    const create = vi.fn();
    const tx: any = {
      $executeRaw: vi.fn(), $queryRaw: vi.fn(),
      brandPartner: { findFirst: vi.fn(async () => ({ levelId, level: { active: true, name: "合成等级" } })) },
      partnerSkuPrice: { findMany: vi.fn(async () => [{ skuId, priceCents: 500, sku: h.sku }]) },
      commerceOrder: { findUnique: vi.fn(async () => null), create },
    };
    const service = new PartnerCommerceService({ $transaction: (fn: any) => fn(tx) } as any);
    const items = [{ skuId, quantity: 1 }];
    await expect(service.quote("partner", { items })).rejects.toThrow("暂无库存");
    await expect(service.createOrder("partner", {
      items, expectedQuote: "a".repeat(64), idempotencyKey: randomUUID(),
      address: { recipientName: "合成买家", recipientMobile: "19900000000", province: "测试省", city: "测试市", addressDetail: "测试地址" },
    })).rejects.toThrow("暂无库存");
    expect(create).not.toHaveBeenCalled();
  });
});
