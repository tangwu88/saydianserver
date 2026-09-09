import { BadRequestException, ConflictException } from "@nestjs/common";

type Line = { id: string; quantity: number; nameSnapshot?: string; specificationSnapshot?: string | null };
type Parcel = { id?: string; trackingNo: string; logisticsCompany: string; shippedAt: Date | null; items: Array<{ orderItemId: string; quantity: number }> };
type Sale = { type: string; status: string; settledAt?: Date | null; items: Array<{ orderItemId: string; quantity: number }> };
export type FulfillmentOrder = {
  id: string; version: number; status: string; shippedAt: Date | null;
  items: Line[]; shipments: Parcel[]; afterSales: Sale[];
};
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const instant = (value: Date | null | undefined) => value instanceof Date && Number.isFinite(value.valueOf()) ? value.valueOf() : null;

/** Never guess whether a post-shipment refund refers to shipped or unshipped units. */
export function fulfillmentProgress(order: FulfillmentOrder) {
  const shipped = new Map<string, number>(), reserved = new Map<string, number>(), refunded = new Map<string, number>();
  const known = new Map(order.items.map(line => [line.id, line]));
  if (!order.items.length || known.size !== order.items.length || order.items.some(line => !positive(line.quantity))) throw new ConflictException("订单商品数量无法核验");
  for (const parcel of order.shipments) {
    if (!parcel.items.length || instant(parcel.shippedAt) === null) throw new ConflictException("历史包裹缺少商品分包记录，需人工复核后发货");
    for (const item of parcel.items) {
      if (!known.has(item.orderItemId) || !positive(item.quantity)) throw new ConflictException("包裹商品归属或数量异常，需人工复核");
      shipped.set(item.orderItemId, (shipped.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }
  if (order.items.some(line => (shipped.get(line.id) ?? 0) > line.quantity)) throw new ConflictException("历史发货数量超过订单数量，需人工复核");
  const firstShipment = order.shipments.length ? Math.min(...order.shipments.map(parcel => instant(parcel.shippedAt)!)) : null;
  const originallyFullyShipped = order.items.every(line => (shipped.get(line.id) ?? 0) === line.quantity);
  for (const sale of order.afterSales) {
    if (sale.type === "SHIPPING_ONLY" || ["CANCELLED", "REJECTED"].includes(sale.status)) continue;
    if (!sale.items.length) throw new ConflictException("历史售后缺少商品数量记录，需人工复核");
    const settledBeforeShipping = firstShipment === null || (instant(sale.settledAt) !== null && instant(sale.settledAt)! <= firstShipment);
    if (sale.status === "COMPLETED" && firstShipment !== null && !originallyFullyShipped && !settledBeforeShipping) {
      throw new ConflictException("部分发货后完成的售后无法确定已发/未发商品归属，需人工复核，禁止自动推断剩余数量");
    }
    for (const item of sale.items) {
      if (!known.has(item.orderItemId) || !positive(item.quantity)) throw new ConflictException("售后商品归属或数量异常，需人工复核");
      if (sale.status !== "COMPLETED") reserved.set(item.orderItemId, (reserved.get(item.orderItemId) ?? 0) + item.quantity);
      else if (sale.type !== "EXCHANGE" && settledBeforeShipping) refunded.set(item.orderItemId, (refunded.get(item.orderItemId) ?? 0) + item.quantity);
    }
  }
  const items = order.items.map(line => {
    const shippedQuantity = shipped.get(line.id) ?? 0, refundedQuantity = refunded.get(line.id) ?? 0, afterSaleReservedQuantity = reserved.get(line.id) ?? 0;
    if (refundedQuantity + shippedQuantity > line.quantity || refundedQuantity + afterSaleReservedQuantity > line.quantity) throw new ConflictException("发货与售后数量冲突，需人工复核");
    return { orderItemId: line.id, name: line.nameSnapshot ?? "", specification: line.specificationSnapshot ?? "", quantity: line.quantity, shippedQuantity, refundedQuantity, afterSaleReservedQuantity,
      remainingQuantity: Math.max(0, line.quantity - shippedQuantity - refundedQuantity - afterSaleReservedQuantity) };
  });
  const totalToFulfill = items.reduce((sum, line) => sum + line.quantity - line.refundedQuantity, 0);
  const allShipped = totalToFulfill > 0 && items.every(line => line.shippedQuantity === line.quantity - line.refundedQuantity);
  return { items, allShipped, hasOpenAfterSale: order.afterSales.some(sale => !["CANCELLED", "REJECTED", "COMPLETED"].includes(sale.status)) };
}

/** Restore workflow state only; financial totals and external ERP state remain untouched. */
export function orderFulfillmentState(order: FulfillmentOrder & { receivedAt?: Date | null; erpOrderId?: string | null }) {
  if (order.receivedAt) return { status: "COMPLETED" as const };
  if (order.shippedAt) return { status: "SHIPPED" as const };
  if (!order.shipments.length) return { status: order.erpOrderId ? "WAITING_FULFILLMENT" as const : "PAID" as const };
  if (order.shipments.some(parcel => !Array.isArray(parcel.items) || !parcel.items.length)) return { status: order.erpOrderId ? "WAITING_FULFILLMENT" as const : "PAID" as const };
  try {
    const progress = fulfillmentProgress(order);
    if (progress.allShipped) return { status: "SHIPPED" as const, shippedAt: new Date(Math.max(...order.shipments.map(parcel => instant(parcel.shippedAt)!))) };
  } catch { /* Unknown allocation must not mark unshipped goods as shipped. */ }
  return { status: "WAITING_FULFILLMENT" as const };
}

export function parseShipment(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("发货参数必须为对象");
  const body = input as Record<string, unknown>;
  const version = body.version;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) throw new BadRequestException("请提供有效订单版本");
  const logisticsCompany = String(body.logisticsCompany ?? "").trim(), trackingNo = String(body.trackingNo ?? "").trim();
  if (!logisticsCompany || logisticsCompany.length > 60 || /[\p{C}]/u.test(logisticsCompany)) throw new BadRequestException("物流公司须为1至60字且不含控制字符");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,99}$/.test(trackingNo)) throw new BadRequestException("运单号须为3至100位字母、数字、点、下划线或横线");
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw new BadRequestException("请选择1至100个发货商品");
  const ids = new Set<string>();
  const items = body.items.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("发货商品格式不正确");
    const item = value as Record<string, unknown>, orderItemId = String(item.orderItemId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderItemId) || ids.has(orderItemId)) throw new BadRequestException("商品编号格式不正确或重复");
    if (typeof item.quantity !== "number" || !positive(item.quantity) || item.quantity > 2_147_483_647) throw new BadRequestException("发货数量必须为正整数");
    ids.add(orderItemId); return { orderItemId, quantity: item.quantity };
  }).sort((a,b) => a.orderItemId.localeCompare(b.orderItemId));
  return { version, logisticsCompany, trackingNo, items };
}
export function sameShipment(existing: Pick<Parcel,"logisticsCompany"|"items">, requested: ReturnType<typeof parseShipment>): boolean {
  const canonical = (items: Array<{orderItemId:string;quantity:number}>) => JSON.stringify([...items].sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId)).map(item => [item.orderItemId,item.quantity]));
  return existing.logisticsCompany === requested.logisticsCompany && canonical(existing.items) === canonical(requested.items);
}
