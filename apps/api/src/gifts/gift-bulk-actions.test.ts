import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { GiftService } from "./gift.service";

const productId = randomUUID(),
  skuId = randomUUID(),
  targetProduct = randomUUID(),
  targetSku = randomUUID();
function card(number: number, status = "DRAFT") {
  return {
    id: randomUUID(),
    number,
    status,
    batchId: randomUUID(),
    cardNo: `8010${String(number).padStart(4, "0")}`,
    secretHash: "synthetic-hash",
    productId,
    allowedSkuIds: [skuId],
    expiresAt: null,
    version: 0,
    createdAt: new Date(),
  };
}
function harness(initial = [card(1), card(2), card(3)]) {
  const state = { cards: structuredClone(initial), audits: [] as any[] };
  const locks: Prisma.Sql[] = [];
  const tx = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Prisma.sql(strings, ...values);
        locks.push(sql);
        return state.cards
          .filter(
            (c) =>
              sql.values.includes(c.number) ||
              sql.values.includes(c.id) ||
              sql.values.includes(c.batchId),
          )
          .map((c) => ({ id: c.id }));
      },
    ),
    commerceGiftCard: {
      findMany: vi.fn(async ({ where }: any) =>
        structuredClone(state.cards.filter((c) => where.id.in.includes(c.id))),
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const c = state.cards.find((c) => c.id === where.id)!;
        Object.assign(c, {
          ...data,
          version: c.version + data.version.increment,
        });
        return structuredClone(c);
      }),
    },
    commerceProduct: {
      findFirst: vi.fn(async ({ where, include }: any) => ({
        id: where.id,
        skus: include.skus.where.id.in.map((id: string) => ({ id })),
      })),
    },
    commerceGiftBatch: { updateMany: vi.fn(async () => ({ count: 1 })) },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        state.audits.push(data);
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (run: any) => {
      const before = structuredClone(state);
      try {
        return await run(tx);
      } catch (e) {
        Object.assign(state, before);
        throw e;
      }
    }),
  };
  return {
    state,
    locks,
    tx,
    prisma,
    service: new GiftService(prisma as any, {} as any, {} as any),
  };
}
const activate = (numbers: unknown) => ({
  action: "ACTIVATE",
  numbers,
  reason: "测试开启",
  downloadConfirmed: true,
});

describe("gift actions by management number", () => {
  it("activates exactly the requested numbers across batches and audits each card once", async () => {
    const h = harness();
    expect(
      await h.service.change(randomUUID(), activate("3，001\n3"), {}),
    ).toEqual({ changed: 2 });
    expect(h.state.cards.map((c) => c.status)).toEqual([
      "ACTIVE",
      "DRAFT",
      "ACTIVE",
    ]);
    expect(h.state.audits).toHaveLength(2);
    expect(h.state.audits.map((a) => a.afterJson.serialNo).sort()).toEqual([
      "1",
      "3",
    ]);
    const query = h.locks[0]!;
    expect(query.text).toContain("ORDER BY id FOR UPDATE");
    expect(query.values).toEqual([3, 1]);
  });
  it("rejects the whole batch on missing numbers and identifies the missing input", async () => {
    const h = harness();
    await expect(
      h.service.change(randomUUID(), activate([1, 900]), {}),
    ).rejects.toThrow("900");
    expect(h.tx.commerceGiftCard.update).not.toHaveBeenCalled();
    expect(h.state.audits).toEqual([]);
  });
  it.each(["ACTIVE", "REDEEMED", "VOID"])(
    "rejects mixed DRAFT/%s batches for activation and binding",
    async (status) => {
      for (const action of ["ACTIVATE", "BIND"]) {
        const h = harness([card(1), card(2, status)]);
        await expect(
          h.service.change(
            randomUUID(),
            {
              ...activate([1, 2]),
              action,
              productId: targetProduct,
              allowedSkuIds: [targetSku],
            },
            {},
          ),
        ).rejects.toThrow("整批未处理：2");
        expect(h.tx.commerceGiftCard.update).not.toHaveBeenCalled();
      }
    },
  );
  it("rebinds all selected cards while preserving credentials and other cards", async () => {
    const h = harness(),
      before = structuredClone(h.state.cards);
    await h.service.change(
      randomUUID(),
      {
        action: "BIND",
        numbers: [1, 3],
        productId: targetProduct,
        allowedSkuIds: [targetSku],
        reason: "统一换绑",
        expiresAt: null,
      },
      {},
    );
    for (const i of [0, 2]) {
      expect(h.state.cards[i]).toMatchObject({
        productId: targetProduct,
        allowedSkuIds: [targetSku],
        status: "DRAFT",
        version: 1,
        cardNo: before[i]!.cardNo,
        secretHash: before[i]!.secretHash,
      });
    }
    expect(h.state.cards[1]).toEqual(before[1]);
    expect(
      h.state.audits.every(
        (a) =>
          a.action === "GIFT_CARD_BIND" && a.afterJson.reason === "统一换绑",
      ),
    ).toBe(true);
    expect(JSON.stringify(h.state.audits)).not.toContain("synthetic-hash");
  });
  it("validates every product binding before activation and rolls back on an audit failure", async () => {
    const h = harness();
    h.tx.commerceProduct.findFirst.mockResolvedValueOnce(null as any);
    await expect(
      h.service.change(randomUUID(), activate([1, 2]), {}),
    ).rejects.toThrow("商品已下架");
    expect(h.tx.commerceGiftCard.update).not.toHaveBeenCalled();
    h.tx.auditLog.create.mockRejectedValueOnce(
      new Error("synthetic audit failure"),
    );
    await expect(
      h.service.change(randomUUID(), activate([1, 2]), {}),
    ).rejects.toThrow("synthetic audit failure");
    expect(h.state.cards.every((c) => c.status === "DRAFT")).toBe(true);
    expect(h.state.audits).toEqual([]);
  });
  it.each([
    { ...activate([1]), ids: [randomUUID()] },
    { ...activate([1]), batchId: randomUUID() },
    { ...activate([1]), action: "VOID" },
    { ...activate([1]), downloadConfirmed: false },
    { ...activate([1]), reason: "" },
    activate("1-10"),
    activate(Array.from({ length: 101 }, (_, i) => i + 1)),
  ])(
    "rejects invalid or ambiguous request before a transaction %#",
    async (body) => {
      const h = harness();
      await expect(h.service.change(randomUUID(), body, {})).rejects.toThrow();
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    },
  );
  it("preserves the original single-ID and batch entry points and optimistic version check", async () => {
    const h = harness(),
      first = h.state.cards[0]!;
    await expect(
      h.service.change(
        randomUUID(),
        {
          action: "BIND",
          ids: [first.id],
          version: 9,
          productId,
          allowedSkuIds: [skuId],
          reason: "测试",
        },
        {},
      ),
    ).rejects.toThrow("卡片已变化");
    await h.service.change(
      randomUUID(),
      {
        action: "ACTIVATE",
        ids: [first.id],
        downloadConfirmed: true,
        reason: "测试",
      },
      {},
    );
    await h.service.change(
      randomUUID(),
      {
        action: "ACTIVATE",
        batchId: h.state.cards[1]!.batchId,
        downloadConfirmed: true,
        reason: "测试",
      },
      {},
    );
    expect(h.state.cards.map((c) => c.status)).toEqual([
      "ACTIVE",
      "ACTIVE",
      "DRAFT",
    ]);
  });
});
