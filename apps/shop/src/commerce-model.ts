export function safeMallRoute(value: unknown): string {
  const route = String(value || "");
  return /^\/pages\/[a-z0-9-]+\/index(?:\?[^#]*)?$/.test(route) && !route.startsWith("/pages/login/") && !/[\\\r\n]/.test(route) ? route : "/pages/profile/index";
}
export function parseMoneyCents(value: unknown): number {
  const text = String(value ?? "").trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) throw new Error("金额最多填写两位小数");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error("金额不正确");
  return cents;
}
export function checkoutFingerprint(userId: string, input: {addressId: string; items: {skuId:string;quantity:number}[];couponClaimId?:string;pointCents?:number;buyerRemark?:string;invoice?:unknown}): string {
  return JSON.stringify({userId,addressId:input.addressId,items:input.items.map(x=>({skuId:x.skuId,quantity:x.quantity})).sort((a,b)=>a.skuId.localeCompare(b.skuId)),couponClaimId:input.couponClaimId||null,pointCents:input.pointCents||0,buyerRemark:input.buyerRemark||"",invoice:input.invoice||null});
}
export function channelsForEnvironment(capabilities: any[], environment: "wechat"|"browser"|"mini", desktop: boolean) {
  const expected = environment === "mini" ? ["wechat_mini"] : environment === "wechat" ? ["wechat_jsapi"] : desktop ? ["wechat_native","alipay_page"] : ["wechat_h5","alipay_wap"];
  return capabilities.filter(item => expected.includes(String(item.channel).toLowerCase()));
}
export function isPaidStatus(value: unknown) { return ["succeeded","partial_refunded","refunded"].includes(String(value).toLowerCase()); }

// Legacy read-only projections may omit items entirely. Missing/invalid item
// detail is unknown, not an empty purchase or a verified zero quantity.
export function orderItemSummary(order: { items?: unknown } | null | undefined): { items: any[]; quantity: number | null } {
  const items = order?.items;
  if (!Array.isArray(items) || !items.length || items.some(item =>
    !item || typeof item !== "object" || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    return { items: [], quantity: null };
  }
  const quantity = items.reduce((total, item) => total + item.quantity, 0);
  return Number.isSafeInteger(quantity) ? { items, quantity } : { items: [], quantity: null };
}
