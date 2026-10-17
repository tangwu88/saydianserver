import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileErpProduct } from "./erp-product-assignment";
import { lookupJushuitanAssignments } from "./jushuitan-product-import";
vi.mock("./jushuitan-product-import", () => ({
  lookupJushuitanAssignments: vi.fn(),
}));
const id = randomUUID(),
  skuA = randomUUID(),
  skuB = randomUUID();
function fixture() {
  const date = new Date("2026-10-17T00:00:00.000Z");
  const source: any = {
    id,
    source: "ERP",
    localArchived: false,
    erpItemId: "sd-ring-R7",
    updatedAt: date,
    skus: [
      {
        id: skuA,
        erpSkuId: "sd-ring-R7-black-7",
        erpItemId: "sd-ring-R7",
        productId: id,
        updatedAt: date,
      },
      {
        id: skuB,
        erpSkuId: "sd-ring-R7y-silver-9",
        erpItemId: "sd-ring-R7",
        productId: id,
        updatedAt: date,
      },
    ],
  };
  const tx: any = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
    commerceProduct: {
      findUnique: vi.fn(async () => source),
      findMany: vi.fn(async () => [source]),
      create: vi.fn(async () => ({ id: "target-product" })),
      findUniqueOrThrow: vi.fn(async () => source),
    },
    commerceSku: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: any) => fn(tx)) };
  vi.mocked(lookupJushuitanAssignments).mockResolvedValue([
    {
      erpSkuId: source.skus[0].erpSkuId,
      erpItemId: "sd-ring-R7",
      name: "屏显款",
    },
    {
      erpSkuId: source.skus[1].erpSkuId,
      erpItemId: "sd-ring-R7y",
      name: "青春款",
      gallery: [],
      tags: [],
    },
  ] as any);
  const call = (input: unknown) =>
    reconcileErpProduct(db as any, {} as any, id, input, "admin", "request");
  return { source, tx, db, call };
}
beforeEach(() => vi.clearAllMocks());
describe("ERP product assignment reconciliation", () => {
  it("previews exact vendor item IDs without creating products or changing SKUs", async () => {
    const h = fixture();
    const preview = await h.call({ action: "preview" });
    expect(preview).toMatchObject({
      changed: 1,
      rows: [
        { erpItemId: "sd-ring-R7", changed: false },
        { erpItemId: "sd-ring-R7y", changed: true, createsDraft: true },
      ],
    });
    expect(h.tx.commerceProduct.create).not.toHaveBeenCalled();
    expect(h.tx.commerceSku.updateMany).not.toHaveBeenCalled();
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it("moves the original SKU ID only, preserving price/stock/history and creating a draft", async () => {
    const h = fixture();
    const preview = await h.call({ action: "preview" });
    const result = await h.call({
      action: "apply",
      fingerprint: (preview as any).fingerprint,
    });
    expect(result).toMatchObject({ changed: 1, newDrafts: ["sd-ring-R7y"] });
    expect(h.tx.commerceProduct.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          erpItemId: "sd-ring-R7y",
          status: "DRAFT",
        }),
      }),
    );
    expect(h.tx.commerceSku.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: skuB,
        productId: id,
        erpItemId: "sd-ring-R7",
        updatedAt: h.source.updatedAt,
      },
      data: { productId: "target-product", erpItemId: "sd-ring-R7y" },
    });
    expect(h.tx.auditLog.create).toHaveBeenCalled();
    expect(h.tx.$queryRaw).toHaveBeenCalled();
  });
  it("rejects changes since preview, including price/stock versions, before writes", async () => {
    const h = fixture();
    const preview = await h.call({ action: "preview" });
    h.source.skus[1].updatedAt = new Date("2026-10-17T00:01:00Z");
    await expect(
      h.call({ action: "apply", fingerprint: (preview as any).fingerprint }),
    ).rejects.toThrow("重新预览");
    expect(h.tx.commerceProduct.create).not.toHaveBeenCalled();
    expect(h.tx.commerceSku.updateMany).not.toHaveBeenCalled();
  });
  it("refuses LOCAL/archived targets and missing provider rows", async () => {
    const h = fixture();
    h.tx.commerceProduct.findMany.mockResolvedValueOnce([
      { ...h.source, source: "LOCAL" },
    ]);
    await expect(h.call({ action: "preview" })).rejects.toThrow("人工核对");
    vi.mocked(lookupJushuitanAssignments).mockResolvedValueOnce([]);
    await expect(h.call({ action: "preview" })).rejects.toThrow("重新核对");
    expect(h.tx.commerceSku.updateMany).not.toHaveBeenCalled();
  });
  it("rejects apply without a preview and detects a lost CAS update", async () => {
    const h = fixture();
    await expect(h.call({ action: "apply" })).rejects.toThrow("先预览");
    const preview = await h.call({ action: "preview" });
    h.tx.commerceSku.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      h.call({ action: "apply", fingerprint: (preview as any).fingerprint }),
    ).rejects.toThrow("重新预览");
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
