import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { cents, financialSnapshot, MAX_CENTS, quoteAfterSale, allItemsReturned } from "./pricing";
import { shippingRefundCapacity } from "./shipping";
import { orderFulfillmentState } from "./fulfillment";

function requireOwner(value: { executionOwner: string }) {
  if (value.executionOwner !== "NEW_SYSTEM") throw new ConflictException("交易尚未完成迁移接管");
}
export async function afterSaleSettlementSnapshot(tx: Prisma.TransactionClient, afterSaleId: string) {
  const sale = await tx.commerceAfterSale.findUniqueOrThrow({ where: { id: afterSaleId }, include: { items: true, order: { include: { items: true, afterSales: { include: { items: true } } } }, refunds: true } });
  requireOwner(sale); requireOwner(sale.order);
  const pricing = financialSnapshot(sale.order);
  if (sale.type === "SHIPPING_ONLY") {
    if (!sale.reviewedByAdminId || !sale.reviewedAt || !["APPROVED", "REFUNDING", "COMPLETED"].includes(sale.status)) throw new ConflictException("单独退运费尚未完成财务审核");
    if (sale.pricingVersion !== pricing.pricingVersion || sale.items.length || sale.pointReturnCents !== 0 ||
        cents(sale.shippingRefundCents) !== sale.requestedCents || sale.requestedCents < 1) throw new ConflictException("单独退运费快照不匹配");
    const capacity = await shippingRefundCapacity(tx, sale.orderId, sale.id);
    if (sale.requestedCents > capacity.maximumCents) throw new ConflictException("运费退款超过剩余额度");
    return { sale, merchandiseRefundCents: 0, shippingRefundCents: sale.requestedCents, pointReturnCents: 0, legacyCash: false };
  }
  if (sale.type === "EXCHANGE") throw new ConflictException("换货不执行资金或积分退款");
  if (sale.pricingVersion == null) {
    // Only the original canonical cash-only flow may lack allocation snapshots.
    if (pricing.pricingVersion !== 0 || sale.order.pointDiscountCents !== 0) throw new ConflictException("售后退款分摊尚未核验");
    return { sale, merchandiseRefundCents: Math.min(sale.requestedCents, sale.order.payableCents - sale.order.shippingCents),
      shippingRefundCents: Math.max(0, sale.requestedCents - (sale.order.payableCents - sale.order.shippingCents)), pointReturnCents: 0, legacyCash: true };
  }
  if (sale.pricingVersion !== pricing.pricingVersion || !sale.items.length) throw new ConflictException("售后分摊版本不匹配");
  const shippingRefundCents = cents(sale.shippingRefundCents, "退运费");
  const pointReturnCents = cents(sale.pointReturnCents, "返还积分");
  let merchandiseRefundCents = 0, points = 0;
  const seen = new Set<string>();
  for (const line of sale.items) {
    const item = pricing.items.find(row => row.id === line.orderItemId);
    if (!item || seen.has(line.orderItemId) || line.quantity < 1 || line.quantity > item.quantity) throw new ConflictException("售后商品快照无效");
    seen.add(line.orderItemId);
    if (cents(line.amountCents) > item.cashPaidCentsSnapshot || cents(line.pointReturnCents) > item.pointDiscountCentsSnapshot) throw new ConflictException("售后超过原商品支付金额");
    merchandiseRefundCents += line.amountCents; points += line.pointReturnCents!;
  }
  if (shippingRefundCents > sale.order.shippingCents || merchandiseRefundCents + shippingRefundCents !== sale.requestedCents || points !== pointReturnCents) throw new ConflictException("售后现金与积分合计不匹配");
  if (pricing.pricingVersion === 1 && !sale.settledAt) {
    const expected = quoteAfterSale({ ...sale.order, afterSales: sale.order.afterSales.filter(row => row.id !== sale.id) },
      sale.items.map(row => ({ orderItemId: row.orderItemId, quantity: row.quantity })), sale.type);
    if (expected.requestedCents !== sale.requestedCents || expected.pointReturnCents !== pointReturnCents || expected.shippingRefundCents !== shippingRefundCents ||
        expected.items.some(row => { const line = sale.items.find(item => item.orderItemId === row.orderItemId)!; return line.amountCents !== row.amountCents || line.pointReturnCents !== row.pointReturnCents; })) {
      throw new ConflictException("售后快照与商品累计退还范围不匹配");
    }
  }
  if (pointReturnCents > 0) {
    const account = await tx.commercePointAccount.findUnique({ where: { userId: sale.order.userId } });
    if (!account) throw new ConflictException("积分账户未核验，禁止先向渠道出款");
    if (!sale.settledAt) {
      const already = await tx.commercePointLedger.aggregate({ where: { orderId: sale.orderId, type: { in: ["AFTER_SALE_RETURN", "FULL_REFUND_RETURN", "ORDER_CANCEL_RETURN"] } }, _sum: { deltaCents: true } });
      const applied = await tx.commercePointLedger.findUnique({ where: { idempotencyKey: "points-after-sale:" + sale.id } });
      if (!applied && ((already._sum.deltaCents ?? 0) + pointReturnCents > sale.order.pointDiscountCents || account.balanceCents > MAX_CENTS - pointReturnCents)) throw new ConflictException("累计返还积分或账户余额超过上限，禁止渠道出款");
    }
  }
  return { sale, merchandiseRefundCents, shippingRefundCents, pointReturnCents, legacyCash: false };
}

/** Caller holds the order lock; always inside the cash-confirmation/local-zero-cash transaction. */
export async function settleAfterSalePoints(tx: Prisma.TransactionClient, afterSaleId: string, refundId?: string): Promise<void> {
  const data = await afterSaleSettlementSnapshot(tx, afterSaleId);
  const { sale, pointReturnCents } = data;
  if (sale.type === "SHIPPING_ONLY") {
    if (!refundId || !sale.refunds.some(refund => refund.id === refundId && refund.status === "SUCCEEDED" && refund.amountCents === sale.requestedCents)) throw new ConflictException("运费渠道退款尚未确认");
    if (!sale.settledAt) await tx.commerceAfterSale.update({ where: { id: sale.id }, data: { settledAt: new Date() } });
    return; // A freight concession neither returns points nor writes a point ledger.
  }
  // Preserve historical canonical cash-only partial refunds; they have no point settlement to infer.
  if (data.legacyCash) return;
  if (sale.settledAt) return;
  if (sale.requestedCents > 0) {
    if (!refundId) throw new ConflictException("现金退款尚未确认");
    const refund = sale.refunds.find(row => row.id === refundId && row.status === "SUCCEEDED");
    if (!refund || refund.amountCents !== sale.requestedCents) throw new ConflictException("现金退款金额或状态未确认");
  } else if (!["APPROVED", "RETURNED"].includes(sale.status) || (sale.type === "RETURN_REFUND" && sale.status !== "RETURNED")) {
    throw new ConflictException("纯积分售后尚未达到结算条件");
  }
  const key = "points-after-sale:" + sale.id;
  if (await tx.commercePointLedger.findUnique({ where: { idempotencyKey: key } })) {
    await tx.commerceAfterSale.update({ where: { id: sale.id }, data: { settledAt: new Date() } });
    return;
  }
  if (pointReturnCents > 0) {
    const already = await tx.commercePointLedger.aggregate({ where: { orderId: sale.orderId,
      type: { in: ["AFTER_SALE_RETURN", "FULL_REFUND_RETURN", "ORDER_CANCEL_RETURN"] } }, _sum: { deltaCents: true } });
    if ((already._sum.deltaCents ?? 0) + pointReturnCents > sale.order.pointDiscountCents) throw new ConflictException("累计返还积分超过原订单抵扣，请核验历史退款");
    const changed = await tx.commercePointAccount.updateMany({ where: { userId: sale.order.userId, balanceCents: { lte: MAX_CENTS - pointReturnCents } },
      data: { balanceCents: { increment: pointReturnCents }, version: { increment: 1 } } });
    if (changed.count !== 1) throw new ConflictException("积分账户未迁入或余额超出范围");
  }
  // A zero-point settlement is still recorded to prove that this after-sale was processed.
  await tx.commercePointLedger.create({ data: { userId: sale.order.userId, orderId: sale.orderId, afterSaleId: sale.id,
    ...(refundId ? { refundId } : {}), deltaCents: pointReturnCents, type: "AFTER_SALE_RETURN", idempotencyKey: key } });
  await tx.commerceAfterSale.update({ where: { id: sale.id }, data: { settledAt: new Date() } });
}

export async function settlePointOnlyAfterSale(tx: Prisma.TransactionClient, afterSaleId: string) {
  const initial = await tx.commerceAfterSale.findUniqueOrThrow({ where: { id: afterSaleId } });
  await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${initial.orderId}::uuid FOR UPDATE`;
  const { sale, pointReturnCents } = await afterSaleSettlementSnapshot(tx, afterSaleId);
  if (sale.requestedCents !== 0) throw new ConflictException("此售后必须先确认现金退款");
  if (sale.settledAt && sale.status === "COMPLETED") return { afterSaleId, status: "COMPLETED", cashRefundCents: 0, pointReturnCents };
  if (!sale.order.paidAt) throw new ConflictException("原订单付款尚未确认");
  await settleAfterSalePoints(tx, afterSaleId);
  await tx.commerceAfterSale.update({ where: { id: afterSaleId }, data: { status: "COMPLETED", version: { increment: 1 } } });
  const open = await tx.commerceAfterSale.count({ where: { orderId: sale.orderId, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } } });
  const settledOrder = await tx.commerceOrder.findUniqueOrThrow({ where: { id: sale.orderId }, include: { items: true, shipments: { include: { items: true } }, afterSales: { include: { items: true } } } });
  const cash = await tx.paymentRefund.aggregate({ where: { paymentIntent: { commerceOrderId: sale.orderId }, status: "SUCCEEDED" }, _sum: { amountCents: true } });
  const fullyReturned = allItemsReturned(settledOrder) && (cash._sum.amountCents ?? 0) >= sale.order.payableCents;
  await tx.commerceOrder.update({ where: { id: sale.orderId }, data: {
    ...(fullyReturned ? { status: "REFUNDED" as const } : open ? { status: "AFTER_SALE" as const } : orderFulfillmentState(settledOrder)), version: { increment: 1 } } });
  return { afterSaleId, status: "COMPLETED", cashRefundCents: 0, pointReturnCents };
}
