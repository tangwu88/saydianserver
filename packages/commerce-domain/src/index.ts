import { ConflictException } from "@nestjs/common";
import { Prisma, RefundStatus } from "@prisma/client";
import { settleAfterSalePoints } from "./points";
export * from "./pricing";
export * from "./points";
export * from "./shipping";
export * from "./fulfillment";

// All hooks run in the caller's business transaction. No provider calls here.
export function commissionCents(baseCents: number, rateBps: number): number {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0 || !Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new ConflictException("佣金计算参数无效");
  }
  return Number(BigInt(baseCents) * BigInt(rateBps) / 10_000n);
}

export function commissionReversal(base: number, previousRefund: number, refund: number, rate: number, gross: number) {
  if (![base, previousRefund, refund, gross].every(value => Number.isSafeInteger(value) && value >= 0)) {
    throw new ConflictException("佣金退款计算参数无效");
  }
  // Preserve the original mall's cumulative refund-first base deduction rule.
  const refundedBaseCents = Math.min(base, previousRefund + refund);
  const reversedBonusCents = Math.min(gross, commissionCents(refundedBaseCents, rate));
  return { refundedBaseCents, reversedBonusCents };
}

export async function onCommerceOrderPaid(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: orderId }, include: { commissionAccrual: true } });
  if (order.executionOwner !== "NEW_SYSTEM") throw new ConflictException("订单尚未完成新系统接管");
  if (order.commissionAccrual || !order.referralEmployeeId || !order.paidAt) return;
  const plan = await tx.commerceCommissionPlan.findUnique({ where: { id: "default" } });
  if (!plan?.enabled || !plan.enabledAt || order.paidAt < plan.enabledAt || plan.rateBps <= 0) return;
  const baseCents = Math.max(0, order.payableCents - order.shippingCents);
  const grossBonusCents = commissionCents(baseCents, plan.rateBps);
  if (!grossBonusCents) return;
  if (!Number.isSafeInteger(plan.settlementDays) || plan.settlementDays < 0) throw new ConflictException("佣金结算天数无效");
  await tx.commerceCommissionAccrual.create({ data: {
    employeeId: order.referralEmployeeId, orderId, baseCents, rateBps: plan.rateBps, grossBonusCents,
    settlementDaysSnapshot: plan.settlementDays,
    availableAt: order.receivedAt ? new Date(order.receivedAt.valueOf() + plan.settlementDays * 86_400_000) : null,
  } });
  await tx.commerceEmployeeWallet.upsert({
    where: { employeeId: order.referralEmployeeId },
    create: { employeeId: order.referralEmployeeId, frozenCents: grossBonusCents },
    update: { frozenCents: { increment: grossBonusCents } },
  });
  await tx.commerceCommissionLedger.create({ data: {
    employeeId: order.referralEmployeeId, orderId, type: "EARNING_FROZEN", frozenDeltaCents: grossBonusCents,
    idempotencyKey: `commission-paid:${orderId}`, memo: "支付成功冻结佣金；基数不含运费，规则按支付时快照",
  } });
}

export async function onCommerceOrderReceived(tx: Prisma.TransactionClient, orderId: string, receivedAt: Date): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "CommerceCommissionAccrual" WHERE "orderId" = ${orderId}::uuid FOR UPDATE`;
  const accrual = await tx.commerceCommissionAccrual.findUnique({ where: { orderId } });
  if (!accrual || accrual.status !== "FROZEN" || accrual.availableAt) return;
  // A migrated accrual without its original rule stays frozen for reconciliation.
  if (accrual.settlementDaysSnapshot === null) return;
  await tx.commerceCommissionAccrual.update({ where: { id: accrual.id }, data: {
    availableAt: new Date(receivedAt.valueOf() + accrual.settlementDaysSnapshot * 86_400_000),
  } });
}

export async function onCommerceRefundSucceeded(tx: Prisma.TransactionClient, refundId: string): Promise<void> {
  const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refundId }, include: { paymentIntent: true } });
  const orderId = refund.paymentIntent.commerceOrderId;
  if (!orderId || refund.status !== RefundStatus.SUCCEEDED) return;
  await tx.$queryRaw`SELECT id FROM "CommerceCommissionAccrual" WHERE "orderId" = ${orderId}::uuid FOR UPDATE`;
  if (await tx.commerceCommissionLedger.findUnique({ where: { idempotencyKey: `commission-refund:${refundId}` } })) return;
  const accrual = await tx.commerceCommissionAccrual.findUnique({ where: { orderId } });
  if (!accrual) return;
  // New refunds carry cash-merchandise/transport snapshots. Do not reverse points or transport.
  // Unchanged legacy cash refunds retain their original refund-first rule until verified.
  const refundBase = refund.merchandiseRefundCents ?? refund.amountCents;
  const reversal = commissionReversal(accrual.baseCents, accrual.refundedBaseCents, refundBase, accrual.rateBps, accrual.grossBonusCents);
  const delta = reversal.reversedBonusCents - accrual.reversedBonusCents;
  if (delta < 0) throw new ConflictException("历史佣金冲销数据不一致，请先对账");
  await tx.$queryRaw`SELECT "employeeId" FROM "CommerceEmployeeWallet" WHERE "employeeId" = ${accrual.employeeId}::uuid FOR UPDATE`;
  const wallet = await tx.commerceEmployeeWallet.findUnique({ where: { employeeId: accrual.employeeId } });
  if (!wallet) throw new ConflictException("佣金钱包未迁入，不能生成虚构余额");
  const frozenDeltaCents = accrual.status === "FROZEN" ? 0 - Math.min(wallet.frozenCents, delta) : 0;
  const availableDeltaCents = accrual.status === "FROZEN" ? 0 : 0 - Math.min(wallet.availableCents, delta);
  const debtDeltaCents = delta + frozenDeltaCents + availableDeltaCents;
  await tx.commerceEmployeeWallet.update({ where: { employeeId: accrual.employeeId }, data: {
    frozenCents: { increment: frozenDeltaCents }, availableCents: { increment: availableDeltaCents }, debtCents: { increment: debtDeltaCents },
  } });
  await tx.commerceCommissionAccrual.update({ where: { id: accrual.id }, data: {
    ...reversal, status: reversal.reversedBonusCents >= accrual.grossBonusCents ? "REVERSED" : accrual.status,
  } });
  // Record even a sub-cent rounding delta, otherwise a repeated callback would
  // add the same refund to refundedBaseCents again.
  await tx.commerceCommissionLedger.create({ data: {
    employeeId: accrual.employeeId, orderId, refundId, type: "REFUND_REVERSAL", frozenDeltaCents, availableDeltaCents, debtDeltaCents,
    idempotencyKey: `commission-refund:${refundId}`, memo: "退款按原佣金快照累计冲销；已提现部分转待抵扣债务",
  } });
}

export async function settleCommerceCommission(tx: Prisma.TransactionClient, id: string, now = new Date()): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM "CommerceCommissionAccrual" WHERE id = ${id}::uuid FOR UPDATE`;
  const accrual = await tx.commerceCommissionAccrual.findUniqueOrThrow({ where: { id }, include: { order: { include: { afterSales: true } } } });
  if (accrual.status !== "FROZEN" || accrual.settlementDaysSnapshot === null || !accrual.availableAt || accrual.availableAt > now || accrual.order.executionOwner !== "NEW_SYSTEM") return false;
  if (accrual.order.afterSales.some(item => !["REJECTED", "CANCELLED", "COMPLETED"].includes(item.status))) return false;
  await tx.$queryRaw`SELECT "employeeId" FROM "CommerceEmployeeWallet" WHERE "employeeId" = ${accrual.employeeId}::uuid FOR UPDATE`;
  const wallet = await tx.commerceEmployeeWallet.findUniqueOrThrow({ where: { employeeId: accrual.employeeId } });
  const amount = accrual.grossBonusCents - accrual.reversedBonusCents;
  if (amount < 0 || wallet.frozenCents < amount) throw new ConflictException("冻结佣金与钱包不一致，请先对账");
  const debtPaid = Math.min(wallet.debtCents, amount);
  await tx.commerceEmployeeWallet.update({ where: { employeeId: accrual.employeeId }, data: {
    frozenCents: { decrement: amount }, availableCents: { increment: amount - debtPaid }, debtCents: { decrement: debtPaid },
  } });
  await tx.commerceCommissionAccrual.update({ where: { id }, data: { status: "AVAILABLE", settledAt: now } });
  await tx.commerceCommissionLedger.create({ data: {
    employeeId: accrual.employeeId, orderId: accrual.orderId, type: "EARNING_RELEASED", frozenDeltaCents: -amount,
    availableDeltaCents: amount - debtPaid, debtDeltaCents: -debtPaid, idempotencyKey: `commission-settle:${id}`, memo: "到期解冻；优先抵扣历史退款债务",
  } });
  return true;
}

/** Cash confirmation delegates to the immutable after-sale point allocation. */
export async function onCommercePointsRefundSucceeded(tx: Prisma.TransactionClient, refundId: string): Promise<void> {
  const refund = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refundId }, include: { paymentIntent: true } });
  const orderId = refund.paymentIntent.commerceOrderId;
  if (!orderId || refund.status !== RefundStatus.SUCCEEDED) return;
  await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: orderId } });
  if (order.executionOwner !== "NEW_SYSTEM") throw new ConflictException("积分尚未完成迁移接管");
  if (!refund.afterSaleId) {
    if (order.pointDiscountCents > 0 || order.pricingVersion === 1) throw new ConflictException("缺少商品级售后分摊，不能自动返积分");
    return;
  }
  await settleAfterSalePoints(tx, refund.afterSaleId, refund.id);
}
