import { describe, expect, it } from "vitest";
import { commerceLogisticsTraces, commerceOrderStatus, erpCancelledPaidOrder, erpOrderTransition } from "./commerce-erp";
describe("ERP fulfilment versus financial state", () => {
  it.each(["PAID", "WAITING_FULFILLMENT", "SHIPPED"])("cancels active %s fulfilment", status => {
    expect(erpOrderTransition(status, "Cancelled", false)).toBe("CANCELLED");
    expect(commerceOrderStatus({ status, erpOrderId: "123", erpStatus: "Cancelled" })).toBe("已取消");
  });
  it.each(["AFTER_SALE", "REFUNDED", "COMPLETED", "RECEIVED", "CANCELLED", "CLOSED", "PENDING_PAYMENT"])("preserves terminal/financial %s state", status => {
    expect(erpOrderTransition(status, "Cancelled", false)).toBeUndefined();
    expect(erpOrderTransition(status, "Sent", true)).toBeUndefined();
  });
  it("requires a confirmed shipment and never downgrades an existing shipped order", () => {
    expect(erpOrderTransition("WAITING_FULFILLMENT", "Sent", false)).toBeUndefined();
    expect(erpOrderTransition("WAITING_FULFILLMENT", "Delivering", true)).toBeUndefined();
    expect(erpOrderTransition("WAITING_FULFILLMENT", "Sent", true)).toBe("SHIPPED");
    expect(commerceOrderStatus({ status: "SHIPPED", erpOrderId: "1", erpStatus: "Delivering" })).toBe("已发货");
  });
  it("keeps paid ERP cancellations eligible for reviewed after-sale without reopening ordinary cancellations", () => {
    expect(erpCancelledPaidOrder({ status:"CANCELLED",erpStatus:"Cancelled",paidAt:new Date() })).toBe(true);
    expect(erpCancelledPaidOrder({ status:"CANCELLED",erpStatus:"WaitPay",paidAt:new Date() })).toBe(false);
    expect(erpCancelledPaidOrder({ status:"CANCELLED",erpStatus:"Cancelled" })).toBe(false);
  });
  it("normalizes only actual carrier events and never invents a tracking event from an ERP label", () => {
    expect(commerceLogisticsTraces({ name:"打印快递单", remark:"SF-synthetic" })).toEqual([]);
    expect(commerceLogisticsTraces({ data:{Traces:[{AcceptStation:"快递已揽收",AcceptTime:"2026-10-27 10:00:00",secret:"omit"},{AcceptStation:"快递已揽收",AcceptTime:"2026-10-27 10:00:00"}]}})).toEqual([{description:"快递已揽收",time:"2026-10-27 10:00:00"}]);
    expect(commerceLogisticsTraces(Array.from({length:300},(_,i)=>({context:String(i)})))).toHaveLength(200);
  });
});
