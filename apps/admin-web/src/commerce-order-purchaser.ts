interface OrderPurchaserSource {
  userId?: string | null;
  partnerId?: string | null;
  user?: { id?: string; nickname?: string | null; mobile?: string | null } | null;
  partner?: { id?: string; name?: string | null; partnerNo?: string | null } | null;
}

/** Use the order owner, never a recipient, order-number prefix or referral relationship. */
export function orderPurchaser(order: OrderPurchaserSource) {
  const partner = Boolean(order.partnerId || order.partner?.id);
  const member = Boolean(order.userId || order.user?.id);
  if (partner === member) return {
    kind: "unknown", label: partner ? "下单身份待核实" : "下单身份未获取",
    name: "—", reference: "", contact: "", tag: "warning" as const,
  };
  if (partner) return {
    kind: "partner", label: "品牌伙伴下单",
    name: order.partner?.name?.trim() || "未命名品牌伙伴",
    reference: order.partner?.partnerNo?.trim() || order.partnerId || order.partner?.id || "",
    contact: "", tag: "primary" as const,
  };
  return {
    kind: "member", label: "会员下单",
    name: order.user?.nickname?.trim() || "未命名会员",
    reference: order.userId || order.user?.id || "",
    contact: order.user?.mobile?.trim() || "", tag: "info" as const,
  };
}
