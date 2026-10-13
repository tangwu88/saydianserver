export function money(cents: unknown) {
  return cents == null ? "未获取" : `¥${(Number(cents) / 100).toFixed(2)}`;
}
export function date(value: unknown) {
  if (!value) return "—";
  const time = new Date(String(value));
  return Number.isFinite(time.getTime())
    ? time.toLocaleString("zh-CN", { hour12: false })
    : "—";
}
export const statuses: Record<string, string> = {
  PENDING_PAYMENT: "待付款",
  PAID: "已付款",
  WAITING_FULFILLMENT: "待发货",
  SHIPPED: "已发货",
  RECEIVED: "已收货",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
  AFTER_SALE: "售后处理中",
  REFUNDED: "已退款",
  PARTIAL_REFUNDED: "部分退款",
  REFUNDING: "退款中",
  CREATED: "待支付",
  PENDING: "待确认",
  SUCCEEDED: "成功",
  FAILED: "失败",
};
export const metrics: Record<string, string> = {
  sleep: "睡眠",
  steps: "步数",
  distance: "距离",
  calories: "热量",
  heart_rate: "心率",
  blood_oxygen: "血氧",
  blood_pressure: "血压",
  blood_glucose: "血糖",
  temperature: "体温",
  hrv: "HRV",
  ecg: "心电",
  body_composition: "身体成分",
  blood_composition: "血液成分",
};
export const ledgerTypes: Record<string, string> = {
  RECHARGE: "在线充值",
  MANUAL_RECHARGE: "后台充值",
  PURCHASE: "采购消费",
  REFUND: "采购退款",
  DEPOSIT_RECEIPT: "保证金收取",
  DEPOSIT_RETURN: "保证金退还",
  DEPOSIT_CORRECTION: "保证金更正",
};
export function measurements(values: unknown) {
  if (!values || typeof values !== "object") return "暂无数据";
  return (
    Object.entries(values)
      .map(
        ([key, value]) =>
          `${key}: ${value == null ? "未知" : typeof value === "object" ? JSON.stringify(value) : String(value)}`,
      )
      .join(" · ") || "暂无数据"
  );
}
