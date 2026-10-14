import { describe, expect, it, vi } from "vitest";
import { CommerceJobWorker } from "./commerce-job-worker";
function fixture() {
  const order = {
    id: "partner-order",
    partnerId: "partner-A",
    partner: {
      id: "partner-A",
      partnerNo: "VIP-SYNTHETIC",
      name: "合成品牌伙伴",
    },
    adminRemark: "工作日发货",
    buyerRemark: "请先联系收货人",
    userId: null,
    orderNo: "VP-SYNTHETIC",
    executionOwner: "NEW_SYSTEM",
    status: "PAID",
    createdAt: new Date("2026-10-13T01:00:00Z"),
    province: "测试省",
    city: "测试市",
    district: "测试区",
    addressDetail: "不发货地址",
    recipientName: "合成测试",
    recipientMobile: "19900000000",
    shippingCents: 100,
    payableCents: 1100,
    items: [
      {
        id: "line",
        erpSkuIdSnapshot: "SKU",
        nameSnapshot: "合成商品",
        specificationSnapshot: "规格",
        quantity: 2,
        unitPriceCents: 500,
        totalCents: 1000,
      },
    ],
    paymentIntents: [
      {
        paymentNo: "VB-SYNTHETIC",
        paidAt: new Date(),
        channel: "PARTNER_BALANCE",
        amountCents: 1100,
        providerMerchantId: null,
        providerTransactionId: null,
      },
    ],
  };
  const prisma: any = {
    commerceOrder: { findUnique: vi.fn(async () => order), update: vi.fn() },
  };
  const worker = new CommerceJobWorker(prisma) as any;
  worker.settings = vi.fn(async () => ({
    shopId: "123",
    paths: { orderUpload: "jushuitan.orders.upload" },
  }));
  worker.call = vi.fn(async () => ({
    datas: [{ so_id: order.orderNo, o_id: "ERP-SYNTHETIC", issuccess: true }],
  }));
  return { worker, order, prisma };
}
describe("partner balance ERP settlement", () => {
  it("uses the partner identity, locked distribution price and real internal payment reference", async () => {
    const h = fixture();
    await h.worker.uploadOrder(h.order.id);
    const row = h.worker.call.mock.calls[0][2][0];
    expect(row).toMatchObject({
      so_id: "VP-SYNTHETIC",
      shop_buyer_id: "partner:partner-A",
      pay_amount: 11,
      items: [{ base_price: 5, amount: 10, qty: 2 }],
      pay: {
        outer_pay_id: "VB-SYNTHETIC",
        payment: "品牌伙伴余额",
        buyer_account: "partner:partner-A",
        amount: 11,
      },
    });
    expect(row.pay).not.toHaveProperty("providerTransactionId");
  });
  it("requires exactly one successful settlement with the order amount before dispatch", async () => {
    const h = fixture();
    h.order.paymentIntents[0]!.amountCents = 1000;
    await expect(h.worker.uploadOrder(h.order.id)).rejects.toThrow(
      "does not match",
    );
    expect(h.worker.call).not.toHaveBeenCalled();
    h.order.paymentIntents.push({ ...h.order.paymentIntents[0]! });
    await expect(h.worker.uploadOrder(h.order.id)).rejects.toThrow(
      "multiple successful",
    );
  });
  it("retains the same ERP order/payment identifiers on a retry", async () => {
    const h = fixture();
    await h.worker.uploadOrder(h.order.id);
    await h.worker.uploadOrder(h.order.id);
    expect(h.worker.call.mock.calls[0][2][0].so_id).toBe(
      h.worker.call.mock.calls[1][2][0].so_id,
    );
    expect(h.worker.call.mock.calls[0][2][0].pay.outer_pay_id).toBe(
      h.worker.call.mock.calls[1][2][0].pay.outer_pay_id,
    );
  });
  it("adds trusted partner ID, number and name to ERP remarks and preserves existing remarks", async () => {
    const h = fixture();
    await h.worker.uploadOrder(h.order.id);
    const row = h.worker.call.mock.calls[0][2][0];
    expect(row.remark).toBe(
      "品牌伙伴 ID：partner-A\n品牌伙伴名称：合成品牌伙伴\n品牌伙伴编号：VIP-SYNTHETIC\n工作日发货",
    );
    expect(row.buyer_message).toBe("请先联系收货人");
    expect(h.prisma.commerceOrder.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          partner: { select: { id: true, partnerNo: true, name: true } },
        }),
      }),
    );
  });
  it("rejects an absent or mismatched order partner before sending ERP data", async () => {
    const h = fixture();
    h.order.partner.id = "another-partner";
    await expect(h.worker.uploadOrder(h.order.id)).rejects.toThrow(
      "does not match",
    );
    (h.order as any).partner = null;
    await expect(h.worker.uploadOrder(h.order.id)).rejects.toThrow(
      "identity is missing",
    );
    expect(h.worker.call).not.toHaveBeenCalled();
  });
  it("normalizes partner name control characters into one identity line", async () => {
    const h = fixture();
    h.order.partner.name = "合成\n\t品牌伙伴";
    h.order.adminRemark = "";
    await h.worker.uploadOrder(h.order.id);
    expect(h.worker.call.mock.calls[0][2][0].remark).toBe(
      "品牌伙伴 ID：partner-A\n品牌伙伴名称：合成 品牌伙伴\n品牌伙伴编号：VIP-SYNTHETIC",
    );
  });
  it("keeps the full partner ID and maximum-length name inside the ERP remark limit", async () => {
    const h = fixture();
    h.order.partnerId = h.order.partner.id =
      "00000000-0000-4000-8000-000000000001";
    h.order.partner.name = "名".repeat(80);
    h.order.adminRemark = "备注😀".repeat(100);
    await h.worker.uploadOrder(h.order.id);
    const remark = h.worker.call.mock.calls[0][2][0].remark;
    expect(remark.length).toBeLessThanOrEqual(150);
    expect(remark).toContain(`品牌伙伴 ID：${h.order.partnerId}`);
    expect(remark).toContain(`品牌伙伴名称：${h.order.partner.name}`);
    expect(remark).toMatch(/…$/);
    expect(remark).not.toMatch(/[\ud800-\udbff]…$/);
    expect(h.order.adminRemark).toBe("备注😀".repeat(100));
  });
});
