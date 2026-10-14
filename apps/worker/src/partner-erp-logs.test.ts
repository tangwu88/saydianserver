import { describe, expect, it, vi } from "vitest";
import { CommerceJobWorker } from "./commerce-job-worker";
function fixture() {
  const prisma: any = {
    commerceOrder: {
      findUnique: vi.fn(async () => ({
        id: "local-order",
        erpOrderId: "783079",
        executionOwner: "NEW_SYSTEM",
      })),
      updateMany: vi.fn(),
    },
  };
  const worker = new CommerceJobWorker(prisma) as any;
  worker.settings = vi.fn(async () => ({
    paths: { orderLogs: "order.action.query" },
  }));
  worker.call = vi.fn();
  return { prisma, worker };
}
describe("real ERP operation log import", () => {
  it("paginates actual action records, deduplicates and discards foreign orders and unknown payload fields", async () => {
    const h = fixture();
    h.worker.call
      .mockResolvedValueOnce({
        has_next: true,
        datas: [
          {
            o_id: 783079,
            oa_id: 2,
            name: "审核",
            created: "2026-10-14 12:01:00",
            creator_name: "合成运营",
            remark: "已审核",
            private_token: "never",
          },
          { o_id: 99, oa_id: 999, name: "foreign" },
        ],
      })
      .mockResolvedValueOnce({
        has_next: false,
        datas: [
          {
            o_id: 783079,
            oa_id: 1,
            name: "接单",
            created: "2026-10-14 12:00:00",
            remark: "收到",
          },
          {
            o_id: 783079,
            oa_id: 2,
            name: "审核",
            created: "2026-10-14 12:01:00",
            creator_name: "合成运营",
            remark: "已审核",
          },
        ],
      });
    await h.worker.syncOrderLogs("local-order");
    expect(h.worker.call.mock.calls[0].slice(1)).toEqual([
      "order.action.query",
      { o_id: 783079, page_index: 1, page_size: 300 },
    ]);
    expect(h.worker.call.mock.calls[1][2].page_index).toBe(2);
    const data = h.prisma.commerceOrder.updateMany.mock.calls[0][0];
    expect(data.where).toMatchObject({
      id: "local-order",
      erpOrderId: "783079",
      executionOwner: "NEW_SYSTEM",
    });
    expect(data.data.erpProcessLogJson.items.map((r: any) => r.id)).toEqual([
      "1",
      "2",
    ]);
    expect(JSON.stringify(data.data)).not.toContain("private_token");
    expect(JSON.stringify(data.data)).not.toContain("foreign");
  });
  it("does not replace successful cache on malformed or failed provider reads", async () => {
    const h = fixture();
    h.worker.call.mockResolvedValue({ datas: null });
    await expect(h.worker.syncOrderLogs("local-order")).rejects.toThrow(
      "datas array",
    );
    expect(h.prisma.commerceOrder.updateMany).not.toHaveBeenCalled();
    h.worker.call.mockRejectedValue(new Error("provider failed"));
    await expect(h.worker.syncOrderLogs("local-order")).rejects.toThrow(
      "provider failed",
    );
    expect(h.prisma.commerceOrder.updateMany).not.toHaveBeenCalled();
  });
  it("rejects nonnumeric provider order IDs before making any call", async () => {
    const h = fixture();
    h.prisma.commerceOrder.findUnique.mockResolvedValue({
      id: "local-order",
      erpOrderId: "invalid",
      executionOwner: "NEW_SYSTEM",
    });
    await expect(h.worker.syncOrderLogs("local-order")).rejects.toThrow(
      "valid ERP",
    );
    expect(h.worker.call).not.toHaveBeenCalled();
  });
});
