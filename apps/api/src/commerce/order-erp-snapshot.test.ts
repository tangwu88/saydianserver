import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { orderErpSnapshot } from "./order-erp-snapshot";
import { AdminService } from "../admin/admin.service";
import { AdminController } from "../admin/admin.controller";

function fixture() {
  const order = { id: randomUUID(), executionOwner: "NEW_SYSTEM", status: "WAITING_FULFILLMENT", erpOrderId: "123", erpStatus: "WaitConfirm",
    erpProcessLogSyncedAt: new Date(0), erpProcessLogJson: { items: [{ id: "a", name: "审核", time: "2026-10-20 10:00:00", remark: "通过", operator: "运营", private_token: "not-for-client" }] }, shipments: [] };
  const prisma: any = { commerceOrder: { findFirst: vi.fn(async () => order) }, integrationConfig: { findUnique: vi.fn(async () => ({ state: "CONFIGURED" })) },
    commerceIntegrationJob: { upsert: vi.fn(async () => ({})), findFirst: vi.fn(async () => ({ status: "PENDING" })) } };
  return { order, prisma };
}
describe("shared ERP order snapshots", () => {
  it("only returns scoped sanitized cache on GET without enqueuing supplier calls", async () => {
    const h = fixture(), partner = randomUUID();
    const result = await orderErpSnapshot(h.prisma, h.order.id, false, partner);
    expect(h.prisma.commerceOrder.findFirst.mock.calls[0][0].where).toEqual({ id: h.order.id, partnerId: partner });
    expect(h.prisma.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ erpStatus: "WaitConfirm", items: [{ id: "a", name: "审核" }] });
    expect(JSON.stringify(result)).not.toContain("not-for-client");
  });
  it("uses one shared minute key for admin and partner refreshes", async () => {
    const h = fixture(); vi.spyOn(Date, "now").mockReturnValue(180_000);
    try {
      await orderErpSnapshot(h.prisma, h.order.id, true);
      await orderErpSnapshot(h.prisma, h.order.id, "stale", randomUUID());
      const [a, b] = h.prisma.commerceIntegrationJob.upsert.mock.calls.map((call: any[]) => call[0]);
      expect(a.where).toEqual(b.where);
      expect(a.create).toMatchObject({ type: "JUSHUITAN_ORDER_DETAIL_SYNC", payload: { orderId: h.order.id } });
    } finally { vi.restoreAllMocks(); }
  });
  it("does not enqueue a partner query when the same status/log snapshot is fresh", async () => {
    const h = fixture(); h.order.erpProcessLogSyncedAt = new Date();
    Object.assign(h.order.erpProcessLogJson, { statusVerified: true });
    await orderErpSnapshot(h.prisma, h.order.id, "stale", randomUUID());
    expect(h.prisma.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
  });
  it("retains cache and reports a failed job; does not pretend the query succeeded", async () => {
    const h = fixture(); h.prisma.commerceIntegrationJob.findFirst.mockResolvedValue({ status: "DEAD_LETTER" });
    expect(await orderErpSnapshot(h.prisma, h.order.id)).toMatchObject({ state: "ERROR", items: [{ id: "a" }], erpStatus: "WaitConfirm" });
  });
  it("does not label a snapshot current when its query job finished after the cache was read", async () => {
    const h = fixture();
    h.prisma.commerceIntegrationJob.findFirst.mockResolvedValue({ status: "SUCCEEDED", createdAt: new Date(1000) });
    Object.assign(h.order.erpProcessLogJson, { statusVerified: true });
    expect(await orderErpSnapshot(h.prisma, h.order.id)).toMatchObject({ state: "PENDING" });
    h.order.erpProcessLogSyncedAt = new Date(2000);
    expect(await orderErpSnapshot(h.prisma, h.order.id)).toMatchObject({ state: "READY" });
  });
  it("rejects another partner's order before any query job can be created", async () => {
    const h = fixture(); h.prisma.commerceOrder.findFirst.mockResolvedValue(null);
    await expect(orderErpSnapshot(h.prisma, h.order.id, true, randomUUID())).rejects.toThrow("订单不存在");
    expect(h.prisma.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
  });
  it.each(["unconfigured", "unlinked", "legacy"])("does not queue unsupported %s orders", async mode => {
    const h = fixture();
    if (mode === "unconfigured") h.prisma.integrationConfig.findUnique.mockResolvedValue({ state: "UNCONFIGURED" });
    if (mode === "unlinked") h.order.erpOrderId = "";
    if (mode === "legacy") h.order.executionOwner = "LEGACY";
    const r = await orderErpSnapshot(h.prisma, h.order.id, true);
    expect(r.state).toBe(mode === "unconfigured" ? "UNAVAILABLE" : "WAITING_ORDER");
    expect(h.prisma.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
  });
  it("caps returned records and marks partial history", async () => {
    const h = fixture();h.order.erpProcessLogJson.items = Array.from({ length: 301 }, (_, i) => ({ ...h.order.erpProcessLogJson.items[0]!, id: String(i) }));
    const r = await orderErpSnapshot(h.prisma, h.order.id);
    expect(r.items).toHaveLength(300);expect(r.items[0]!.id).toBe("1");expect(r.truncated).toBe(true);
  });
  it("preserves order filtering/statistics while making partner names and numbers searchable", async () => {
    const findMany = vi.fn(async (_args: unknown) => []), count = vi.fn(async () => 0), groupBy = vi.fn(async () => []), aggregate = vi.fn(async () => ({ _sum: { payableCents: null } }));
    const prisma: any = { commerceOrder: { findMany, count, groupBy, aggregate }, $transaction: (queries: Promise<unknown>[]) => Promise.all(queries) };
    const r = await new AdminService(prisma, {} as any).commerceOrders("SHIPPED", 2, " VIP-001 ", { role: "READ_ONLY" });
    const query = findMany.mock.calls[0]![0] as any;
    expect(query).toMatchObject({ skip: 50, take: 50, where: { status: "SHIPPED", OR: expect.arrayContaining([
      { partner: { name: { contains: "VIP-001", mode: "insensitive" } } }, { partner: { partnerNo: { contains: "VIP-001", mode: "insensitive" } } },
    ]) }, include: { partner: { select: { name: true, partnerNo: true } } } });
    expect(r.total).toBe(0);expect(count).toHaveBeenCalledWith({ where: query.where });
  });
  it("limits sync writes to operations/super admins while cache remains viewable", () => {
    expect(Reflect.getMetadata("saydian.admin-roles", AdminController.prototype.syncCommerceOrderErp)).toEqual(["SUPER_ADMIN", "COMMERCE_OPERATIONS"]);
    expect(Reflect.getMetadata("saydian.admin-roles", AdminController.prototype.commerceOrderErp)).toContain("READ_ONLY");
  });
});
