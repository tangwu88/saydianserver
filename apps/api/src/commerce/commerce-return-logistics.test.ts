import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CommerceStoreService } from "./commerce-store.service";
import { CommerceService } from "./commerce.service";

function logisticsFixture() {
  const sale: any = { id: "sale", orderId: "order", executionOwner: "NEW_SYSTEM", type: "RETURN_REFUND", status: "WAITING_RETURN", version: 2,
    returnLogisticsCompany: null, returnTrackingNo: null, order: { executionOwner: "NEW_SYSTEM" }, items: [] };
  const tx = { $queryRaw: vi.fn(),
    commerceAfterSale: {
      findFirst: vi.fn().mockResolvedValue(sale),
      findUniqueOrThrow: vi.fn().mockResolvedValue(sale),
      updateMany: vi.fn().mockImplementation(async ({ data }) => { Object.assign(sale, data, { version: sale.version + 1 }); return { count: 1 }; }),
    },
  };
  const prisma = { $transaction: vi.fn(async work => work(tx)) };
  return { service: new CommerceStoreService(prisma as any), sale, tx };
}
describe("customer return logistics", () => {
  const input = { logisticsCompany: "顺丰速运", trackingNo: "SF1234567890", version: 2 };
  it("records a parcel without marking goods received and safely repeats the same old-version request", async () => {
    const { service, sale, tx } = logisticsFixture();
    await service.submitReturnLogistics("user", "order", "sale", input);
    await service.submitReturnLogistics("user", "order", "sale", input);
    expect(sale).toMatchObject({ status: "WAITING_RETURN", version: 3, returnLogisticsCompany: "顺丰速运", returnTrackingNo: "SF1234567890" });
    expect(tx.commerceAfterSale.updateMany).toHaveBeenCalledOnce();
    expect(tx.commerceAfterSale.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ status: expect.anything() }) }));
    expect(tx.commerceAfterSale.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sale", orderId: "order", order: { userId: "user" } } }));
    expect(tx.$queryRaw).toHaveBeenCalled();
  });
  it("does not overwrite a changed parcel using a stale version or accept a future version", async () => {
    const { service, tx } = logisticsFixture();
    await service.submitReturnLogistics("user", "order", "sale", input);
    await expect(service.submitReturnLogistics("user", "order", "sale", { ...input, trackingNo: "SF-OTHER" })).rejects.toThrow("已更新");
    await expect(service.submitReturnLogistics("user", "order", "sale", { ...input, version: 100 })).rejects.toThrow("已更新");
    expect(tx.commerceAfterSale.updateMany).toHaveBeenCalledOnce();
  });
  it("requires ownership, waiting-return status and transferred records", async () => {
    const { service, tx, sale } = logisticsFixture();
    tx.commerceAfterSale.findFirst.mockResolvedValueOnce(null);
    await expect(service.submitReturnLogistics("other", "order", "sale", input)).rejects.toThrow("不存在");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    sale.status = "RETURNED";
    await expect(service.submitReturnLogistics("user", "order", "sale", input)).rejects.toThrow("等待退货");
    sale.status = "WAITING_RETURN"; sale.executionOwner = "LEGACY_SYSTEM";
    await expect(service.submitReturnLogistics("user", "order", "sale", input)).rejects.toThrow("接管");
    expect(tx.commerceAfterSale.updateMany).not.toHaveBeenCalled();
  });
  it("rejects excessive lengths and control characters before the transaction", async () => {
    const { service, tx } = logisticsFixture();
    await expect(service.submitReturnLogistics("user", "order", "sale", { ...input, logisticsCompany: "长".repeat(81) })).rejects.toThrow("80");
    await expect(service.submitReturnLogistics("user", "order", "sale", { ...input, trackingNo: "A".repeat(101) })).rejects.toThrow("100");
    await expect(service.submitReturnLogistics("user", "order", "sale", { ...input, trackingNo: "SF\u0000123" })).rejects.toThrow("控制字符");
    expect(tx.commerceAfterSale.findFirst).not.toHaveBeenCalled();
  });
  it("reuses canonical order resolution for the compatibility route", async () => {
    const store = { submitReturnLogistics: vi.fn().mockResolvedValue({ status: "WAITING_RETURN" }) };
    const service = new CommerceService({} as any, store as any, {} as any);
    vi.spyOn(service as any, "resolveCanonicalOrder").mockResolvedValue({ id: "canonical" });
    await service.forUser("u", "POST", "/orders/old-order/after-sales/sale/return-logistics", input);
    expect(store.submitReturnLogistics).toHaveBeenCalledWith("u", "canonical", "sale", input);
  });
});

describe("completed-order review idempotency", () => {
  it("allows COMPLETED orders and returns the first stored review without overwriting it", async () => {
    const original = { id: "review", userId: "u", content: "第一次评价", rating: 5 };
    const prisma = { commerceOrderItem: { findFirst: vi.fn().mockResolvedValue({ id: "item", productId: "product" }) },
      commerceReview: { findUnique: vi.fn().mockResolvedValue(original), create: vi.fn() } };
    const result = await new CommerceStoreService(prisma as any).createReview("u", { orderItemId: "item", content: "改写", rating: 1 });
    expect(result).toEqual(original);
    expect(prisma.commerceReview.create).not.toHaveBeenCalled();
    expect(prisma.commerceOrderItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ order: { userId: "u", status: { in: ["RECEIVED", "COMPLETED", "CLOSED"] } } }) }));
  });
  it("recovers a concurrent unique-key conflict by returning the already committed original", async () => {
    const original = { id: "review", userId: "u", content: "并发先提交的评价" };
    const prisma = { commerceOrderItem: { findFirst: vi.fn().mockResolvedValue({ id: "item", productId: "product" }) },
      commerceReview: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(original),
        create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" })) } };
    await expect(new CommerceStoreService(prisma as any).createReview("u", { orderItemId: "item", content: "后提交评价" })).resolves.toEqual(original);
  });
  it("does not expose another owner's item or review", async () => {
    const prisma = { commerceOrderItem: { findFirst: vi.fn().mockResolvedValue(null) }, commerceReview: { findUnique: vi.fn(), create: vi.fn() } };
    await expect(new CommerceStoreService(prisma as any).createReview("other", { orderItemId: "item", content: "评论" })).rejects.toThrow("不可评价");
    expect(prisma.commerceReview.findUnique).not.toHaveBeenCalled();
  });
});
