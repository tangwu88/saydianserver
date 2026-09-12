import { ConflictException } from "@nestjs/common";
import { CommerceOrderStatus, Prisma } from "@prisma/client";
import { requireCommerceOwner } from "./commerce-policy";
import { financialSnapshot } from "./commerce-finance";

type CancellableOrder = Prisma.CommerceOrderGetPayload<{
  include: { items: true };
}>;

export async function cancelCommerceOrderInTransaction(
  tx: Prisma.TransactionClient,
  order: CancellableOrder,
  options: { expectedVersion?: number; adminRemark?: string; cancelledAt?: Date } = {},
): Promise<Date> {
  requireCommerceOwner(order.executionOwner);
  if (order.status !== CommerceOrderStatus.PENDING_PAYMENT) {
    throw new ConflictException("当前订单不可取消");
  }
  if (options.expectedVersion !== undefined && order.version !== options.expectedVersion) {
    throw new ConflictException("订单已更新，请刷新后重试");
  }
  const pendingPayment = await tx.paymentIntent.count({
    where: {
      commerceOrderId: order.id,
      status: { in: ["CREATED", "PENDING"] },
    },
  });
  if (pendingPayment) {
    throw new ConflictException("支付结果尚未确认，请先完成支付渠道关单或查单后再取消");
  }
  const cancelledAt = options.cancelledAt ?? new Date();
  const changed = await tx.commerceOrder.updateMany({
    where: {
      id: order.id,
      status: CommerceOrderStatus.PENDING_PAYMENT,
      version: order.version,
    },
    data: {
      status: CommerceOrderStatus.CANCELLED,
      cancelledAt,
      ...(options.adminRemark !== undefined ? { adminRemark: options.adminRemark } : {}),
      version: { increment: 1 },
    },
  });
  if (!changed.count) throw new ConflictException("订单状态已改变，请刷新后重试");
  for (const item of order.items) {
    await tx.commerceSku.update({
      where: { id: item.skuId },
      data: { stock: { increment: item.quantity } },
    });
  }
  await tx.commerceCouponClaim.updateMany({
    where: { orderId: order.id },
    data: { orderId: null, usedAt: null },
  });
  if (order.pointDiscountCents > 0) {
    financialSnapshot(order);
    await tx.commercePointAccount.update({
      where: { userId: order.userId },
      data: {
        balanceCents: { increment: order.pointDiscountCents },
        version: { increment: 1 },
      },
    });
    await tx.commercePointLedger.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        deltaCents: order.pointDiscountCents,
        type: "ORDER_CANCEL_RETURN",
        idempotencyKey: `points-cancel:${order.id}`,
      },
    });
  }
  return cancelledAt;
}
