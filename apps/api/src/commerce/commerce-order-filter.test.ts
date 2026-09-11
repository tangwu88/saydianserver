import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { commerceOrderListFilter } from "./commerce-order-filter";
import { CommerceStoreService } from "./commerce-store.service";
import { CommerceService } from "./commerce.service";
import { CommerceController } from "./commerce.controller";
import { CommerceCompatibilityController } from "./commerce-compat.controller";

describe("order list query compatibility", () => {
  it("keeps missing and old exact status requests, including existing case normalization", () => {
    expect(commerceOrderListFilter()).toEqual({});
    expect(commerceOrderListFilter("WAITING_FULFILLMENT")).toEqual({ status: "WAITING_FULFILLMENT" });
    expect(commerceOrderListFilter(" paid ")).toEqual({ status: "PAID" });
    expect(commerceOrderListFilter("AFTER_SALE")).toEqual({ status: "AFTER_SALE" });
  });
  it.each([["pending_shipment", { status: { in: ["PAID", "WAITING_FULFILLMENT"] } }], ["after_sales", { afterSales: { some: {} } }]] as const)("uses an actual database predicate for group %s", (group, expected) => {
    expect(commerceOrderListFilter(undefined, group)).toEqual(expected);
  });
  it.each([["UNKNOWN", undefined], ["", "unknown"], ["PAID", "after_sales"], [" ", undefined]])("rejects invalid or ambiguous filters %j %j", (status, group) => {
    expect(() => commerceOrderListFilter(status, group)).toThrow();
  });
  it("keeps ownership and queries actual after-sales independently of current order status", async () => {
    const records = [
      { id: "paid", userId: "member", status: "PAID", afterSales: [] },
      { id: "waiting", userId: "member", status: "WAITING_FULFILLMENT", afterSales: [] },
      { id: "refunded", userId: "member", status: "REFUNDED", afterSales: [{ status: "COMPLETED" }] },
      { id: "rejected", userId: "member", status: "COMPLETED", afterSales: [{ status: "REJECTED" }] },
      { id: "other", userId: "other", status: "AFTER_SALE", afterSales: [{ status: "APPLIED" }] },
      { id: "status-only", userId: "member", status: "AFTER_SALE", afterSales: [] },
    ];
    const db = { commerceOrder: { findMany: vi.fn(async ({ where }: any) => records.filter(row => row.userId === where.userId &&
      (!where.status || (typeof where.status === "string" ? row.status === where.status : where.status.in.includes(row.status))) &&
      (!where.afterSales || row.afterSales.length > 0))) } };
    const store = new CommerceStoreService(db as any);
    expect((await store.listOrders("member", undefined, "pending_shipment")).map(row => row.id)).toEqual(["paid", "waiting"]);
    expect((await store.listOrders("member", undefined, "after_sales")).map(row => row.id)).toEqual(["refunded", "rejected"]);
    expect(db.commerceOrder.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: "member", afterSales: { some: {} } } }));
    expect((await store.listOrders("member", "AFTER_SALE")).map(row => row.id)).toEqual(["status-only"]);
  });
  it("never treats a legacy status as evidence of actual after-sales; keeps normal legacy filters", async () => {
    const db = { legacyOrderProjection: { findMany: vi.fn().mockResolvedValue([]) } };
    const store = { listOrders: vi.fn().mockResolvedValue([]) };
    const service = new CommerceService(db as any, store as any, {} as any);
    await service.orders("member", undefined, "after_sales");
    expect(store.listOrders).toHaveBeenCalledWith("member", undefined, "after_sales");
    expect(db.legacyOrderProjection.findMany).not.toHaveBeenCalled();
    await service.orders("member", undefined, "pending_shipment");
    expect(db.legacyOrderProjection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "member", status: { in: ["PAID", "WAITING_FULFILLMENT"] } } }));
    await service.orders("member", "AFTER_SALE");
    expect(db.legacyOrderProjection.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: "member", status: "AFTER_SALE" } }));
  });
  it("both public controllers preserve group and status as separate optional parameters", async () => {
    const commerce = { orders: vi.fn().mockResolvedValue([]) };
    const user = { id: "member", sessionId: "session" };
    await new CommerceController(commerce as any).orders(user, undefined, "after_sales");
    await new CommerceCompatibilityController({} as any, commerce as any, {} as any, {} as any, {} as any, {} as any).orders(user, undefined, "pending_shipment");
    expect(commerce.orders.mock.calls).toEqual([["member", undefined, "after_sales"], ["member", undefined, "pending_shipment"]]);
  });
  it("internal commerce GET forwards group without filtering an already-loaded page", async () => {
    const store = { listOrders: vi.fn().mockResolvedValue([]) };
    await new CommerceService({} as any, store as any, {} as any).forUser("member", "GET", "/orders?group=after_sales");
    expect(store.listOrders).toHaveBeenCalledWith("member", undefined, "after_sales");
  });
});
