import { describe, expect, it, vi } from "vitest";
import { CommerceJobWorker } from "./commerce-job-worker";
function fixture() {
  const order = { id: "partner-order", partnerId: "partner-A", userId: null, orderNo: "VP-SYNTHETIC", executionOwner: "NEW_SYSTEM", status: "PAID",
    createdAt: new Date("2026-10-13T01:00:00Z"), province: "测试省", city: "测试市", district: "测试区", addressDetail: "不发货地址", recipientName: "合成测试", recipientMobile: "19900000000", shippingCents: 100, payableCents: 1100,
    items: [{ id: "line", erpSkuIdSnapshot: "SKU", nameSnapshot: "合成商品", specificationSnapshot: "规格", quantity: 2, unitPriceCents: 500, totalCents: 1000 }],
    paymentIntents: [{ paymentNo: "VB-SYNTHETIC", paidAt: new Date(), channel: "PARTNER_BALANCE", amountCents: 1100, providerMerchantId: null, providerTransactionId: null }] };
  const prisma: any = { commerceOrder: { findUnique: vi.fn(async () => order), update: vi.fn() } };
  const worker = new CommerceJobWorker(prisma) as any;
  worker.settings = vi.fn(async () => ({ shopId: "123", paths: { orderUpload: "jushuitan.orders.upload" } }));
  worker.call = vi.fn(async () => ({ datas: [{ so_id: order.orderNo, o_id: "ERP-SYNTHETIC", issuccess: true }] }));
  return { worker, order };
}
describe("partner balance ERP settlement", () => {
  it("uses the partner identity, locked distribution price and real internal payment reference", async () => { const h = fixture(); await h.worker.uploadOrder(h.order.id); const row = h.worker.call.mock.calls[0][2][0]; expect(row).toMatchObject({ so_id: "VP-SYNTHETIC", shop_buyer_id: "partner:partner-A", pay_amount: 11, items: [{ base_price: 5, amount: 10, qty: 2 }], pay: { outer_pay_id: "VB-SYNTHETIC", payment: "品牌伙伴余额", buyer_account: "partner:partner-A", amount: 11 } }); expect(row.pay).not.toHaveProperty("providerTransactionId"); });
  it("requires exactly one successful settlement with the order amount before dispatch", async () => { const h = fixture(); h.order.paymentIntents[0]!.amountCents = 1000; await expect(h.worker.uploadOrder(h.order.id)).rejects.toThrow("does not match"); expect(h.worker.call).not.toHaveBeenCalled(); h.order.paymentIntents.push({ ...h.order.paymentIntents[0]! }); await expect(h.worker.uploadOrder(h.order.id)).rejects.toThrow("multiple successful"); });
  it("retains the same ERP order/payment identifiers on a retry", async () => { const h = fixture(); await h.worker.uploadOrder(h.order.id); await h.worker.uploadOrder(h.order.id); expect(h.worker.call.mock.calls[0][2][0].so_id).toBe(h.worker.call.mock.calls[1][2][0].so_id); expect(h.worker.call.mock.calls[0][2][0].pay.outer_pay_id).toBe(h.worker.call.mock.calls[1][2][0].pay.outer_pay_id); });
});
