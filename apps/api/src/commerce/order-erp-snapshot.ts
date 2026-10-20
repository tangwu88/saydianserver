import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject } from "../common/crypto";

export async function orderErpSnapshot(prisma: PrismaService, id: string, enqueue: boolean | "stale" = false, partnerId?: string) {
  if (!isUuid(id)) throw new BadRequestException("订单编号不正确");
  const order = await prisma.commerceOrder.findFirst({ where: { id, ...(partnerId !== undefined ? { partnerId } : {}) }, select: {
    id: true, status: true, executionOwner: true, erpOrderId: true, erpStatus: true,
    erpProcessLogJson: true, erpProcessLogSyncedAt: true,
    shipments: { select: { id: true, orderId: true, logisticsCompany: true, logisticsCode: true, trackingNo: true, shippedAt: true, deliveredAt: true } },
  } });
  if (!order) throw new NotFoundException("订单不存在");
  const cache = safeObject(order.erpProcessLogJson);
  const cachedItems = Array.isArray(cache.items) ? cache.items : [];
  const items = cachedItems.slice(-300).map(value => {
    const row = safeObject(value);
    const text = (key: string, max: number) => typeof row[key] === "string" ? row[key].slice(0, max) : "";
    return { id: text("id", 80), name: text("name", 200), time: text("time", 80),
      operator: text("operator", 120), remark: text("remark", 4000) };
  }).filter(row => row.id);
  const result = { erpStatus: order.erpStatus, orderStatus: order.status, shipments: order.shipments, syncedAt: order.erpProcessLogSyncedAt,
    items, truncated: cache.truncated === true || cachedItems.length > 300 };
  if (order.executionOwner !== "NEW_SYSTEM" || !order.erpOrderId || !/^[1-9]\d*$/.test(order.erpOrderId))
    return { ...result, state: "WAITING_ORDER" };
  const integration = await prisma.integrationConfig.findUnique({ where: { key: "jushuitan" }, select: { state: true } });
  if (integration?.state !== "CONFIGURED") return { ...result, state: "UNAVAILABLE" };
  const type = "JUSHUITAN_ORDER_DETAIL_SYNC";
  const stale = !order.erpProcessLogSyncedAt || Date.now() - order.erpProcessLogSyncedAt.getTime() >= 60_000 || cache.statusVerified !== true;
  if (enqueue === true || (enqueue === "stale" && stale)) {
    const key = `erp-order-detail:${id}:${Math.floor(Date.now() / 60_000)}`;
    await prisma.commerceIntegrationJob.upsert({ where: { idempotencyKey: key }, create: {
      type, aggregateType: "commerce_order", aggregateId: id, payload: { orderId: id }, idempotencyKey: key,
    }, update: {} });
  }
  const job = await prisma.commerceIntegrationJob.findFirst({
    where: { type, aggregateType: "commerce_order", aggregateId: id }, orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true },
  });
  // A job may finish after the order read. Keep polling instead of declaring that old snapshot current.
  const waitingForSnapshot = job?.status === "SUCCEEDED" &&
    (!order.erpProcessLogSyncedAt || order.erpProcessLogSyncedAt < job.createdAt || cache.statusVerified !== true);
  const state = waitingForSnapshot || (job && ["PENDING", "RUNNING"].includes(job.status)) ? "PENDING" :
    job && ["FAILED", "DEAD_LETTER"].includes(job.status) ? "ERROR" : "READY";
  return { ...result, state };
}
