import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createLocalShipment, localFulfillmentPreview } from "./local-fulfillment";

const a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222";
const operator={id:"operator",role:"COMMERCE_OPERATIONS",roles:["COMMERCE_OPERATIONS"]};
function fixture(): any { return { id:"order",version:0,status:"PAID",sourceSystem:"canonical",executionOwner:"NEW_SYSTEM",erpOrderId:null,erpShopId:null,paidAt:new Date("2026-09-08"),shippedAt:null,receivedAt:null,
  items:[{id:a,quantity:3,nameSnapshot:"LOCAL A",product:{source:"LOCAL"}},{id:b,quantity:2,nameSnapshot:"LOCAL B",product:{source:"LOCAL"}}],shipments:[],afterSales:[] }; }
const request=(items:Array<{orderItemId:string;quantity:number}>,overrides:Record<string,unknown>={})=>({version:0,logisticsCompany:"本地测试快递",trackingNo:"DEMO-SHIP-001",items,...overrides});
function mock(initial=fixture()) {
  let state=structuredClone(initial),locked=false,serial=0; const audits: any[]=[];
  const tx={
    $queryRaw:async()=>{locked=true;},
    commerceOrder:{
      findUnique:async()=>structuredClone(state),
      findUniqueOrThrow:async()=>structuredClone(state),
      updateMany:async({where,data}:any)=>{assert(locked);if(where.version!==state.version)return{count:0};state={...state,...data,version:state.version+1};return{count:1};},
    },
    commerceShipment:{create:async({data}:any)=>{assert(locked);const value={id:"shipment-"+(++serial),...data,items:data.items.create,traceJson:null,deliveredAt:null};state.shipments.push(value);return structuredClone(value);}},
    auditLog:{create:async({data}:any)=>{audits.push(data);return data;}},
  } as unknown as Prisma.TransactionClient;
  return {tx,audits,get:()=>state};
}
const rejects=(action:()=>Promise<unknown>,status:number)=>assert.rejects(action,(error:any)=>error.getStatus?.()===status);
describe("local shipment transaction",()=>{
  it("limits writes to current operator roles and canonical LOCAL paid ownership",async()=>{
    const body=request([{orderItemId:a,quantity:1}]);
    await rejects(()=>createLocalShipment(mock().tx,"order",body,{...operator,role:"SUPER_ADMIN",roles:["READ_ONLY"]}),403);
    for(const role of ["FINANCE","CUSTOMER_SERVICE","APP_OPERATIONS"]) await rejects(()=>createLocalShipment(mock().tx,"order",body,{...operator,role,roles:[role]}),403);
    for(const changes of [{executionOwner:"LEGACY_SYSTEM"},{sourceSystem:"legacy_mall"},{erpOrderId:"ERP-001"},{erpShopId:"SHOP-001"},{paidAt:null},{status:"PENDING_PAYMENT"},{status:"CANCELLED"},{status:"REFUNDED"}]) {
      await rejects(()=>createLocalShipment(mock({...fixture(),...changes}).tx,"order",body,operator),409);
    }
    const mixed=fixture();mixed.items[1].product.source="ERP";
    await rejects(()=>createLocalShipment(mock(mixed).tx,"order",body,operator),409);
  });
  it("locks and records two packages; exact replay creates no parcel, trace or audit",async()=>{
    const db=mock(), body=request([{orderItemId:a,quantity:1}]);
    const first=await createLocalShipment(db.tx,"order",body,operator);
    assert.equal(first.status,"WAITING_FULFILLMENT");
    assert.equal(first.version,1);assert.equal(db.get().shippedAt,null);
    assert.deepEqual(first.items.map(item=>item.remainingQuantity),[2,2]);
    assert.equal((await createLocalShipment(db.tx,"order",body,operator)).replayed,true);
    assert.equal(db.audits.length,1);assert.equal(db.audits[0].actorId,operator.id);
    await rejects(()=>createLocalShipment(db.tx,"order",request([{orderItemId:a,quantity:2}]),operator),409);
    await rejects(()=>createLocalShipment(db.tx,"order",request([{orderItemId:b,quantity:1}],{trackingNo:"NEW-STALE",version:0}),operator),409);
    await rejects(()=>createLocalShipment(db.tx,"order",request([{orderItemId:a,quantity:3}],{trackingNo:"NEW-TOO-MANY",version:1}),operator),409);
    const second=await createLocalShipment(db.tx,"order",request([{orderItemId:a,quantity:2},{orderItemId:b,quantity:2}],{version:1,trackingNo:"DEMO-SHIP-002"}),operator);
    assert.equal(second.status,"SHIPPED");assert.equal(second.version,2);
    assert.deepEqual(second.items.map(item=>item.remainingQuantity),[0,0]);assert.equal(db.get().shipments.length,2);
    assert.equal(db.get().shippedAt instanceof Date,true);assert.equal(db.audits.length,2);
    for(const parcel of db.get().shipments){assert.equal(parcel.traceJson,null);assert.equal(parcel.deliveredAt,null);}
    assert.equal((await createLocalShipment(db.tx,"order",body,operator)).replayed,true);
  });
  it("blocks foreign items, pending after-sale quantities, old parcels and completed ambiguous refunds",async()=>{
    await rejects(()=>createLocalShipment(mock().tx,"order",request([{orderItemId:"33333333-3333-4333-8333-333333333333",quantity:1}]),operator),409);
    const pending=fixture();pending.afterSales=[{type:"REFUND_ONLY",status:"REFUNDING",items:[{orderItemId:a,quantity:2}]}];
    const db=mock(pending);
    await rejects(()=>createLocalShipment(db.tx,"order",request([{orderItemId:a,quantity:2}]),operator),409);
    assert.equal((await createLocalShipment(db.tx,"order",request([{orderItemId:a,quantity:1}]),operator)).status,"AFTER_SALE");
    const ambiguous=fixture();ambiguous.shipments=[{id:"old",logisticsCompany:"旧包裹",trackingNo:"OLD-001",shippedAt:new Date("2026-09-08"),items:[{orderItemId:a,quantity:1}]}];
    ambiguous.afterSales=[{type:"RETURN_REFUND",status:"COMPLETED",settledAt:new Date("2026-09-09"),items:[{orderItemId:a,quantity:1}]}];
    const unknown=mock(ambiguous);
    await rejects(()=>createLocalShipment(unknown.tx,"order",request([{orderItemId:a,quantity:1}]),operator),409);
    const preview=await localFulfillmentPreview(unknown.tx,"order",operator);
    assert.match(preview.unavailableReason!,/人工复核/);assert.deepEqual(preview.items,[]);
    ambiguous.shipments[0].items=[];
    await rejects(()=>createLocalShipment(mock(ambiguous).tx,"order",request([{orderItemId:a,quantity:1}]),operator),409);
  });
});
