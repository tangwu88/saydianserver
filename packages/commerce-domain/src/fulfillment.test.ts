import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { fulfillmentProgress, orderFulfillmentState, parseShipment, sameShipment, type FulfillmentOrder } from "./fulfillment";

const a = "11111111-1111-4111-8111-111111111111";
function order(): FulfillmentOrder {
  return { id:"o",version:0,status:"PAID",shippedAt:null,items:[{id:a,quantity:3}],shipments:[],afterSales:[] };
}
const parcel = (quantity: number) => ({ logisticsCompany:"本地测试快递",trackingNo:"DEMO-0001",shippedAt:new Date("2026-09-08"),items:[{orderItemId:a,quantity}] });
describe("local manual package policy", () => {
  it("keeps partial shipments waiting and marks full quantities shipped", () => {
    const value=order(); value.shipments=[parcel(1)];
    assert.equal(fulfillmentProgress(value).items[0]!.remainingQuantity,2);
    assert.deepEqual(orderFulfillmentState(value),{status:"WAITING_FULFILLMENT"});
    value.shipments.push({...parcel(2),trackingNo:"DEMO-0002"});
    assert.equal(fulfillmentProgress(value).allShipped,true);
    assert.equal(orderFulfillmentState(value).status,"SHIPPED");
  });
  it("reserves in-progress merchandise quantities but excludes shipping-only amounts", () => {
    const value=order(); value.afterSales=[{type:"REFUND_ONLY",status:"REFUNDING",items:[{orderItemId:a,quantity:2}]},{type:"SHIPPING_ONLY",status:"APPROVED",items:[]}];
    assert.equal(fulfillmentProgress(value).items[0]!.remainingQuantity,1);
    assert.equal(fulfillmentProgress(value).hasOpenAfterSale,true);
    value.afterSales[0]!.status="REJECTED";
    assert.equal(fulfillmentProgress(value).items[0]!.remainingQuantity,3);
  });
  it("blocks unverified historical parcel allocations and foreign item quantities", () => {
    const value=order(); value.shipments=[{...parcel(1),items:[]}];
    assert.throws(()=>fulfillmentProgress(value),/历史包裹/);
    value.shipments=[{...parcel(1),items:[{orderItemId:"foreign",quantity:1}]}];
    assert.throws(()=>fulfillmentProgress(value),/归属/);
    value.shipments=[parcel(4)]; assert.throws(()=>fulfillmentProgress(value),/超过/);
  });
  it("blocks ambiguous completed after-sales after partial shipment instead of guessing ownership", () => {
    const value=order(); value.shipments=[parcel(1)];
    value.afterSales=[{type:"RETURN_REFUND",status:"COMPLETED",settledAt:new Date("2026-09-09"),items:[{orderItemId:a,quantity:1}]}];
    assert.throws(()=>fulfillmentProgress(value),/人工复核/);
    assert.equal(orderFulfillmentState(value).status,"WAITING_FULFILLMENT");
    value.afterSales[0]!.settledAt=new Date("2026-09-07");
    assert.equal(fulfillmentProgress(value).items[0]!.remainingQuantity,1);
  });
  it("does not accept unsafe tracking text, negative/fractional counts, duplicate lines or stale-shaped versions", () => {
    const valid={version:0,logisticsCompany:"本地测试快递",trackingNo:"DEMO-123",items:[{orderItemId:a,quantity:1}]};
    for(const bad of [{...valid,version:"0"},{...valid,trackingNo:"abc\n123"},{...valid,trackingNo:"x".repeat(101)},{...valid,logisticsCompany:"a\u200bb"},
      {...valid,items:[{orderItemId:a,quantity:0}]},{...valid,items:[{orderItemId:a,quantity:1.5}]},{...valid,items:[...valid.items,...valid.items]}]) assert.throws(()=>parseShipment(bad));
    const parsed=parseShipment(valid);
    assert.equal(sameShipment({...parcel(1),trackingNo:valid.trackingNo},parsed),true);
    assert.equal(sameShipment({...parcel(2),trackingNo:valid.trackingNo},parsed),false);
  });
});
