import { describe, expect, it } from "vitest";
import { partnerOrderStatus } from "./present";
describe("partner order ERP display", () => {
  it("shows actual warehouse processing instead of a stale local waiting label", () => {
    expect(partnerOrderStatus({ status: "WAITING_FULFILLMENT", erpOrderId: "123", erpStatus: "Delivering" })).toBe("发货中");
    expect(partnerOrderStatus({ status: "WAITING_FULFILLMENT", erpOrderId: "123", erpStatus: "Sent" })).toBe("已发货");
  });
  it("keeps financial and receipt state when ERP shipment has also been imported", () => {
    expect(partnerOrderStatus({ status: "AFTER_SALE", erpOrderId: "123", erpStatus: "Sent" })).toBe("售后处理中");
    expect(partnerOrderStatus({ status: "REFUNDED", erpOrderId: "123", erpStatus: "Sent" })).toBe("已退款");
  });
  it("shows unknown provider status verbatim rather than inventing processing or success", () => {
    expect(partnerOrderStatus({ status: "WAITING_FULFILLMENT", erpOrderId: "123", erpStatus: "ProviderNewState" })).toBe("ProviderNewState");
    expect(partnerOrderStatus({ status: "PENDING_PAYMENT" })).toBe("待付款");
  });
});
