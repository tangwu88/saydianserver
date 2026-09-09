import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { cents, financialSnapshot, type FinancialOrder } from "./pricing";

type Refund = { id: string; afterSaleId?: string | null; status: string; amountCents: number };
type Sale = { id: string; type: string; status: string; pricingVersion: number | null;
  requestedCents: number; shippingRefundCents: number | null; refunds: Refund[] };
type Payment = { id: string; executionOwner: string; status: string; amountCents: number; refunds: Refund[] };
type ShippingOrder = FinancialOrder & { id: string; executionOwner: string; paidAt: Date | null; afterSales: Sale[]; paymentIntents: Payment[] };
const moneyStatuses = ["CREATED", "PROCESSING", "SUCCEEDED"];
const paidStatuses = ["SUCCEEDED", "REFUNDING", "PARTIAL_REFUNDED", "REFUNDED"];

/** An after-sale reserves cash from application through settlement; provider rows are not counted twice. */
export function computeShippingRefundCapacity(order: ShippingOrder, excludeAfterSaleId?: string) {
  if (order.executionOwner !== "NEW_SYSTEM" || !order.paidAt) throw new ConflictException("原订单尚未确认付款或未接管");
  const pricing = financialSnapshot(order);
  const paid = order.paymentIntents.filter(payment => paidStatuses.includes(payment.status));
  if (paid.length !== 1 || paid[0]!.executionOwner !== "NEW_SYSTEM" || paid[0]!.amountCents !== order.payableCents) throw new ConflictException("原支付关系或金额尚未核验");
  const payment = paid[0]!;
  let shippingReservedCents = 0, cashReservedCents = 0;
  const knownClaims = new Set(excludeAfterSaleId ? [excludeAfterSaleId] : []);
  for (const sale of order.afterSales) {
    if (sale.id === excludeAfterSaleId) continue;
    const refunds = sale.refunds.filter(refund => moneyStatuses.includes(refund.status));
    if (["REJECTED", "CANCELLED"].includes(sale.status)) {
      if (refunds.length) throw new ConflictException("已拒绝或取消的售后仍有资金占用，请先对账");
      continue;
    }
    if (sale.type === "EXCHANGE") {
      if (refunds.length) throw new ConflictException("换货存在异常现金退款，请先对账");
      continue;
    }
    if (sale.type === "SHIPPING_ONLY" && sale.status !== "COMPLETED") throw new ConflictException("已有处理中运费申请，请处理原申请");
    if (sale.pricingVersion == null || sale.shippingRefundCents == null) throw new ConflictException("历史退款运费分摊尚未核验");
    const shipping = cents(sale.shippingRefundCents, "已占用运费"), cash = cents(sale.requestedCents, "已占用现金");
    if (shipping > cash) throw new ConflictException("历史退款现金与运费不匹配");
    const committed = refunds.reduce((sum, refund) => sum + cents(refund.amountCents), 0);
    const successful = refunds.filter(refund => refund.status === "SUCCEEDED").reduce((sum, refund) => sum + refund.amountCents, 0);
    if (committed > cash || (sale.status === "COMPLETED" && successful !== cash)) throw new ConflictException("历史售后现金结算尚未核验");
    shippingReservedCents += shipping; cashReservedCents += cash; knownClaims.add(sale.id);
  }
  for (const refund of payment.refunds.filter(refund => moneyStatuses.includes(refund.status))) {
    if (!refund.afterSaleId || !knownClaims.has(refund.afterSaleId)) throw new ConflictException("存在未核验的独立现金退款，禁止推算可退运费");
  }
  const shippingRemainingCents = order.shippingCents - cents(shippingReservedCents);
  const cashRemainingCents = payment.amountCents - cents(cashReservedCents);
  if (shippingRemainingCents < 0 || cashRemainingCents < 0) throw new ConflictException("历史退款已超过原支付，请先对账");
  return { pricingVersion: pricing.pricingVersion, shippingReservedCents, cashReservedCents, shippingRemainingCents,
    cashRemainingCents, maximumCents: Math.min(shippingRemainingCents, cashRemainingCents) };
}

/** Caller holds CommerceOrder lock for writes; preview is advisory and rechecked on creation/execution. */
export async function shippingRefundCapacity(tx: Prisma.TransactionClient, orderId: string, excludeAfterSaleId?: string) {
  const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: orderId }, include: {
    items: true, afterSales: { include: { refunds: true } }, paymentIntents: { include: { refunds: true } },
  } });
  return { order, ...computeShippingRefundCapacity(order, excludeAfterSaleId) };
}
