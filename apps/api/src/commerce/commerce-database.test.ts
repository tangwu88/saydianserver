import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BusinessType, PaymentChannel, PaymentStatus, PrismaClient, ProductStatus } from "@prisma/client";
import { CommerceStoreService } from "./commerce-store.service";
import { BillingService } from "../billing/billing.service";
import type { PrismaService } from "../common/prisma.service";
import { importJushuitanProductBySku, syncJushuitanInventory } from "../admin/jushuitan-product-import";

// Opt-in only; never run destructive fixture cleanup against any non-loopback DB.
const enabled = process.env.RUN_LOCAL_DATABASE_TESTS === "1";
describe.runIf(enabled)("local PostgreSQL transaction acceptance", () => {
  const members = [randomUUID(), randomUUID()];
  const productId = randomUUID();
  const skuId = randomUUID();
  const addressId = randomUUID();
  const suffix = randomUUID();
  let prisma: PrismaClient;
  let store: CommerceStoreService;
  let winningOrderId: string;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Non-local database tests refused");
    prisma = new PrismaClient();
    store = new CommerceStoreService(prisma as PrismaService);
    await prisma.user.createMany({ data: members.map(id => ({ id, nickname: `LOCAL_CONTRACT_${suffix}` })) });
    await prisma.commerceAddress.create({ data: { id: addressId, userId: members[0]!, name: "合成测试", mobile: "+8619900000099", countryCode: "CN", province: "测试省", city: "测试市", district: "测试区", detail: "不发货测试地址" } });
    await prisma.commerceProduct.create({ data: { id: productId, erpItemId: `LOCAL-${suffix}`, source: "LOCAL", name: "合成并发测试商品", status: ProductStatus.PUBLISHED, gallery: [], tags: [],
      skus: { create: { id: skuId, erpSkuId: `LOCAL-SKU-${suffix}`, erpItemId: `LOCAL-${suffix}`, salePriceCents: 1000, stock: 1 } },
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Exact random IDs created by this test, no broad table truncation.
    const orders = await prisma.commerceOrder.findMany({ where: { userId: { in: members } }, select: { id: true, items: { select: { id: true } } } });
    const ids = orders.map(row => row.id);
    const payments = await prisma.paymentIntent.findMany({ where: { userId: { in: members } }, select: { id: true } });
    await prisma.paymentRefund.deleteMany({ where: { paymentIntentId: { in: payments.map(row => row.id) } } });
    await prisma.paymentIntent.deleteMany({ where: { id: { in: payments.map(row => row.id) } } });
    await prisma.commercePointLedger.deleteMany({ where: { userId: { in: members } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, ...orders.flatMap(order => order.items.map(item => item.id))] } } });
    await prisma.commerceOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.commerceProduct.deleteMany({ where: { id: productId } });
    await prisma.user.deleteMany({ where: { id: { in: members } } });
    await prisma.$disconnect();
  });

  it("persists all imported ERP variants when inventory is empty or partial and keeps them intact on provider failure", async () => {
    const itemId = `ERP-ZERO-${suffix}`;
    const skuCodes = [`${itemId}-A`, `${itemId}-B`];
    let phase = "empty";
    const providerProducts = () => skuCodes.map((sku_id) => ({ sku_id, i_id: itemId, name: phase === "error" ? "must not overwrite" : "合成零库存导入", sale_price: 10, enabled: 1 }));
    const db = {
      integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: "CONFIGURED", publicConfig: {} }), updateMany: vi.fn() },
      $transaction: prisma.$transaction.bind(prisma),
    };
    const secrets = { resolve: vi.fn().mockResolvedValue({ appKey: "synthetic", appSecret: "synthetic", accessToken: "synthetic" }) };
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
      const inventory = new URL(String(url)).searchParams.get("method") === "inventory.query";
      const payload = !inventory ? { code: 0, datas: providerProducts() } : phase === "error" ? { code: 100 } : { code: 0, inventorys: phase === "partial" ? [{ sku_id: skuCodes[0], qty: 5 }] : [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }));
    try {
      const run = () => importJushuitanProductBySku(db as unknown as PrismaService, secrets as any, { sku: skuCodes[0] });
      const empty = await run();
      expect(empty.status).toBe("DRAFT");
      expect(empty.skus).toHaveLength(2);
      expect(empty.skus.every((sku) => sku.stock === 0 && sku.enabled)).toBe(true);
      expect(empty.erpLookup.zeroStockSkuIds.sort()).toEqual([...skuCodes].sort());
      const ids = empty.skus.map((sku) => sku.id).sort();
      const second = empty.skus.find((sku) => sku.erpSkuId === skuCodes[1])!;
      await prisma.commerceSku.update({ where: { id: second.id }, data: { stock: 9 } });
      phase = "partial";
      const partial = await run();
      expect(partial.skus.map((sku) => sku.id).sort()).toEqual(ids);
      expect(partial.skus.find((sku) => sku.erpSkuId === skuCodes[0])!.stock).toBe(5);
      expect(partial.skus.find((sku) => sku.erpSkuId === skuCodes[1])!.stock).toBe(0);
      const before = await prisma.commerceProduct.findUniqueOrThrow({ where: { erpItemId: itemId }, include: { skus: { orderBy: { id: "asc" } } } });
      phase = "error";
      await expect(run()).rejects.toThrow("错误码 100");
      expect(await prisma.commerceProduct.findUniqueOrThrow({ where: { erpItemId: itemId }, include: { skus: { orderBy: { id: "asc" } } } })).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
      await prisma.commerceProduct.deleteMany({ where: { erpItemId: itemId } });
    }
  });

  it("partially syncs ERP stock without releasing missing-SKU historical holds and cancels mixed-policy orders correctly", async () => {
    const syncProductId = randomUUID();
    const syncSkuIds: [string, string] = [randomUUID(), randomUUID()];
    const itemId = `ERP-PARTIAL-${suffix}`;
    let orderId: string | undefined;
    let empty = false;
    await prisma.commerceProduct.create({ data: { id: syncProductId, erpItemId: itemId, source: "ERP", name: "合成部分库存同步", status: ProductStatus.PUBLISHED, gallery: [], tags: [],
      skus: { create: syncSkuIds.map((id, i) => ({ id, erpSkuId: `${itemId}-${i}`, erpItemId: itemId, salePriceCents: 1000, stock: 20 })) },
    } });
    try {
      const order = await store.createOrder(members[0]!, { addressId, items: syncSkuIds.map(skuId => ({ skuId, quantity: 2 })), idempotencyKey: `${suffix}-partial-sync` });
      orderId = order.id;
      const items = await prisma.commerceOrderItem.findMany({ where: { orderId } });
      // Simulate exactly this synthetic order's legacy checkout deductions.
      await prisma.auditLog.deleteMany({ where: { action: "COMMERCE_ITEM_PAYMENT_STOCK_V1", entityId: { in: items.map(item => item.id) } } });
      await prisma.commerceSku.updateMany({ where: { id: { in: syncSkuIds } }, data: { stock: 18 } });
      const missingBefore = await prisma.commerceSku.findUniqueOrThrow({ where: { id: syncSkuIds[1] } });
      const db = {
        commerceSku: { findMany: (query: any) => prisma.commerceSku.findMany({ ...query, where: { ...query.where, productId: syncProductId } }) },
        commerceOrderItem: prisma.commerceOrderItem,
        integrationConfig: { findUnique: vi.fn().mockResolvedValue({ state: "CONFIGURED", publicConfig: {} }), updateMany: vi.fn() },
        $transaction: prisma.$transaction.bind(prisma),
      };
      const secrets = { resolve: vi.fn().mockResolvedValue({ appKey: "synthetic", appSecret: "synthetic", accessToken: "synthetic" }) };
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 0, inventorys: empty ? [] : [{ sku_id: `${itemId}-0`, qty: 7 }] }), { status: 200 })));
      const run = () => syncJushuitanInventory(db as unknown as PrismaService, secrets as any);
      expect(await run()).toMatchObject({ syncedSkuCount: 1, updatedSkuCount: 1, skippedSkuCount: 1, skippedSkuIds: [`${itemId}-1`] });
      expect((await prisma.commerceSku.findUniqueOrThrow({ where: { id: syncSkuIds[0] } })).stock).toBe(7);
      expect(await prisma.commerceSku.findUniqueOrThrow({ where: { id: syncSkuIds[1] } })).toEqual(missingBefore);
      const marked = await prisma.auditLog.findMany({ where: { action: "COMMERCE_ITEM_PAYMENT_STOCK_V1", entityId: { in: items.map(item => item.id) } } });
      expect(marked.map(row => row.entityId)).toEqual([items.find(item => item.skuId === syncSkuIds[0])!.id]);
      await store.cancelOrder(members[0]!, orderId);
      expect((await prisma.commerceSku.findUniqueOrThrow({ where: { id: syncSkuIds[0] } })).stock).toBe(7);
      expect((await prisma.commerceSku.findUniqueOrThrow({ where: { id: syncSkuIds[1] } })).stock).toBe(20);
      const beforeEmpty = await prisma.commerceSku.findMany({ where: { productId: syncProductId }, orderBy: { id: "asc" } });
      empty = true;
      expect(await run()).toMatchObject({ syncedSkuCount: 0, updatedSkuCount: 0, skippedSkuCount: 2 });
      expect(await prisma.commerceSku.findMany({ where: { productId: syncProductId }, orderBy: { id: "asc" } })).toEqual(beforeEmpty);
    } finally {
      vi.unstubAllGlobals();
      if (orderId) {
        const items = await prisma.commerceOrderItem.findMany({ where: { orderId } });
        await prisma.auditLog.deleteMany({ where: { entityId: { in: [orderId, ...items.map(item => item.id)] } } });
        await prisma.commerceOrder.delete({ where: { id: orderId } });
      }
      await prisma.commerceProduct.delete({ where: { id: syncProductId } });
    }
  });

  it("unpaid orders do not hold the last unit; verified payments deduct once and permit backorders", async () => {
    const orders = [];
    for (const key of ["A", "B"]) orders.push(await store.createOrder(members[0]!, { addressId, items: [{ skuId, quantity: 1 }], idempotencyKey: `${suffix}-${key}` }));
    winningOrderId = orders[0]!.id;
    expect((await prisma.commerceSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(1);
    const billing = new BillingService(prisma as PrismaService, {} as any, {} as any);
    for (const order of orders) {
      const paymentNo = `STOCK-${order.id}`;
      await prisma.paymentIntent.create({ data: { userId: members[0]!, businessType: BusinessType.COMMERCE_ORDER,
        businessId: order.id, commerceOrderId: order.id, paymentNo, channel: PaymentChannel.WECHAT_H5,
        status: PaymentStatus.PENDING, amountCents: order.payableCents, description: "synthetic stock acceptance",
        idempotencyKey: paymentNo, providerMerchantId: "LOCAL-MERCHANT", providerAppId: "LOCAL-APP" } });
      const payload = { mchid: "LOCAL-MERCHANT", appid: "LOCAL-APP", amount: { currency: "CNY" } };
      await billing.markPaid(paymentNo, `TX-${order.id}`, order.payableCents, payload);
      await billing.markPaid(paymentNo, `TX-${order.id}`, order.payableCents, payload);
    }
    expect((await prisma.commerceSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(-1);
  });

  it("does not let a different member use another member's address", async () => {
    await expect(store.createOrder(members[1]!, { addressId, items: [{ skuId, quantity: 1 }], idempotencyKey: `${suffix}-cross-user` })).rejects.toThrow(/地址/);
  });

  it("concurrent partial refunds reserve money under the same payment lock", async () => {
    // This existing test intentionally covers the retained pre-snapshot canonical cash-only path.
    // Snapshot v1 requires an approved item-level after-sale and is tested in the domain/transaction suites.
    await prisma.commerceOrder.update({ where: { id: winningOrderId }, data: { pricingVersion: null, pricingVerifiedAt: null } });
    const intent = await prisma.paymentIntent.create({ data: { userId: members[0]!, businessType: BusinessType.COMMERCE_ORDER, businessId: winningOrderId, commerceOrderId: winningOrderId,
      paymentNo: `TEST-${suffix}`, channel: PaymentChannel.WECHAT_APP, status: PaymentStatus.SUCCEEDED, amountCents: 1000, description: "local synthetic only", idempotencyKey: `${suffix}-pay`, providerTransactionId: `TX-${suffix}`, providerMerchantId: "LOCAL-MERCHANT", providerAppId: "LOCAL-APP" } });
    const providers = { assertIdentity: vi.fn(), refund: vi.fn().mockResolvedValue({ completed: false, providerRefundId: `LOCAL-${suffix}`, payload: { status: "PROCESSING" } }) };
    const billing = new BillingService(prisma as PrismaService, providers as any, {} as any);
    const results = await Promise.allSettled(["A", "B"].map(key => billing.createRefund(intent.id, { amountCents: 750, reason: "本地并发测试", idempotencyKey: `${suffix}-refund-${key}` })));
    expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(providers.refund).toHaveBeenCalledOnce();
    const totals = await prisma.paymentRefund.aggregate({ where: { paymentIntentId: intent.id }, _sum: { amountCents: true } });
    expect(totals._sum.amountCents).toBe(750);
  });

  it("concurrent closed and successful refund callbacks keep the successful ledger state", async () => {
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { idempotencyKey: `${suffix}-pay` } });
    const refund = await prisma.paymentRefund.findFirstOrThrow({ where: { paymentIntentId: intent.id } });
    const billing = new BillingService(prisma as PrismaService, {} as any, {} as any);
    const payload = { out_refund_no: refund.refundNo, refund_id: refund.providerRefundId, out_trade_no: intent.paymentNo,
      transaction_id: intent.providerTransactionId, mchid: intent.providerMerchantId, amount: { refund: 750, currency: "CNY" } };
    await Promise.all([
      (billing as any).applyWechatRefundResult({ ...payload, refund_status: "CLOSED" }),
      (billing as any).applyWechatRefundResult({ ...payload, refund_status: "SUCCESS" }),
    ]);
    expect((await prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("SUCCEEDED");
    expect((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe(PaymentStatus.PARTIAL_REFUNDED);
    // A later duplicate failure must not revert the final money state.
    await (billing as any).applyWechatRefundResult({ ...payload, refund_status: "CLOSED" });
    expect((await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe(PaymentStatus.PARTIAL_REFUNDED);
  });
});
