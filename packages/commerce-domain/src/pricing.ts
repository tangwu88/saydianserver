import { ConflictException } from "@nestjs/common";

export const PRICING_VERSION = 1;
export const MAX_CENTS = 2_147_483_647;
export function cents(value: unknown, label = "金额"): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_CENTS) {
    throw new ConflictException(label + "必须为非负整数分");
  }
  return value;
}
const sum = (values: number[]) => cents(values.reduce((total, value) => total + cents(value), 0), "合计");
export function allocateLargestRemainder(total: number, weights: Array<{ key: string; amount: number }>): Map<string, number> {
  cents(total);
  if (new Set(weights.map(row => row.key)).size !== weights.length) throw new ConflictException("分摊标识重复");
  const denominator = sum(weights.map(row => row.amount));
  if (total > denominator) throw new ConflictException("分摊金额超过基数");
  if (!denominator) return new Map(weights.map(row => [row.key, 0]));
  const rows = weights.map(row => {
    const numerator = BigInt(total) * BigInt(row.amount);
    return { key: row.key, value: Number(numerator / BigInt(denominator)), residue: numerator % BigInt(denominator) };
  });
  let remainder = total - rows.reduce((value, row) => value + row.value, 0);
  const sorted = [...rows].sort((a, b) => a.residue === b.residue ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.residue > b.residue ? -1 : 1);
  for (const row of sorted) if (remainder > 0) { row.value += 1; remainder -= 1; }
  return new Map(rows.map(row => [row.key, row.value]));
}
export type PricingLine = { skuId: string; quantity: number; unitPriceCents: number; totalCents: number;
  couponDiscountCentsSnapshot: number; pointDiscountCentsSnapshot: number; cashPaidCentsSnapshot: number };
export function priceOrder(input: {
  items: Array<{ skuId: string; quantity: number; unitPriceCents: number }>;
  couponDiscountCents: number; pointDiscountCents: number; shippingCents: number; availablePointCents: number | null;
}) {
  if (!input.items.length) throw new ConflictException("请选择商品");
  const rows = input.items.map(row => {
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > 999) throw new ConflictException("商品数量无效");
    return { ...row, totalCents: cents(cents(row.unitPriceCents) * row.quantity) };
  }).sort((a, b) => a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0);
  const subtotalCents = sum(rows.map(row => row.totalCents));
  const couponDiscountCents = cents(input.couponDiscountCents);
  const pointDiscountCents = cents(input.pointDiscountCents);
  const shippingCents = cents(input.shippingCents);
  if (couponDiscountCents > subtotalCents) throw new ConflictException("优惠券金额超过商品金额");
  const afterCoupon = subtotalCents - couponDiscountCents;
  const availablePointCents = input.availablePointCents === null ? null : cents(input.availablePointCents);
  const maxPointCents = availablePointCents === null ? 0 : Math.min(availablePointCents, Math.max(0, afterCoupon - (shippingCents === 0 ? 1 : 0)));
  if (pointDiscountCents > maxPointCents) throw new ConflictException(availablePointCents === null ? "积分余额尚未核验" : "积分抵扣超过余额或可抵商品金额，现金至少保留1分");
  const payableCents = cents(afterCoupon - pointDiscountCents + shippingCents);
  if (payableCents < 1) throw new ConflictException("现金应付至少保留1分");
  const coupons = allocateLargestRemainder(couponDiscountCents, rows.map(row => ({ key: row.skuId, amount: row.totalCents })));
  const points = allocateLargestRemainder(pointDiscountCents, rows.map(row => ({ key: row.skuId, amount: row.totalCents - coupons.get(row.skuId)! })));
  const lines: PricingLine[] = rows.map(row => ({ ...row, couponDiscountCentsSnapshot: coupons.get(row.skuId)!,
    pointDiscountCentsSnapshot: points.get(row.skuId)!, cashPaidCentsSnapshot: row.totalCents - coupons.get(row.skuId)! - points.get(row.skuId)! }));
  return { pricingVersion: PRICING_VERSION, subtotalCents, couponDiscountCents, pointDiscountCents, shippingCents, payableCents, availablePointCents, maxPointCents, lines };
}
export type FinancialItem = { id: string; quantity: number; totalCents: number; couponDiscountCentsSnapshot?: number | null;
  pointDiscountCentsSnapshot?: number | null; cashPaidCentsSnapshot?: number | null };
export type FinancialOrder = { sourceSystem: string; pricingVersion: number | null; pricingVerifiedAt: Date | null;
  subtotalCents: number; discountCents: number; pointDiscountCents: number; shippingCents: number; payableCents: number; items: FinancialItem[] };
export type FinancialSnapshot = { pricingVersion: number; items: Array<FinancialItem & { couponDiscountCentsSnapshot: number;
  pointDiscountCentsSnapshot: number; cashPaidCentsSnapshot: number }> };
export function financialSnapshot(order: FinancialOrder): FinancialSnapshot {
  const original = sum(order.items.map(item => item.totalCents));
  if (order.discountCents + order.pointDiscountCents > original || original !== cents(order.subtotalCents) || original - cents(order.discountCents) - cents(order.pointDiscountCents) + cents(order.shippingCents) !== cents(order.payableCents)) {
    throw new ConflictException("订单原始金额不守恒，请先核验");
  }
  if (order.pricingVersion !== PRICING_VERSION || !order.pricingVerifiedAt) {
    // Only explicitly canonical zero-point orders retain the pre-snapshot cash-only behavior.
    if (order.sourceSystem !== "canonical" || order.pointDiscountCents !== 0) throw new ConflictException("历史积分分摊快照尚未核验");
    const sorted = [...order.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const cash = order.payableCents - order.shippingCents;
    let remainder = cash;
    return { pricingVersion: 0, items: sorted.map((item, index) => {
      const value = index === sorted.length - 1 ? remainder : original ? Number(BigInt(cash) * BigInt(item.totalCents) / BigInt(original)) : 0;
      remainder -= value;
      return { ...item, couponDiscountCentsSnapshot: item.totalCents - value, pointDiscountCentsSnapshot: 0, cashPaidCentsSnapshot: value };
    }) };
  }
  const items = order.items.map(item => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new ConflictException("订单商品数量尚未核验");
    const coupon = cents(item.couponDiscountCentsSnapshot, "券分摊"), points = cents(item.pointDiscountCentsSnapshot, "积分分摊"), cash = cents(item.cashPaidCentsSnapshot, "现金分摊");
    if (coupon + points + cash !== item.totalCents) throw new ConflictException("商品分摊快照不守恒");
    return { ...item, couponDiscountCentsSnapshot: coupon, pointDiscountCentsSnapshot: points, cashPaidCentsSnapshot: cash };
  });
  if (sum(items.map(item => item.couponDiscountCentsSnapshot)) !== order.discountCents ||
      sum(items.map(item => item.pointDiscountCentsSnapshot)) !== order.pointDiscountCents ||
      sum(items.map(item => item.cashPaidCentsSnapshot)) !== order.payableCents - order.shippingCents) throw new ConflictException("订单分摊合计不匹配");
  return { pricingVersion: PRICING_VERSION, items };
}
export function cumulativeQuantitySlice(total: number, originalQuantity: number, completedQuantity: number, quantity: number): number {
  cents(total);
  if (![originalQuantity, completedQuantity, quantity].every(Number.isSafeInteger) || originalQuantity < 1 || completedQuantity < 0 || quantity < 1 || completedQuantity + quantity > originalQuantity) {
    throw new ConflictException("售后数量超过剩余可申请数量");
  }
  return Number(BigInt(total) * BigInt(completedQuantity + quantity) / BigInt(originalQuantity) - BigInt(total) * BigInt(completedQuantity) / BigInt(originalQuantity));
}
export type PreviousSale = { id: string; type: string; status: string; settledAt?: Date | null; shippingRefundCents?: number | null;
  items: Array<{ orderItemId: string; quantity: number; amountCents: number; pointReturnCents?: number | null }> };
export function quoteAfterSale(order: FinancialOrder & { afterSales: PreviousSale[] }, requested: Array<{ orderItemId: string; quantity?: number }>, type: string) {
  if (!["REFUND_ONLY", "RETURN_REFUND", "EXCHANGE"].includes(type)) throw new ConflictException("仅后台财务可申请单独退运费");
  const snapshot = financialSnapshot(order);
  const allPrior = order.afterSales.filter(sale => !["REJECTED", "CANCELLED"].includes(sale.status));
  const prior = allPrior.filter(sale => sale.type !== "SHIPPING_ONLY");
  if (prior.some(sale => !sale.items.length)) throw new ConflictException("历史售后行项目尚未核验");
  if (!requested.length || new Set(requested.map(row => row.orderItemId)).size !== requested.length) throw new ConflictException("请选择不重复的售后商品");
  const items = requested.map(row => {
    const item = snapshot.items.find(candidate => candidate.id === row.orderItemId);
    if (!item) throw new ConflictException("售后商品不属于本订单");
    const related = prior.filter(sale => sale.items.some(line => line.orderItemId === item.id));
    // One in-flight claim per order item fixes the cumulative rounding range until settlement/rejection.
    if (related.some(sale => sale.status !== "COMPLETED")) throw new ConflictException("该商品已有处理中售后，数量及金额仍占用");
    const returned = related.filter(sale => sale.type !== "EXCHANGE").flatMap(sale => sale.items.filter(line => line.orderItemId === item.id));
    const usedQuantity = returned.reduce((total, line) => total + line.quantity, 0);
    if (snapshot.pricingVersion === PRICING_VERSION && returned.length) {
      const previousCash = sum(returned.map(line => line.amountCents)), previousPoints = sum(returned.map(line => cents(line.pointReturnCents, "历史售后积分")));
      const expectedCash = Number(BigInt(item.cashPaidCentsSnapshot) * BigInt(usedQuantity) / BigInt(item.quantity));
      const expectedPoints = Number(BigInt(item.pointDiscountCentsSnapshot) * BigInt(usedQuantity) / BigInt(item.quantity));
      if (previousCash !== expectedCash || previousPoints !== expectedPoints) throw new ConflictException("历史售后分摊尚未核验");
    }
    const remaining = item.quantity - usedQuantity;
    const quantity = row.quantity ?? remaining;
    let cash = cumulativeQuantitySlice(item.cashPaidCentsSnapshot, item.quantity, usedQuantity, quantity);
    const points = cumulativeQuantitySlice(item.pointDiscountCentsSnapshot, item.quantity, usedQuantity, quantity);
    if (snapshot.pricingVersion === 0 && quantity === remaining) cash = Math.max(0, item.cashPaidCentsSnapshot - returned.reduce((total, line) => total + line.amountCents, 0));
    return { orderItemId: item.id, quantity, amountCents: type === "EXCHANGE" ? 0 : cash, pointReturnCents: type === "EXCHANGE" ? 0 : points };
  });
  const wholeFirstOrder = allPrior.length === 0 && items.length === snapshot.items.length && items.every(line => line.quantity === snapshot.items.find(item => item.id === line.orderItemId)!.quantity);
  const shippingRefundCents = type === "EXCHANGE" ? 0 : wholeFirstOrder ? order.shippingCents : 0;
  const merchandiseRefundCents = sum(items.map(item => item.amountCents));
  return { pricingVersion: snapshot.pricingVersion, items, merchandiseRefundCents, shippingRefundCents,
    requestedCents: sum([merchandiseRefundCents, shippingRefundCents]), pointReturnCents: sum(items.map(item => item.pointReturnCents)) };
}
export function afterSaleAvailability(order: FinancialOrder & { afterSales: PreviousSale[] }) {
  const snapshot = financialSnapshot(order);
  return snapshot.items.map(item => {
    try {
      const quote = quoteAfterSale(order, [{ orderItemId: item.id }], "REFUND_ONLY");
      const line = quote.items[0]!;
      return { orderItemId: item.id, quantityRemaining: line.quantity, cashRemainingCents: line.amountCents, pointRemainingCents: line.pointReturnCents };
    } catch (error) {
      return { orderItemId: item.id, quantityRemaining: 0, cashRemainingCents: 0, pointRemainingCents: 0, unavailableReason: error instanceof Error ? error.message : "尚不可申请" };
    }
  });
}

export function allItemsReturned(order: { items: Array<{ id: string; quantity: number }>; afterSales: PreviousSale[] }): boolean {
  if (!order.items.length || order.afterSales.some(sale => sale.type !== "SHIPPING_ONLY" && !["REJECTED", "CANCELLED", "COMPLETED"].includes(sale.status))) return false;
  const completed = order.afterSales.filter(sale => sale.status === "COMPLETED" && !["EXCHANGE", "SHIPPING_ONLY"].includes(sale.type));
  return order.items.every(item => completed.flatMap(sale => sale.items).filter(line => line.orderItemId === item.id)
    .reduce((quantity, line) => quantity + line.quantity, 0) === item.quantity);
}
