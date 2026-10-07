import { Prisma } from "@prisma/client";

// Immutable, item-level policy evidence in the existing business audit ledger.
// Missing evidence means a historical order already deducted stock at checkout.
export const DEFERRED_STOCK_ACTION = "COMMERCE_ITEM_PAYMENT_STOCK_V1";
type StockItem = { id: string; skuId: string; quantity: number };

export async function deferredStockItems(
  tx: Prisma.TransactionClient,
  items: StockItem[],
) {
  if (!items.length) return new Set<string>();
  const records = await tx.auditLog.findMany({
    where: {
      action: DEFERRED_STOCK_ACTION,
      entityType: "commerce_order_item",
      entityId: { in: items.map((item) => item.id) },
    },
    select: { entityId: true },
  });
  return new Set(records.map((record) => record.entityId));
}

export async function markPaymentStockItems(
  tx: Prisma.TransactionClient,
  orderId: string,
  items: StockItem[],
) {
  if (!items.length) return;
  await tx.auditLog.createMany({
    data: items.map((item) => ({
      actorType: "SYSTEM",
      actorId: "commerce-stock",
      action: DEFERRED_STOCK_ACTION,
      entityType: "commerce_order_item",
      entityId: item.id,
      afterJson: {
        orderId,
        skuId: item.skuId,
        quantity: item.quantity,
        policy: "PAYMENT_SUCCESS",
      },
    })),
  });
}

// Caller owns the order row lock and must call only after the pending -> paid CAS.
// Atomic SKU decrements also retain negative stock as the authorized backorder debt.
export async function deductCommercePaymentStock(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const items = await tx.commerceOrderItem.findMany({
    where: { orderId },
    orderBy: { skuId: "asc" },
  });
  const deferred = await deferredStockItems(tx, items);
  for (const item of items) {
    if (!deferred.has(item.id)) continue;
    const sku = await tx.commerceSku.update({
      where: { id: item.skuId },
      data: { stock: { decrement: item.quantity } },
    });
    if (sku.stock < 0)
      await tx.auditLog.create({
        data: {
          actorType: "SYSTEM",
          actorId: "commerce-stock",
          action: "COMMERCE_PAID_BACKORDER",
          entityType: "commerce_order",
          entityId: orderId,
          afterJson: {
            skuId: item.skuId,
            orderItemId: item.id,
            stock: sku.stock,
            replenishmentRequired: true,
          },
        },
      });
  }
}
