export const erpStatuses: Record<string, string> = {
  WaitPay: "待付款", Delivering: "发货中", Merged: "已合并", Question: "异常",
  Split: "已拆分", WaitOuterSent: "等待外仓发货", WaitConfirm: "已付款待审核",
  WaitFConfirm: "待财务审核", Sent: "已发货", Cancelled: "已取消",
  WAIT_SELLER_SEND_GOODS: "等待发货", WAIT_BUYER_CONFIRM_GOODS: "已发货，等待收货",
  TRADE_FINISHED: "交易完成", TRADE_CLOSED: "交易关闭", SENT: "已发货",
};
const orderLabels: Record<string, string> = {
  PENDING_PAYMENT: "待付款", PAID: "待发货", WAITING_FULFILLMENT: "待发货",
  ERP_SYNCING: "履约处理中", SHIPPED: "已发货", RECEIVED: "已收货", COMPLETED: "已完成",
  CANCELLED: "已取消", CLOSED: "已关闭", AFTER_SALE: "售后处理中", REFUNDED: "已退款",
};
export function commerceErpStatus(value: unknown): string {
  const code = String(value ?? "").trim();
  return erpStatuses[code] || code || "尚未同步";
}
export function commerceOrderStatus(order: { status?: string; erpOrderId?: string | null; erpStatus?: string | null }): string {
  const status = order.status || "";
  if (["AFTER_SALE", "REFUNDED", "CANCELLED", "CLOSED", "RECEIVED", "COMPLETED", "PENDING_PAYMENT"].includes(status))
    return orderLabels[status] || status;
  // Do not regress an actual shipment to an older warehouse preparation snapshot.
  if (status === "SHIPPED" && order.erpStatus !== "Cancelled") return orderLabels.SHIPPED!;
  return order.erpOrderId && order.erpStatus ? commerceErpStatus(order.erpStatus) : orderLabels[status] || status || "状态未获取";
}
export function erpCancelledPaidOrder(order: { status: string; erpStatus?: string | null; paidAt?: unknown }): boolean {
  return order.status === "CANCELLED" && order.erpStatus === "Cancelled" && !!order.paidAt;
}
/** Fulfilment only: never settle/refund money, release stock, or reactivate a redeemed card. */
export function erpOrderTransition(status: string, erpStatus: string, confirmedShipment: boolean): "CANCELLED" | "SHIPPED" | undefined {
  if (!["PAID", "WAITING_FULFILLMENT", "SHIPPED"].includes(status)) return;
  if (erpStatus === "Cancelled" && status !== "CANCELLED") return "CANCELLED";
  if (erpStatus === "Sent" && confirmedShipment && status !== "SHIPPED") return "SHIPPED";
}
export type CommerceLogisticsTrace = { description: string; time: string };
/** Only carrier-returned tracking events; never expose arbitrary provider payloads. */
export function commerceLogisticsTraces(value: unknown): CommerceLogisticsTrace[] {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const nested = obj.data && typeof obj.data === "object" ? obj.data as Record<string, unknown> : {};
  const events = [value, obj.traces, obj.data, obj.Traces, nested.traces, nested.Traces].find(Array.isArray) as unknown[] | undefined;
  const result: CommerceLogisticsTrace[] = [], seen = new Set<string>();
  for (const event of (events || []).slice(0, 200)) {
    if (!event || typeof event !== "object") continue;
    const row = event as Record<string, unknown>;
    const text = (keys: string[], max: number) => {
      const entry = keys.map(key => row[key]).find(v => typeof v === "string" && v.trim());
      return typeof entry === "string" ? entry.trim().slice(0, max) : "";
    };
    const description = text(["description", "context", "content", "accept_station", "AcceptStation"], 1000);
    const time = text(["time", "ftime", "accept_time", "AcceptTime"], 80);
    const key = time + "\n" + description;
    if (description && !seen.has(key)) { seen.add(key); result.push({ description, time }); }
  }
  return result;
}
