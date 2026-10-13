import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BusinessType, PaymentChannel, PrismaClient } from "@prisma/client";
import { PartnerService } from "./partner.service";
import { PartnerAdminService } from "./partner-admin.service";
import { PartnerAuthService, PartnerAuthGuard } from "./partner-auth";
import { PartnerCommerceService } from "./partner-commerce.service";
import { PartnerMembersService } from "./partner-members.service";
import {
  partnerRegistrationData,
  auditPartnerRegistration,
} from "./partner-registration";
import { BillingService } from "../billing/billing.service";
import { AdminService } from "../admin/admin.service";
import { sha256 } from "../common/crypto";

// Real row-lock/concurrency acceptance. Fixture funds are synthetic and never dispatched.
// Accounting is append-only: keep this namespace in the disposable local/CI database.
const enabled = process.env.RUN_LOCAL_DATABASE_TESTS === "1";
describe.runIf(enabled)("brand partner PostgreSQL acceptance", () => {
  const suffix = randomUUID(),
    actorId = randomUUID(),
    address = {
      recipientName: "合成采购",
      recipientMobile: "19900000000",
      province: "测试省",
      city: "测试市",
      district: "测试区",
      addressDetail: "不发货测试地址",
    };
  let prisma: PrismaClient,
    billing: BillingService,
    partners: PartnerService,
    admin: PartnerAdminService,
    commerce: PartnerCommerceService,
    members: PartnerMembersService;
  let a: any,
    b: any,
    product: any,
    sku: any,
    member: any,
    device: any,
    originalOrder: any;
  const provider = {
    identity: vi.fn(async () => ({
      merchantId: "SYNTHETIC-MERCHANT",
      appId: "SYNTHETIC-APP",
    })),
    create: vi.fn(async () => ({
      type: "QR",
      codeUrl: "weixin://wxpay/bizpayurl?pr=SYNTHETIC",
    })),
    refund: vi.fn(),
    queryWechatPayment: vi.fn(),
  };
  const receipt = {
    mchid: "SYNTHETIC-MERCHANT",
    appid: "SYNTHETIC-APP",
    amount: { currency: "CNY" },
  };
  async function topup(partner: any, amountCents: number) {
    const recharge = await partners.createRecharge(partner.id, {
      amountCents,
      channel: "wechat_native",
      idempotencyKey: randomUUID(),
    });
    const payment = await prisma.paymentIntent.findUniqueOrThrow({
      where: { id: recharge.payment.id },
    });
    await billing.markPaid(
      payment.paymentNo,
      `SYNTHETIC-${randomUUID()}`,
      amountCents,
      receipt,
    );
    return { recharge, payment };
  }
  async function purchase(partner: any, quantity = 1, key = randomUUID()) {
    const quote = await commerce.quote(partner.id, {
      items: [{ skuId: sku.id, quantity }],
    });
    return commerce.createOrder(partner.id, {
      items: [{ skuId: sku.id, quantity }],
      address,
      expectedQuote: quote.fingerprint,
      idempotencyKey: key,
    });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Non-local partner database tests refused");
    prisma = new PrismaClient();
    billing = new BillingService(prisma as any, provider as any, {} as any);
    partners = new PartnerService(prisma as any, billing);
    admin = new PartnerAdminService(prisma as any, partners);
    commerce = new PartnerCommerceService(prisma as any);
    members = new PartnerMembersService(prisma as any, {} as any);
    const levels = await prisma.partnerLevel.findMany({
      orderBy: { sort: "asc" },
    });
    expect(levels.slice(0, 3).map((level) => level.name)).toEqual([
      "一级分销",
      "二级分销",
      "三级分销",
    ]);
    a = await admin.create(
      actorId,
      {
        username: `qa-A-${suffix}`,
        name: "合成品牌伙伴A",
        password: "synthetic-partner-test-password",
        levelId: levels[0]!.id,
      },
      suffix,
    );
    b = await admin.create(
      actorId,
      {
        username: `qa-B-${suffix}`,
        name: "合成品牌伙伴B",
        password: "synthetic-partner-test-password",
        levelId: levels[1]!.id,
      },
      suffix,
    );
    product = await prisma.commerceProduct.create({
      data: {
        erpItemId: `PARTNER-${suffix}`,
        name: "合成分销测试商品",
        source: "ERP",
        status: "PUBLISHED",
        gallery: [],
        tags: [],
        skus: {
          create: {
            erpItemId: `PARTNER-${suffix}`,
            erpSkuId: `PARTNER-SKU-${suffix}`,
            specification: "测试规格",
            salePriceCents: 2000,
            stock: 1,
          },
        },
      },
      include: { skus: true },
    });
    sku = product.skus[0];
    await admin.savePrice(
      actorId,
      a.levelId,
      sku.id,
      { priceCents: 500, updatedAt: null },
      suffix,
    );
    await admin.savePrice(
      actorId,
      b.levelId,
      sku.id,
      { priceCents: 400, updatedAt: null },
      suffix,
    );
    member = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          nickname: `合成伙伴会员-${suffix}`,
          ...(await partnerRegistrationData(
            tx,
            a.promotionCode,
            "partner-service-v1",
          )),
        },
      });
      await auditPartnerRegistration(tx, user);
      return user;
    });
    device = await prisma.deviceBinding.create({
      data: {
        userId: member.id,
        hardwareKey: sha256(`${member.id}:test-device`),
        vendor: "SYNTHETIC",
        model: "QA",
        displayName: "合成测试设备",
        capabilities: [],
      },
    });
    await prisma.deviceConnectionEvent.create({
      data: {
        deviceBindingId: device.id,
        vendor: "SYNTHETIC",
        model: "QA",
        displayName: "合成测试设备",
        rawPayload: "synthetic-private-payload",
      },
    });
    await prisma.healthRecord.create({
      data: {
        userId: member.id,
        clientRecordId: `partner-health-${suffix}`,
        metric: "HEART_RATE",
        observedAt: new Date(),
        timezoneOffsetMinutes: 480,
        values: { heartRate: 72, missing: null },
        sourcePlatform: "migration",
        deviceBindingId: device.id,
      },
    });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("creates independent zero-funded accounts and level prices without a hidden member", async () => {
    expect(a.wallet.balanceCents).toBe(0);
    expect(a.wallet.depositCents).toBe(0);
    expect(
      (await commerce.quote(a.id, { items: [{ skuId: sku.id, quantity: 2 }] }))
        .subtotalCents,
    ).toBe(1000);
    expect(
      (await commerce.quote(b.id, { items: [{ skuId: sku.id, quantity: 2 }] }))
        .subtotalCents,
    ).toBe(800);
    expect(await prisma.user.count({ where: { nickname: a.name } })).toBe(0);
  });
  it("scopes member, health, device and connection details to the current partner", async () => {
    expect(
      (await members.healthRecords(a.id, member.id, suffix, 1, 30)).items[0]!
        .values,
    ).toEqual({ heartRate: 72, missing: null });
    expect(
      (await members.connections(a.id, device.id, suffix, 1)).items[0],
    ).not.toHaveProperty("rawPayload");
    await expect(members.profile(b.id, member.id, suffix)).rejects.toThrow(
      "会员不存在",
    );
    await expect(
      members.measurements(b.id, device.id, suffix, 1, 30),
    ).rejects.toThrow("设备不存在");
    await expect(members.ecg(b.id, randomUUID(), suffix)).rejects.toThrow(
      "心电波形不存在",
    );
  });
  it("keeps procurement within existing delivery and fulfillment boundaries", async () => {
    const quote = await commerce.quote(a.id, {
      items: [{ skuId: sku.id, quantity: 1 }],
    });
    await expect(
      commerce.createOrder(a.id, {
        items: [{ skuId: sku.id, quantity: 1 }],
        address: { ...address, countryCode: "US" },
        expectedQuote: quote.fingerprint,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("中国大陆");
    const local = await prisma.commerceProduct.create({
      data: {
        erpItemId: `PARTNER-LOCAL-${suffix}`,
        name: "合成自营商品",
        source: "LOCAL",
        status: "PUBLISHED",
        gallery: [],
        tags: [],
        skus: {
          create: {
            erpItemId: `PARTNER-LOCAL-${suffix}`,
            erpSkuId: `PARTNER-LOCAL-SKU-${suffix}`,
            salePriceCents: 1000,
            stock: 1,
          },
        },
      },
      include: { skus: true },
    });
    await admin.savePrice(
      actorId,
      a.levelId,
      local.skus[0]!.id,
      { priceCents: 300, updatedAt: null },
      suffix,
    );
    await expect(
      commerce.quote(a.id, {
        items: [
          { skuId: sku.id, quantity: 1 },
          { skuId: local.skus[0]!.id, quantity: 1 },
        ],
      }),
    ).rejects.toThrow("分别下单");
    expect(
      (
        await commerce.quote(a.id, {
          items: [{ skuId: local.skus[0]!.id, quantity: 1 }],
        })
      ).subtotalCents,
    ).toBe(300);
  });
  it("does not let deposit pay for a purchase, and failed checkout rolls back stock and order", async () => {
    await admin.deposit(
      actorId,
      a.id,
      {
        type: "DEPOSIT_RECEIPT",
        deltaCents: 10000,
        reason: "合成保证金",
        idempotencyKey: randomUUID(),
      },
      suffix,
    );
    const before = await prisma.commerceOrder.count({
      where: { partnerId: a.id },
    });
    await expect(purchase(a)).rejects.toThrow("余额不足");
    expect(
      await prisma.commerceOrder.count({ where: { partnerId: a.id } }),
    ).toBe(before);
    expect(
      (await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.id } }))
        .stock,
    ).toBe(1);
    expect((await partners.wallet(a.id)).balanceCents).toBe(0);
  });
  it("concurrent verified recharge notifications credit once and reject wrong amounts/merchant", async () => {
    const recharge = await partners.createRecharge(a.id, {
      amountCents: 1500,
      channel: "wechat_native",
      idempotencyKey: randomUUID(),
    });
    const payment = await prisma.paymentIntent.findUniqueOrThrow({
      where: { id: recharge.payment.id },
    });
    await expect(
      billing.markPaid(payment.paymentNo, `SYNTHETIC-${suffix}`, 1600, receipt),
    ).rejects.toThrow("金额不一致");
    await expect(
      billing.markPaid(payment.paymentNo, `SYNTHETIC-${suffix}`, 1500, {
        ...receipt,
        mchid: "WRONG",
      }),
    ).rejects.toThrow("商户不匹配");
    await expect(billing.markPaid(payment.paymentNo, `SYNTHETIC-${suffix}`, 1500, { ...receipt, amount: {} })).rejects.toThrow("币种不正确");
    await Promise.all(
      Array.from({ length: 6 }, () =>
        billing.markPaid(
          payment.paymentNo,
          `SYNTHETIC-${suffix}`,
          1500,
          receipt,
        ),
      ),
    );
    expect((await partners.wallet(a.id)).balanceCents).toBe(1500);
    expect(
      await prisma.partnerLedger.count({
        where: { referenceId: recharge.id, type: "RECHARGE" },
      }),
    ).toBe(1);
    await expect(partners.recharge(b.id, recharge.id)).rejects.toThrow(
      "充值记录不存在",
    );
    await expect(billing.payment(member.id, payment.id)).rejects.toThrow(
      "支付记录不存在",
    );
  });
  it("does not overspend concurrent purchases and creates one ERP job/payment per paid order", async () => {
    const results = await Promise.allSettled([purchase(a, 2), purchase(a, 2)]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    originalOrder = (
      results.find(
        (result) => result.status === "fulfilled",
      ) as PromiseFulfilledResult<any>
    ).value;
    expect(originalOrder.status).toBe("PAID");
    expect(originalOrder.userId).toBeNull();
    expect(originalOrder.partnerLevelSnapshot).toBe("一级分销");
    expect(originalOrder.paymentIntents).toHaveLength(1);
    expect(originalOrder.paymentIntents[0].channel).toBe(
      PaymentChannel.PARTNER_BALANCE,
    );
    expect((await partners.wallet(a.id)).balanceCents).toBe(500);
    expect((await partners.wallet(a.id)).depositCents).toBe(10000);
    expect(
      (await prisma.commerceSku.findUniqueOrThrow({ where: { id: sku.id } }))
        .stock,
    ).toBe(-1);
    expect(
      await prisma.commerceIntegrationJob.count({
        where: { aggregateId: originalOrder.id },
      }),
    ).toBe(1);
    expect(
      await prisma.commercePointLedger.count({
        where: { orderId: originalOrder.id },
      }),
    ).toBe(0);
  });
  it("reuses an identical order request and rejects changed parameters or a stale price", async () => {
    const quote = await commerce.quote(a.id, {
        items: [{ skuId: sku.id, quantity: 1 }],
      }),
      key = randomUUID(),
      input = {
        items: [{ skuId: sku.id, quantity: 1 }],
        address,
        expectedQuote: quote.fingerprint,
        idempotencyKey: key,
      };
    const first = await commerce.createOrder(a.id, input);
    expect((await commerce.createOrder(a.id, input)).id).toBe(first.id);
    await expect(
      commerce.createOrder(a.id, { ...input, buyerRemark: "changed" }),
    ).rejects.toThrow("不同参数");
    const price = await prisma.partnerSkuPrice.findUniqueOrThrow({
      where: { levelId_skuId: { levelId: a.levelId, skuId: sku.id } },
    });
    await admin.savePrice(
      actorId,
      a.levelId,
      sku.id,
      { priceCents: 600, updatedAt: price.updatedAt.toISOString() },
      suffix,
    );
    await expect(
      commerce.createOrder(a.id, { ...input, idempotencyKey: randomUUID() }),
    ).rejects.toThrow("重新确认报价");
  });
  it("refunds once to the original partner wallet without calling a provider or member points", async () => {
    const line = originalOrder.items[0],
      sale = await prisma.commerceAfterSale.create({
        data: {
          orderId: originalOrder.id,
          afterSaleNo: `PARTNER-SALE-${suffix}`,
          type: "REFUND_ONLY",
          status: "APPROVED",
          reason: "合成部分退款",
          evidenceImages: [],
          requestedCents: 500,
          pricingVersion: 1,
          pointReturnCents: 0,
          shippingRefundCents: 0,
          items: {
            create: {
              orderItemId: line.id,
              quantity: 1,
              amountCents: 500,
              pointReturnCents: 0,
            },
          },
        },
      });
    const input = {
      amountCents: 500,
      reason: "合成部分退款",
      afterSaleId: sale.id,
      idempotencyKey: randomUUID(),
    };
    const [first, second] = await Promise.all([
      billing.createRefund(originalOrder.paymentIntents[0].id, input),
      billing.createRefund(originalOrder.paymentIntents[0].id, input),
    ]);
    expect(first.id).toBe(second.id);
    expect(first.status).toBe("SUCCEEDED");
    expect((await partners.wallet(a.id)).balanceCents).toBe(500);
    expect(
      await prisma.partnerLedger.count({
        where: { referenceId: first.id, type: "REFUND" },
      }),
    ).toBe(1);
    expect(provider.refund).not.toHaveBeenCalled();
    expect(
      await prisma.commercePointLedger.count({
        where: { orderId: originalOrder.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.paymentIntent.findUniqueOrThrow({
          where: { id: originalOrder.paymentIntents[0].id },
        })
      ).status,
    ).toBe("PARTIAL_REFUNDED");
  });
  it("settles the remaining approved refund to the same balance and caps cumulative refunds", async () => {
    const line = originalOrder.items[0];
    const sale = await prisma.commerceAfterSale.create({
      data: {
        orderId: originalOrder.id,
        afterSaleNo: `PARTNER-FULL-${suffix}`,
        type: "REFUND_ONLY",
        status: "APPROVED",
        reason: "合成剩余退款",
        evidenceImages: [],
        requestedCents: 500,
        pricingVersion: 1,
        pointReturnCents: 0,
        shippingRefundCents: 0,
        items: {
          create: {
            orderItemId: line.id,
            quantity: 1,
            amountCents: 500,
            pointReturnCents: 0,
          },
        },
      },
    });
    await billing.createRefund(originalOrder.paymentIntents[0].id, {
      amountCents: 500,
      reason: "合成剩余退款",
      afterSaleId: sale.id,
      idempotencyKey: randomUUID(),
    });
    expect(
      (
        await prisma.paymentIntent.findUniqueOrThrow({
          where: { id: originalOrder.paymentIntents[0].id },
        })
      ).status,
    ).toBe("REFUNDED");
    expect((await partners.wallet(a.id)).balanceCents).toBe(1000);
    await expect(
      billing.createRefund(originalOrder.paymentIntents[0].id, {
        amountCents: 1,
        reason: "超额退款必须拒绝",
        afterSaleId: sale.id,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow();
    expect(provider.refund).not.toHaveBeenCalled();
  });
  it("records ERP shipments and denies another partner's order/logistics/ledger", async () => {
    await prisma.commerceShipment.create({
      data: {
        orderId: originalOrder.id,
        logisticsCompany: "合成物流",
        trackingNo: suffix,
        traceJson: {
          events: [
            {
              time: "2026-10-13",
              description: "合成已发货",
              recipientSecret: "hidden",
            },
          ],
          private: "not public",
        },
      },
    });
    expect(
      (await commerce.logistics(a.id, originalOrder.id)).items[0]!.traces,
    ).toEqual([{ time: "2026-10-13", description: "合成已发货" }]);
    await expect(commerce.logistics(b.id, originalOrder.id)).rejects.toThrow(
      "订单不存在",
    );
    expect((await partners.ledger(b.id, "BALANCE", 1)).items).toHaveLength(0);
  });
  it("moves member visibility immediately without moving original transactions", async () => {
    await admin.assignMember(
      actorId,
      member.id,
      { partnerId: b.id, expectedPartnerId: a.id, reason: "合成会员归属转移" },
      suffix,
    );
    await expect(members.profile(a.id, member.id, suffix)).rejects.toThrow(
      "会员不存在",
    );
    expect((await members.profile(b.id, member.id, suffix)).id).toBe(member.id);
    expect((await commerce.order(a.id, originalOrder.id)).partnerId).toBe(a.id);
    await expect(commerce.order(b.id, originalOrder.id)).rejects.toThrow(
      "订单不存在",
    );
  });
  it("revokes sessions on password reset/disable, yet credits an already created recharge", async () => {
    const auth = new PartnerAuthService(prisma as any),
      guard = new PartnerAuthGuard(prisma as any);
    const session = await auth.login({
      username: a.username,
      password: "synthetic-partner-test-password",
    });
    const request: any = { header: () => `Bearer ${session.token}` },
      context: any = { switchToHttp: () => ({ getRequest: () => request }) };
    expect(await guard.canActivate(context)).toBe(true);
    await admin.resetPassword(
      actorId,
      a.id,
      { password: "synthetic-updated-test-password" },
      suffix,
    );
    await expect(guard.canActivate(context)).rejects.toThrow("登录已失效");
    const recharge = await partners.createRecharge(a.id, {
        amountCents: 100,
        channel: "wechat_native",
        idempotencyKey: randomUUID(),
      }),
      payment = await prisma.paymentIntent.findUniqueOrThrow({
        where: { id: recharge.payment.id },
      });
    const current = await prisma.brandPartner.findUniqueOrThrow({
      where: { id: a.id },
    });
    await admin.update(
      actorId,
      a.id,
      { active: false, updatedAt: current.updatedAt.toISOString() },
      suffix,
    );
    await billing.markPaid(
      payment.paymentNo,
      `DISABLED-${suffix}`,
      100,
      receipt,
    );
    expect((await partners.wallet(a.id)).balanceCents).toBe(1100);
    await expect(partners.publicPromotion(a.promotionCode)).rejects.toThrow(
      "推广链接已失效",
    );
    await expect(
      prisma.$transaction((tx) =>
        partnerRegistrationData(tx, a.promotionCode, "partner-service-v1"),
      ),
    ).rejects.toThrow("推广链接已失效");
  });
  it("keeps the ledger immutable and enforces database transaction ownership", async () => {
    const ledger = await prisma.partnerLedger.findFirstOrThrow({
      where: { partnerId: a.id },
    });
    await expect(
      prisma.partnerLedger.update({
        where: { id: ledger.id },
        data: { deltaCents: 1 },
      }),
    ).rejects.toThrow("append-only");
    await expect(
      prisma.partnerWallet.update({
        where: { partnerId: a.id },
        data: { balanceCents: -1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.paymentIntent.create({
        data: {
          userId: member.id,
          partnerId: b.id,
          paymentNo: `BAD-${suffix}`,
          businessType: BusinessType.COMMERCE_ORDER,
          businessId: originalOrder.id,
          channel: PaymentChannel.PARTNER_BALANCE,
          amountCents: 100,
          description: "must fail",
          idempotencyKey: randomUUID(),
        },
      }),
    ).rejects.toThrow();
  });
  it("does not double count prepaid balance as external income", async () => {
    const service = new AdminService(prisma as any, {} as any);
    const stats = await service.dashboard();
    const external = await prisma.paymentIntent.aggregate({
      where: {
        status: "SUCCEEDED",
        channel: { not: PaymentChannel.PARTNER_BALANCE },
      },
      _sum: { amountCents: true },
    });
    expect(stats.paidCents).toBe(external._sum.amountCents ?? 0);
    expect(stats.partnerRechargeCents).toBeGreaterThanOrEqual(1600);
    expect(stats.commerceTurnoverCents).toBeGreaterThanOrEqual(1500);
  });
});
