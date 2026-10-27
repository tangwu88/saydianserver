import { commerceLogisticsTraces } from "@saydian/app-contracts";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject } from "../common/crypto";

export async function orderErpSnapshot(prisma: PrismaService, id: string, enqueue: boolean | "stale" = false, scope?: string | { userId: string }) {
  if (!isUuid(id)) throw new BadRequestException("订单编号不正确");
  const order = await prisma.commerceOrder.findFirst({ where: { id, ...(typeof scope === "string" ? { partnerId: scope } : scope ? { userId: scope.userId } : {}) }, select: {
    id: true, status: true, executionOwner: true, erpOrderId: true, erpStatus: true,
    erpProcessLogJson: true, erpProcessLogSyncedAt: true,
    shipments: { select: { id: true, orderId: true, logisticsCompany: true, logisticsCode: true, trackingNo: true, shippedAt: true, deliveredAt: true, traceJson: true, items: true } },
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
  const result = { erpStatus: order.erpStatus, orderStatus: order.status, shipments: (order.shipments || []).map(customerShipment), logisticsUnavailable: cache.logisticsUnavailable === true, syncedAt: order.erpProcessLogSyncedAt,
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

export function customerShipment<T extends { traceJson?: unknown }>(shipment: T) {
  const { traceJson, ...safe } = shipment;
  const traces = commerceLogisticsTraces(traceJson);
  return { ...safe, traceJson: traces, traces };
}

export function customerOrderErp<T extends { erpProcessLogJson?: unknown; shipments?: { traceJson?: unknown }[] }>(order: T) {
  const { erpProcessLogJson, ...safe } = order;
  return { ...safe, ...(order.shipments ? { shipments: (order.shipments || []).map(customerShipment) } : {}) };
}

/** Queue a bounded set of already ownership-filtered orders, without a provider call in the HTTP request. */
export async function queueMemberOrderSync(prisma: PrismaService, orders: {
  id: string; executionOwner: string; status: string; erpOrderId: string | null;
  erpProcessLogSyncedAt: Date | null; erpProcessLogJson: unknown;
}[]) {
  const candidates = orders.filter(order => order.executionOwner === "NEW_SYSTEM" && /^[1-9]\d*$/.test(order.erpOrderId || "") &&
    ["PAID", "WAITING_FULFILLMENT", "SHIPPED", "AFTER_SALE", "CANCELLED"].includes(order.status) &&
    (!order.erpProcessLogSyncedAt || Date.now() - order.erpProcessLogSyncedAt.getTime() >= 60_000 || safeObject(order.erpProcessLogJson).statusVerified !== true)).slice(0, 20);
  const pending = new Set<string>();
  if (!candidates.length) return pending;
  const integration = await prisma.integrationConfig.findUnique({ where: { key: "jushuitan" }, select: { state: true } });
  if (integration?.state !== "CONFIGURED") return pending;
  for (const order of candidates) {
    const key = `erp-order-detail:${order.id}:${Math.floor(Date.now() / 60_000)}`;
    const job = await prisma.commerceIntegrationJob.upsert({ where: { idempotencyKey: key }, create: {
      type: "JUSHUITAN_ORDER_DETAIL_SYNC", aggregateType: "commerce_order", aggregateId: order.id,
      payload: { orderId: order.id }, idempotencyKey: key,
    }, update: {}, select: { status: true } });
    if (["PENDING", "RUNNING"].includes(job.status)) pending.add(order.id);
  }
  return pending;
}
