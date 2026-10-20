export function erpOrderStatus(value: unknown): string {
  const code = String(value ?? "").trim();
  const labels: Record<string, string> = {
    WaitPay: "待付款", Delivering: "发货中", Merged: "已合并", Question: "异常",
    Split: "已拆分", WaitOuterSent: "等待外仓发货", WaitConfirm: "已付款待审核",
    WaitFConfirm: "待财务审核", Sent: "已发货", Cancelled: "已取消",
    WAIT_SELLER_SEND_GOODS: "等待发货", WAIT_BUYER_CONFIRM_GOODS: "已发货待收货",
    TRADE_FINISHED: "交易完成", TRADE_CLOSED: "交易关闭", SENT: "已发货",
  };
  return labels[code] || code || "尚未同步";
}
