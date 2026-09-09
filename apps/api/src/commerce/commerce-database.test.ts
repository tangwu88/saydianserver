import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BusinessType, PaymentChannel, PaymentStatus, PrismaClient, ProductStatus } from "@prisma/client";
import { CommerceStoreService } from "./commerce-store.service";
import { BillingService } from "../billing/billing.service";
import type { PrismaService } from "../common/prisma.service";

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
    await prisma.commerceAddress.create({ data: { id: addressId, userId: members[0]!, name: "合成测试", mobile: "00000000000", province: "测试省", city: "测试市", district: "测试区", detail: "不发货测试地址" } });
    await prisma.commerceProduct.create({ data: { id: productId, erpItemId: `LOCAL-${suffix}`, source: "LOCAL", name: "合成并发测试商品", status: ProductStatus.PUBLISHED, gallery: [], tags: [],
      skus: { create: { id: skuId, erpSkuId: `LOCAL-SKU-${suffix}`, erpItemId: `LOCAL-${suffix}`, salePriceCents: 1000, stock: 1 } },
    } });
  });

  afterAll(async () => {
    if (!prisma) return;
    // Exact random IDs created by this test, no broad table truncation.
    const orders = await prisma.commerceOrder.findMany({ where: { userId: { in: members } }, select: { id: true } });
    const ids = orders.map(row => row.id);
    const payments = await prisma.paymentIntent.findMany({ where: { userId: { in: members } }, select: { id: true } });
    await prisma.paymentRefund.deleteMany({ where: { paymentIntentId: { in: payments.map(row => row.id) } } });
    await prisma.paymentIntent.deleteMany({ where: { id: { in: payments.map(row => row.id) } } });
    await prisma.commercePointLedger.deleteMany({ where: { userId: { in: members } } });
    await prisma.commerceOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.commerceProduct.deleteMany({ where: { id: productId } });
    await prisma.user.deleteMany({ where: { id: { in: members } } });
    await prisma.$disconnect();
  });

  it("last unit accepts only one concurrent order and never makes inventory negative", async () => {
    const attempts = await Promise.allSettled(["A", "B"].map(key => store.createOrder(members[0]!, { addressId, items: [{ skuId, quantity: 1 }], idempotencyKey: `${suffix}-${key}` })));
    const successful = attempts.filter(item => item.status === "fulfilled");
    expect(successful).toHaveLength(1);
    winningOrderId = (successful[0] as PromiseFulfilledResult<{ id: string }>).value.id;
    expect((await prisma.commerceSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(0);
    expect(await prisma.commerceOrder.count({ where: { userId: members[0]! } })).toBe(1);
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
