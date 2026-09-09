import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { fulfillmentProgress, parseShipment, sameShipment } from "@saydian/commerce-domain";

const include = {
  items: { include: { product: { select: { source: true } } } },
  shipments: { include: { items: true } },
  afterSales: { include: { items: true } },
} satisfies Prisma.CommerceOrderInclude;
type Order = Prisma.CommerceOrderGetPayload<{ include: typeof include }>;
type Admin = { id: string; role: string; roles?: string[] };
function requireOperator(current: Admin) {
  const roles = current.roles?.length ? current.roles : [current.role];
  if (!roles.some(role => ["SUPER_ADMIN","COMMERCE_OPERATIONS"].includes(role))) throw new ForbiddenException("仅商城运营或超级管理员可登记发货");
}
function assertLocalPaidOrder(order: Order) {
  if (order.executionOwner !== "NEW_SYSTEM") throw new ConflictException("该订单尚未完成迁移接管");
  if (order.sourceSystem !== "canonical" || order.erpOrderId || order.erpShopId || order.items.some(item => item.product.source !== "LOCAL")) throw new ConflictException("仅新系统LOCAL订单可手工发货，ERP或旧订单须按原履约权威处理");
  if (!order.paidAt || !["PAID","WAITING_FULFILLMENT","AFTER_SALE","SHIPPED"].includes(order.status)) throw new ConflictException("仅已付款且尚在履约阶段的订单可发货");
}
function projection(order: Order) {
  let progress: ReturnType<typeof fulfillmentProgress> | undefined, unavailableReason: string | undefined;
  try { assertLocalPaidOrder(order); progress = fulfillmentProgress(order); }
  catch (error) { unavailableReason = error instanceof Error ? error.message : "履约数量尚未核验"; }
  return { orderId: order.id, version: order.version, status: order.status,
    items: progress?.items ?? [], shipments: order.shipments, ...(unavailableReason ? { unavailableReason } : {}) };
}
export async function localFulfillmentPreview(db: Prisma.TransactionClient, orderId: string, current: Admin) {
  requireOperator(current);
  const order = await db.commerceOrder.findUnique({ where: { id: orderId }, include });
  if (!order) throw new NotFoundException("订单不存在");
  return projection(order);
}
export async function createLocalShipment(tx: Prisma.TransactionClient, orderId: string, input: unknown, current: Admin) {
  requireOperator(current);
  const body = parseShipment(input);
  await tx.$queryRaw`SELECT id FROM "CommerceOrder" WHERE id = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.commerceOrder.findUnique({ where: { id: orderId }, include });
  if (!order) throw new NotFoundException("订单不存在");
  assertLocalPaidOrder(order);
  const existing = order.shipments.find(parcel => parcel.trackingNo === body.trackingNo);
  if (existing) {
    if (!sameShipment(existing, body)) throw new ConflictException("此运单号已用于不同物流公司或商品数量");
    return { ...projection(order), shipmentId: existing.id, replayed: true };
  }
  if (order.version !== body.version) throw new ConflictException("订单已更新，请刷新发货数量");
  if (order.status === "SHIPPED") throw new ConflictException("订单已全部发货");
  const progress = fulfillmentProgress(order);
  for (const item of body.items) {
    const line = progress.items.find(line => line.orderItemId === item.orderItemId);
    if (!line || item.quantity > line.remainingQuantity) throw new ConflictException("发货数量超过当前订单商品剩余可发数量（含售后占用）");
  }
  const shippedAt = new Date();
  const created = await tx.commerceShipment.create({ data: {
    orderId, logisticsCompany: body.logisticsCompany, trackingNo: body.trackingNo, shippedAt,
    items: { create: body.items },
  }, include: { items: true } });
  const next = fulfillmentProgress({ ...order, shipments: [...order.shipments, created] });
  const status = next.hasOpenAfterSale ? "AFTER_SALE" : next.allShipped ? "SHIPPED" : "WAITING_FULFILLMENT";
  const changed = await tx.commerceOrder.updateMany({ where: { id: orderId, version: body.version, executionOwner: "NEW_SYSTEM" },
    data: { status, ...(next.allShipped ? { shippedAt } : {}), version: { increment: 1 } } });
  if (changed.count !== 1) throw new ConflictException("订单已更新，请刷新后重试");
  await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: current.id, action: "COMMERCE_LOCAL_SHIPMENT_CREATE",
    entityType: "CommerceShipment", entityId: created.id, beforeJson: { orderId, orderVersion: order.version, orderStatus: order.status },
    afterJson: { orderId, logisticsCompany: body.logisticsCompany, trackingNo: body.trackingNo, items: body.items, orderStatus: status, orderVersion: order.version + 1 } } });
  const updated = await tx.commerceOrder.findUniqueOrThrow({ where: { id: orderId }, include });
  return { ...projection(updated), shipmentId: created.id, replayed: false };
}
