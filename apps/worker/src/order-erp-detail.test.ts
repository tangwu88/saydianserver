import { describe, expect, it, vi } from "vitest";
import { CommerceJobWorker } from "./commerce-job-worker";
function fixture() {
  const order = { id: "order-1", orderNo: "VP-001", erpOrderId: "123", executionOwner: "NEW_SYSTEM", status: "WAITING_FULFILLMENT",
    erpStatus: "WAIT_SELLER_SEND_GOODS", version: 1, updatedAt: new Date("2026-10-20T02:00:00Z"), shippedAt: null };
  const prisma: any = { commerceOrder: { findUnique: vi.fn(async () => order), updateMany: vi.fn(async () => ({ count: 1 })) }, commerceShipment: { upsert: vi.fn(async () => ({})) } };
  prisma.$transaction = vi.fn(async (run: any) => run(prisma));
  const worker = new CommerceJobWorker(prisma) as any;
  const settings = { shopId: "77", paths: { orderQuery: "orders.single.query", orderLogs: "order.action.query" } };
  worker.settings = vi.fn(async () => settings);
  const row = { o_id: 123, so_id: "VP-001", shop_id: 77, status: "Sent", l_id: "SF-SYNTHETIC-001", logistics_company: "合成快递", lc_id: "SF", send_date: "2026-10-20 10:30:00" };
  const logs = { datas: [{ o_id: 123, oa_id: 1, name: "发货", created: "2026-10-20 10:30:00", private_secret: "omit" }] };
  worker.call = vi.fn(async (_settings: unknown, method: string) => method === "orders.single.query" ? { orders: [row] } : logs);
  return { order, row, logs, worker, prisma };
}
describe("ERP order status, logs and shipment snapshot", () => {
  it("imports a verified sent order and waybill atomically without touching payment or inventory", async () => {
    const h = fixture();await h.worker.dispatch("JUSHUITAN_ORDER_DETAIL_SYNC", { orderId: h.order.id });
    expect(h.worker.call.mock.calls[0]!.slice(1)).toEqual(["orders.single.query", { shop_id: 77, so_ids: ["VP-001"], page_index: 1, page_size: 50 }]);
    const update = h.prisma.commerceOrder.updateMany.mock.calls[0][0];
    expect(update.where).toMatchObject({ version: 1, erpStatus: "WAIT_SELLER_SEND_GOODS", updatedAt: h.order.updatedAt, erpOrderId: "123" });
    expect(update.data).toMatchObject({ status: "SHIPPED", erpStatus: "Sent", shippedAt: new Date("2026-10-20T02:30:00Z"), erpProcessLogJson: { statusVerified: true, items: [{ name: "发货" }] } });
    const ship = h.prisma.commerceShipment.upsert.mock.calls[0][0];
    expect(ship.where).toEqual({ orderId_trackingNo: { orderId: h.order.id, trackingNo: "SF-SYNTHETIC-001" } });
    expect(ship.create).toMatchObject({ logisticsCompany: "合成快递", logisticsCode: "SF" });
    expect(JSON.stringify(update.data)).not.toContain("private_secret");
    expect(update.data).not.toHaveProperty("paidAt");expect(update.data).not.toHaveProperty("payableCents");
    expect(h.prisma.$transaction).toHaveBeenCalledOnce();
  });
  it.each(["AFTER_SALE", "REFUNDED", "CANCELLED", "COMPLETED", "RECEIVED"])("keeps %s transaction state while importing actual logistics", async status => {
    const h = fixture();h.order.status = status;await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceOrder.updateMany.mock.calls[0][0].data).not.toHaveProperty("status");
    expect(h.prisma.commerceShipment.upsert).toHaveBeenCalledOnce();
  });
  it("does not treat label creation or warehouse processing as actual shipment", async () => {
    const h = fixture();h.row.status = "Delivering";await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceOrder.updateMany.mock.calls[0][0].data).toMatchObject({ erpStatus: "Delivering" });
    expect(h.prisma.commerceOrder.updateMany.mock.calls[0][0].data).not.toHaveProperty("status");
    expect(h.prisma.commerceShipment.upsert).not.toHaveBeenCalled();
  });
  it.each(["shop_id", "so_id", "o_id"])("discards a foreign %s instead of overwriting status or cache", async field => {
    const h = fixture();Object.assign(h.row, { [field]: "foreign" });
    await expect(h.worker.syncOrderLogs(h.order.id, true)).rejects.toThrow("identity");
    expect(h.prisma.commerceOrder.updateMany).not.toHaveBeenCalled();expect(h.prisma.commerceShipment.upsert).not.toHaveBeenCalled();
  });
  it("does not replace prior status when the log read fails after a successful status query", async () => {
    const h = fixture();h.worker.call.mockImplementation(async (_: unknown, method: string) => { if (method === "order.action.query") throw Error("provider unavailable");return { orders: [h.row] }; });
    await expect(h.worker.syncOrderLogs(h.order.id, true)).rejects.toThrow("provider unavailable");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
  it("does not overwrite a newer order or write its shipment after a lost compare-and-set", async () => {
    const h = fixture();h.prisma.commerceOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.worker.syncOrderLogs(h.order.id, true)).rejects.toThrow("Order changed");
    expect(h.prisma.commerceShipment.upsert).not.toHaveBeenCalled();
  });
  it("follows complete query pages before accepting the matching order", async () => {
    const h = fixture();h.worker.call.mockReset();h.worker.call.mockResolvedValueOnce({ orders: [], has_next: "1" }).mockResolvedValueOnce({ orders: [h.row], has_next: false }).mockResolvedValueOnce(h.logs);
    await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.worker.call.mock.calls[1][2].page_index).toBe(2);expect(h.prisma.commerceShipment.upsert).toHaveBeenCalledOnce();
  });
  it("keeps successful provider traces when refreshing an already known waybill", async () => {
    const h = fixture();await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceShipment.upsert.mock.calls[0][0].update).not.toHaveProperty("traceJson");
  });
});

describe("ERP cancellation and carrier traces", () => {
  it("syncs an ERP cancellation without touching funds, stock or gift redemption", async () => {
    const h = fixture(); h.row.status = "Cancelled";
    await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED", erpStatus: "Cancelled", version: { increment: 1 } });
    const data = h.prisma.commerceOrder.updateMany.mock.calls[0][0].data;
    for (const field of ["paidAt", "cancelledAt", "payableCents", "giftCardSerial", "shippedAt"]) expect(data).not.toHaveProperty(field);
    expect(h.prisma.commerceShipment.upsert).not.toHaveBeenCalled();
  });
  it.each(["AFTER_SALE", "REFUNDED", "COMPLETED", "RECEIVED", "CLOSED", "PENDING_PAYMENT"])("does not replace %s with ERP cancellation", async status => {
    const h = fixture(); h.row.status = "Cancelled"; h.order.status = status;
    await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceOrder.updateMany.mock.calls[0][0].data).not.toHaveProperty("status");
  });
  it("imports only matching carrier traces and discards raw provider secrets", async () => {
    const h = fixture(); const settings = await h.worker.settings(); settings.paths.fulfillment = "logistic.query";
    h.worker.call.mockImplementation(async (_:unknown, method:string) => method === "orders.single.query" ? { orders: [h.row] } : method === "order.action.query" ? h.logs : { datas: [
      { so_id: "foreign", l_id: h.row.l_id, data: [{ context: "别人的轨迹" }] },
      { so_id: h.order.orderNo, o_id: 999, l_id: h.row.l_id, data: [{ context: "别人的ERP订单" }] },
      { so_id: h.order.orderNo, shop_id: 999, l_id: h.row.l_id, data: [{ context: "别人的店铺" }] },
      { so_id: h.order.orderNo, l_id: h.row.l_id, secret: "private", data: [{ context: "快递已揽收", ftime: "2026-10-20 11:00:00", token: "private" }] },
    ] });
    await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceShipment.upsert.mock.calls[0][0].update.traceJson).toEqual([{ description: "快递已揽收", time: "2026-10-20 11:00:00" }]);
  });
  it("keeps the confirmed shipment and existing traces when carrier lookup is unavailable", async () => {
    const h = fixture(); (await h.worker.settings()).paths.fulfillment = "logistic.query";
    h.worker.call.mockImplementation(async (_:unknown, method:string) => { if (method === "logistic.query") throw Error("provider failure"); return method === "orders.single.query" ? { orders:[h.row] } : h.logs; });
    await h.worker.syncOrderLogs(h.order.id, true);
    expect(h.prisma.commerceOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status:"SHIPPED", erpProcessLogJson:{ logisticsUnavailable:true } });
    expect(h.prisma.commerceShipment.upsert.mock.calls[0][0].update).not.toHaveProperty("traceJson");
  });
});

it("imports official orders pagination and multiple confirmed packages without accepting foreign orders", async () => {
  const h=fixture(); (await h.worker.settings()).paths.fulfillment="logistic.query";
  let page=0;
  h.worker.call.mockImplementation(async (_:unknown, method:string) => method==="orders.single.query"?{orders:[h.row]}:method==="order.action.query"?h.logs:++page===1?
    {orders:[{...h.row,l_id:"PACKAGE-A",traces:[{context:"包裹A已揽收",time:"2026-10-27 10:00:00"}]},{...h.row,so_id:"foreign",l_id:"FOREIGN"}],has_next:true}:
    {orders:[{...h.row,l_id:"PACKAGE-B",data:[{context:"包裹B运输中",time:"2026-10-27 11:00:00"}]}],has_next:false});
  await h.worker.syncOrderLogs(h.order.id,true);
  expect(page).toBe(2);
  expect(h.prisma.commerceShipment.upsert.mock.calls.map((call:any[])=>call[0].create.trackingNo)).toEqual([h.row.l_id,"PACKAGE-A","PACKAGE-B"]);
  expect(h.prisma.commerceShipment.upsert.mock.calls[2][0].create.traceJson).toEqual([{description:"包裹B运输中",time:"2026-10-27 11:00:00"}]);
});
