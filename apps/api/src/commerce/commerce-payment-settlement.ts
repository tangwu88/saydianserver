import { CommerceOrderStatus, Prisma } from "@prisma/client";
import { onCommerceOrderPaid } from "./commerce-finance";
import { deductCommercePaymentStock } from "./commerce-payment-stock";

/** Caller owns the order lock. Shared by provider and partner balance payments. */
export async function completeCommercePayment(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const changed = await tx.commerceOrder.updateMany({
    where: {
      id: orderId,
      status: CommerceOrderStatus.PENDING_PAYMENT,
      executionOwner: "NEW_SYSTEM",
    },
    data: {
      status: CommerceOrderStatus.PAID,
      paidAt: new Date(),
      version: { increment: 1 },
    },
  });
  if (!changed.count) return false;
  await deductCommercePaymentStock(tx, orderId);
  await onCommerceOrderPaid(tx, orderId);
  const erpItems = await tx.commerceOrderItem.count({
    where: { orderId, product: { source: "ERP" } },
  });
  if (erpItems)
    await tx.commerceIntegrationJob.upsert({
      where: { idempotencyKey: `jushuitan-order:${orderId}` },
      create: {
        type: "JUSHUITAN_ORDER_PUSH",
        idempotencyKey: `jushuitan-order:${orderId}`,
        aggregateType: "commerce_order",
        aggregateId: orderId,
        payload: { orderId },
      },
      update: {},
    });
  return true;
}
