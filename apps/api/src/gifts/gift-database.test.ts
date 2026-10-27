import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { decode } from "jsonwebtoken";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AuthService } from "../auth/auth.service";
import { BillingService } from "../billing/billing.service";
import { CommerceStoreService } from "../commerce/commerce-store.service";
import { financialSnapshot } from "@saydian/commerce-domain";
import { GiftService } from "./gift.service";

describe.runIf(process.env.RUN_GIFT_DATABASE_TESTS === "1")(
  "gift cards PostgreSQL transaction acceptance",
  () => {
    let prisma: PrismaClient,
      gifts: GiftService,
      auth: AuthService,
      product: any,
      adminId: string;
    let phone = 13881000000;
    let ownsFixture = false;
    const context = () => ({ ip: "127.0.0.1", requestId: randomUUID() });
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !/gift_test/.test(url.pathname)
      )
        throw new Error(
          "Only the isolated loopback gift_test database is allowed",
        );
      prisma = new PrismaClient();
      if (
        (await prisma.commerceGiftCard.count()) ||
        (await prisma.user.count()) ||
        (await prisma.commerceProduct.count()) ||
        (await prisma.auditLog.count()) ||
        (await prisma.globalLegalDocument.count())
      )
        throw new Error(
          "Existing data retained; gift test database must be empty",
        );
      ownsFixture = true;
      for (const documentType of ["user_agreement", "privacy_policy"])
        await prisma.globalLegalDocument.create({
          data: {
            documentType,
            version: "commerce-legal-v1",
            locale: "en",
            title: "合成验收协议",
            contentHtml: "<p>仅供本地合成验收使用。</p>",
            reviewed: true,
            active: true,
            publishedAt: new Date(),
          },
        });
      vi.stubEnv("ALLOW_TEST_OTP", "true");
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("DEPLOYMENT_SITE", "cn");
      auth = new AuthService(
        prisma as any,
        { send: vi.fn() } as any,
        {} as any,
        {} as any,
      );
      gifts = new GiftService(prisma as any, auth, { send: vi.fn() } as any);
    });
    beforeEach(async () => {
      await prisma.commerceGiftThrottle.deleteMany();
      adminId = randomUUID();
      await gifts.settings(adminId, { enabled: true }, context());
      product = await prisma.commerceProduct.create({
        data: {
          erpItemId: "gift-test-" + randomUUID(),
          name: "合成礼品",
          source: "ERP",
          status: "PUBLISHED",
          gallery: [],
          tags: [],
          skus: {
            create: {
              erpSkuId: "gift-sku-" + randomUUID(),
              erpItemId: "gift",
              specification: "黑色 / 8号",
              salePriceCents: 68000,
              stock: 10,
            },
          },
        },
        include: { skus: true },
      });
    });
    afterAll(async () => {
      if (prisma && ownsFixture) {
        await prisma.$executeRawUnsafe(
          'TRUNCATE "CommerceGiftBatch", "CommerceGiftProductCode", "CommerceGiftThrottle", "User", "CommerceProduct", "CommerceIntegrationJob", "AuditLog" CASCADE',
        );
        await prisma.globalLegalDocument.deleteMany({
          where: { version: "commerce-legal-v1" },
        });
        await prisma.appSetting.deleteMany({
          where: { key: "commerce_gift_redemption" },
        });
      }
      if (prisma) await prisma.$disconnect();
      vi.unstubAllEnvs();
    });
    async function issue(quantity = 1) {
      const requestKey = randomUUID(),
        input = {
          name: "合成验收批次",
          quantity,
          productId: product.id,
          allowedSkuIds: [product.skus[0].id],
          requestKey,
        };
      const generated = await gifts.generate(adminId, input, context());
      const values = generated
        .csv!.split("\r\n")[1]!
        .split(",")
        .map((value) => value.slice(1, -1));
      const card = await prisma.commerceGiftCard.findUniqueOrThrow({
        where: { cardNo: values[1]! },
      });
      return { generated, input, card, checkCode: values[2]! };
    }
    async function ready(issued?: Awaited<ReturnType<typeof issue>>) {
      const current = issued || (await issue());
      await gifts.change(
        adminId,
        {
          action: "ACTIVATE",
          ids: [current.card.id],
          reason: "已确认合成文件",
          downloadConfirmed: true,
        },
        context(),
      );
      return current;
    }
    async function member(
      card: { cardNo: string },
      checkCode: string,
      mobile = String(++phone),
    ) {
      const validated = await gifts.validate(
        { cardNo: card.cardNo, checkCode },
        context(),
      );
      const sms = await gifts.requestSms(
        { token: validated.token, mobile },
        context(),
      );
      expect(sms.devCode).toBe("123456");
      const login = await gifts.verifySms(
        {
          token: validated.token,
          mobile,
          code: "123456",
          consentAccepted: true,
          consentVersion: "commerce-legal-v1",
        },
        context(),
      );
      const claims = decode(login.token) as { sid: string },
        actor = { id: login.user.id, sessionId: claims.sid };
      const address = await prisma.commerceAddress.create({
        data: {
          userId: actor.id,
          name: "测试收货人",
          mobile: "13900000001",
          countryCode: "CN",
          province: "广东省",
          city: "深圳市",
          district: "南山区",
          detail: "合成地址1号",
          isDefault: true,
        },
      });
      const request = {
        token: validated.token,
        skuId: product.skus[0].id,
        addressId: address.id,
        requestKey: randomUUID(),
      };
      const quote = await gifts.preview(actor, request);
      return {
        actor,
        request: { ...request, fingerprint: quote.fingerprint },
        login,
        address,
        mobile,
      };
    }
    it("exports once, stores only salted hashes and preserves 8+2+5 numbering across batches", async () => {
      const a = await issue(2),
        b = await issue();
      expect(a.card.cardNo).toMatch(/^8\d{7}$/);
      expect(a.card.number).toBeGreaterThan(0);
      expect(a.generated.csv!.split("\r\n")[1]!.split(",")[0]).toBe(
        '"' + a.card.number + '"',
      );
      expect(b.card.number).toBe(a.card.number + 2);
      expect(a.checkCode).toMatch(/^\d{6}$/);
      expect(a.card.secretHash).not.toContain(a.checkCode);
      expect(a.card.secretHash).toMatch(/^\$2/);
      expect(Number(b.card.cardNo.slice(3))).toBe(
        Number(a.card.cardNo.slice(3)) + 2,
      );
      expect(b.card.cardNo.slice(0, 3)).toBe(a.card.cardNo.slice(0, 3));
      const repeated = await gifts.generate(adminId, a.input, context());
      expect(repeated.csv).toBeNull();
      expect(
        await prisma.commerceGiftCard.count({
          where: { batchId: a.generated.batchId },
        }),
      ).toBe(2);
      const cards = await gifts.cards({ batchId: a.generated.batchId });
      expect(JSON.stringify(cards)).not.toContain("secretHash");
      expect(JSON.stringify(cards)).not.toContain(a.card.serialNo);
      expect(cards.items.map((card) => card.serialNo)).toEqual([
        String(a.card.number + 1),
        String(a.card.number),
      ]);
      expect((await gifts.qr(a.card.id)).serialNo).toBe(String(a.card.number));
      const found = await gifts.cards({
        q: String(a.card.number),
        batchId: a.generated.batchId,
      });
      expect(found.total).toBe(1);
      expect(found.items[0]!.id).toBe(a.card.id);
      const audit = await prisma.auditLog.findMany({
        where: { entityId: a.generated.batchId },
      });
      expect(JSON.stringify(audit)).not.toContain(a.checkCode);
      await expect(
        gifts.generate(adminId, { ...a.input, quantity: 3 }, context()),
      ).rejects.toThrow("其他参数");
    });
    it("rejects unactivated, expired, void and invalid credentials without consuming cards", async () => {
      const a = await issue();
      await expect(
        gifts.validate(
          { cardNo: a.card.cardNo, checkCode: a.checkCode },
          context(),
        ),
      ).rejects.toThrow("尚未启用");
      await expect(
        gifts.change(
          adminId,
          { action: "ACTIVATE", ids: [a.card.id], reason: "test" },
          context(),
        ),
      ).rejects.toThrow("已保存");
      await ready(a);
      await expect(
        gifts.validate(
          {
            cardNo: a.card.cardNo,
            checkCode: a.checkCode === "100000" ? "999999" : "100000",
          },
          context(),
        ),
      ).rejects.toThrow("不正确");
      await prisma.commerceGiftCard.update({
        where: { id: a.card.id },
        data: { expiresAt: new Date(0) },
      });
      await expect(
        gifts.validate(
          { cardNo: a.card.cardNo, checkCode: a.checkCode },
          context(),
        ),
      ).rejects.toThrow("已过期");
      await gifts.change(
        adminId,
        { action: "VOID", ids: [a.card.id], reason: "合成作废" },
        context(),
      );
      await expect(
        gifts.validate(
          { cardNo: a.card.cardNo, checkCode: a.checkCode },
          context(),
        ),
      ).rejects.toThrow("作废");
      expect(
        await prisma.commerceGiftRedemption.count({
          where: { cardId: a.card.id },
        }),
      ).toBe(0);
    });
    it("concurrent generation returns cleartext only to one request and never reuses a consumed product sequence", async () => {
      const input = {
        name: "并发生成",
        quantity: 2,
        productId: product.id,
        allowedSkuIds: [product.skus[0].id],
        requestKey: randomUUID(),
      };
      const generated = await Promise.all([
        gifts.generate(adminId, input, context()),
        gifts.generate(adminId, input, context()),
      ]);
      expect(generated.filter((result) => result.csv)).toHaveLength(1);
      expect(generated[0]!.batchId).toBe(generated[1]!.batchId);
      const code = await prisma.commerceGiftProductCode.findUniqueOrThrow({
        where: { productId: product.id },
      });
      expect(code.lastSerial).toBe(2);
      await gifts.change(
        adminId,
        { batchId: generated[0]!.batchId, action: "VOID", reason: "丢失文件" },
        context(),
      );
      const next = await issue();
      expect(next.card.cardNo.slice(3)).toBe("00003");
      await prisma.commerceGiftProductCode.update({
        where: { productId: product.id },
        data: { lastSerial: 99999 },
      });
      await expect(issue()).rejects.toThrow("流水已用完");
    });
    it("audits cross-product rebinding while preserving the original card number, then freezes binding", async () => {
      const a = await issue();
      const other = await prisma.commerceProduct.create({
        data: {
          erpItemId: randomUUID(),
          name: "另一款合成礼品",
          status: "PUBLISHED",
          gallery: [],
          tags: [],
          skus: {
            create: {
              erpSkuId: randomUUID(),
              erpItemId: "other",
              stock: 1,
              salePriceCents: 32000,
            },
          },
        },
        include: { skus: true },
      });
      await gifts.change(
        adminId,
        {
          ids: [a.card.id],
          version: 0,
          action: "BIND",
          reason: "换款",
          productId: other.id,
          allowedSkuIds: [other.skus[0]!.id],
        },
        context(),
      );
      const rebound = await prisma.commerceGiftCard.findUniqueOrThrow({
        where: { id: a.card.id },
      });
      expect(rebound.cardNo).toBe(a.card.cardNo);
      expect(rebound.productId).toBe(other.id);
      await ready(a);
      await expect(
        gifts.change(
          adminId,
          {
            ids: [a.card.id],
            action: "BIND",
            reason: "再次改绑",
            productId: product.id,
            allowedSkuIds: [product.skus[0].id],
          },
          context(),
        ),
      ).rejects.toThrow("未启用");
      expect(
        await prisma.auditLog.count({
          where: { entityId: a.card.id, action: "GIFT_CARD_BIND" },
        }),
      ).toBe(1);
    });
    it("requires fresh gift SMS, persists failed attempts, rejects replay and reuses the verified member", async () => {
      const a = await ready(),
        mobile = String(++phone);
      const validated = await gifts.validate(
        { cardNo: a.card.cardNo, checkCode: a.checkCode },
        context(),
      );
      await auth.requestSmsCode(mobile, "login");
      await expect(
        gifts.verifySms(
          {
            token: validated.token,
            mobile,
            code: "123456",
            consentAccepted: true,
            consentVersion: "commerce-legal-v1",
          },
          context(),
        ),
      ).rejects.toThrow("验证码");
      await gifts.requestSms({ token: validated.token, mobile }, context());
      const input = {
        token: validated.token,
        mobile,
        code: "000000",
        consentAccepted: true,
        consentVersion: "commerce-legal-v1",
      };
      await expect(gifts.verifySms(input, context())).rejects.toThrow("验证码");
      expect(
        (
          await prisma.commerceGiftSession.findUniqueOrThrow({
            where: {
              tokenHash: (await import("../common/crypto")).sha256(
                validated.token,
              ),
            },
          })
        ).otpAttempts,
      ).toBe(1);
      const existing = await prisma.user.create({
        data: { mobile: "+86" + mobile, nickname: "已有会员" },
      });
      const login = await gifts.verifySms(
        { ...input, code: "123456" },
        context(),
      );
      expect(login.user.id).toBe(existing.id);
      await expect(
        gifts.verifySms({ ...input, code: "123456" }, context()),
      ).rejects.toThrow("验证码");
      await expect(
        gifts.preview(
          { id: existing.id, sessionId: randomUUID() },
          { token: validated.token },
        ),
      ).rejects.toThrow("本次短信");
    });
    it("requires the currently published agreement and leaves a stale-version SMS unconsumed", async () => {
      const a = await ready(),
        mobile = String(++phone),
        validated = await gifts.validate(
          { cardNo: a.card.cardNo, checkCode: a.checkCode },
          context(),
        );
      await gifts.requestSms({ token: validated.token, mobile }, context());
      for (const documentType of ["user_agreement", "privacy_policy"])
        await prisma.globalLegalDocument.create({
          data: {
            documentType,
            version: "gift-test-v2",
            locale: "en",
            title: "合成新协议",
            contentHtml: "<p>本地验收。</p>",
            reviewed: true,
            active: true,
            publishedAt: new Date(),
          },
        });
      try {
        await expect(
          gifts.verifySms(
            {
              token: validated.token,
              mobile,
              code: "123456",
              consentAccepted: true,
              consentVersion: "commerce-legal-v1",
            },
            context(),
          ),
        ).rejects.toThrow("协议已更新");
        expect(
          await prisma.user.count({ where: { mobile: "+86" + mobile } }),
        ).toBe(0);
        const login = await gifts.verifySms(
          {
            token: validated.token,
            mobile,
            code: "123456",
            consentAccepted: true,
            consentVersion: "gift-test-v2",
          },
          context(),
        );
        expect(
          await prisma.consentRecord.count({
            where: {
              userId: login.user.id,
              version: "gift-test-v2",
              source: "commerce_gift_sms",
            },
          }),
        ).toBe(2);
      } finally {
        await prisma.globalLegalDocument.deleteMany({
          where: { version: "gift-test-v2" },
        });
      }
    });
    it("commits exactly one zero-cash order, stock deduction, receipt, audit and ERP task under concurrent replay", async () => {
      const a = await ready(),
        m = await member(a.card, a.checkCode);
      const startedAt = Date.now();
      const values = await Promise.all([
        gifts.redeem(m.actor, m.request, context()),
        gifts.redeem(m.actor, m.request, context()),
      ]);
      expect(values[0]).toEqual(values[1]);
      const order = await prisma.commerceOrder.findUniqueOrThrow({
        where: { id: values[0]!.orderId },
        include: { items: true, paymentIntents: true },
      });
      expect(order.payableCents).toBe(0);
      expect(order.shippingCents).toBe(0);
      expect(order.giftDiscountCents).toBe(68000);
      expect(order.giftCardSerial).toBe(String(a.card.number));
      expect(order.adminRemark).toBe("礼品兑换：" + a.card.number);
      expect(order.userId).toBe(m.actor.id);
      expect(order.status).toBe("PAID");
      expect(order.paymentIntents).toHaveLength(1);
      expect(order.paymentIntents[0]).toMatchObject({
        channel: "GIFT_REDEMPTION",
        amountCents: 0,
        status: "SUCCEEDED",
      });
      expect(financialSnapshot(order).items[0]!.cashPaidCentsSnapshot).toBe(0);
      expect(
        (
          await prisma.commerceSku.findUniqueOrThrow({
            where: { id: product.skus[0].id },
          })
        ).stock,
      ).toBe(9);
      expect(
        await prisma.commerceIntegrationJob.count({
          where: { aggregateId: order.id },
        }),
      ).toBe(1);
      expect(
        await prisma.commerceCommissionAccrual.count({
          where: { orderId: order.id },
        }),
      ).toBe(0);
      const record = await prisma.commerceGiftRedemption.findUniqueOrThrow({
        where: { cardId: a.card.id },
      });
      const records = await gifts.records({ q: order.orderNo });
      expect(records.items[0]!.card.serialNo).toBe(String(a.card.number));
      const job = await prisma.commerceIntegrationJob.findFirstOrThrow({
        where: { aggregateId: order.id },
      });
      for (const timestamp of [
        order.createdAt,
        order.paymentIntents[0]!.createdAt,
        record.redeemedAt,
        job.nextRunAt,
      ]) {
        expect(timestamp.valueOf()).toBeGreaterThanOrEqual(startedAt);
        expect(timestamp.valueOf()).toBeLessThanOrEqual(Date.now());
      }
      expect(record).toMatchObject({
        verifiedMobile: "+86" + m.mobile,
        clientIp: "127.0.0.1",
        orderId: order.id,
        userId: m.actor.id,
      });
      const another = await prisma.user.create({
        data: { nickname: "另一会员" },
      });
      await expect(
        gifts.result(
          { id: another.id, sessionId: m.actor.sessionId },
          { token: m.request.token },
        ),
      ).rejects.toThrow();
      await prisma.userSession.update({
        where: { id: m.actor.sessionId },
        data: { revokedAt: new Date() },
      });
      await expect(
        gifts.result(m.actor, { token: m.request.token }),
      ).rejects.toThrow("已失效");
    });
    it("allows only one winner when different verified members redeem one card", async () => {
      const a = await ready(),
        one = await member(a.card, a.checkCode),
        two = await member(a.card, a.checkCode);
      const attempts = await Promise.allSettled([
        gifts.redeem(one.actor, one.request, context()),
        gifts.redeem(two.actor, two.request, context()),
      ]);
      expect(
        attempts.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        await prisma.commerceGiftRedemption.count({
          where: { cardId: a.card.id },
        }),
      ).toBe(1);
      const loser = attempts[0]!.status === "rejected" ? one : two;
      await expect(
        gifts.result(loser.actor, { token: loser.request.token }),
      ).rejects.toThrow("该卡已兑换");
    });
    it("serializes competing gifts for the last SKU and retains the losing card", async () => {
      const a = await ready(),
        b = await ready(),
        one = await member(a.card, a.checkCode),
        two = await member(b.card, b.checkCode);
      await prisma.commerceSku.update({
        where: { id: product.skus[0].id },
        data: { stock: 1 },
      });
      const attempts = await Promise.allSettled([
        gifts.redeem(one.actor, one.request, context()),
        gifts.redeem(two.actor, two.request, context()),
      ]);
      expect(
        attempts.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (
          await prisma.commerceSku.findUniqueOrThrow({
            where: { id: product.skus[0].id },
          })
        ).stock,
      ).toBe(0);
      expect(
        await prisma.commerceGiftCard.count({
          where: { id: { in: [a.card.id, b.card.id] }, status: "ACTIVE" },
        }),
      ).toBe(1);
    });
    it("rolls back order, settlement, stock and ERP job if redemption persistence fails", async () => {
      const a = await ready(),
        m = await member(a.card, a.checkCode);
      const faulty = prisma.$extends({
        query: {
          commerceGiftRedemption: {
            async create() {
              throw new Error("synthetic persistence failure");
            },
          },
        },
      });
      const failing = new GiftService(faulty as any, auth, {} as any);
      await expect(
        failing.redeem(m.actor, m.request, context()),
      ).rejects.toThrow("synthetic persistence failure");
      expect(
        await prisma.commerceOrder.count({ where: { userId: m.actor.id } }),
      ).toBe(0);
      expect(
        await prisma.paymentIntent.count({ where: { userId: m.actor.id } }),
      ).toBe(0);
      expect(
        (
          await prisma.commerceSku.findUniqueOrThrow({
            where: { id: product.skus[0].id },
          })
        ).stock,
      ).toBe(10);
      expect(
        (
          await prisma.commerceGiftCard.findUniqueOrThrow({
            where: { id: a.card.id },
          })
        ).status,
      ).toBe("ACTIVE");
      const order = await gifts.redeem(m.actor, m.request, context());
      expect(order.orderId).toBeTruthy();
    });
    it("rejects stale quotes, foreign addresses, expired proof and disabled members", async () => {
      const a = await ready(),
        m = await member(a.card, a.checkCode);
      await prisma.commerceSku.update({
        where: { id: product.skus[0].id },
        data: { salePriceCents: 70000 },
      });
      await expect(gifts.redeem(m.actor, m.request, context())).rejects.toThrow(
        "已变化",
      );
      await expect(
        gifts.preview(m.actor, { ...m.request, addressId: randomUUID() }),
      ).rejects.toThrow("当前会员");
      await prisma.commerceGiftSession.updateMany({
        where: { userId: m.actor.id },
        data: { verifiedAt: new Date(Date.now() - 16 * 60_000) },
      });
      await expect(gifts.preview(m.actor, m.request)).rejects.toThrow("过期");
      await prisma.user.update({
        where: { id: m.actor.id },
        data: { status: "DISABLED" },
      });
      await expect(gifts.preview(m.actor, m.request)).rejects.toThrow("已失效");
    });
    it("blocks ordinary payment and cash refunds, but exposes a zero-value exchange quote", async () => {
      const a = await ready(),
        m = await member(a.card, a.checkCode),
        result = await gifts.redeem(m.actor, m.request, context());
      const billing = new BillingService(prisma as any, {} as any, {} as any);
      await expect(
        (billing as any).resolveBusiness(
          m.actor.id,
          "COMMERCE_ORDER",
          result.orderId,
          "",
          null,
        ),
      ).rejects.toThrow("无需付款");
      const intent = await prisma.paymentIntent.findFirstOrThrow({
        where: { commerceOrderId: result.orderId },
      });
      await expect(
        billing.createRefund(intent.id, {
          amountCents: 1,
          reason: "test",
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("现金退款");
      const store = new CommerceStoreService(prisma as any);
      await expect(
        store.afterSaleQuote(m.actor.id, result.orderId, {
          type: "REFUND_ONLY",
        }),
      ).rejects.toThrow("现金退款");
      const quote = await store.afterSaleQuote(m.actor.id, result.orderId, {
        type: "EXCHANGE",
      });
      expect(quote.requestedCents).toBe(0);
    });
    it("cleans expired verification credentials without removing the redeemed card or order", async () => {
      const a = await ready(),
        m = await member(a.card, a.checkCode);
      const order = await gifts.redeem(m.actor, m.request, context());
      await prisma.commerceGiftSession.updateMany({
        where: { userId: m.actor.id },
        data: { expiresAt: new Date(0) },
      });
      const active = await prisma.commerceGiftSession.create({
        data: {
          cardId: a.card.id,
          tokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      const freshService = new GiftService(prisma as any, auth, {} as any);
      await expect(freshService.preview(m.actor, m.request)).rejects.toThrow(
        "验证已失效",
      );
      expect(
        await prisma.commerceGiftSession.count({
          where: { userId: m.actor.id },
        }),
      ).toBe(0);
      expect(
        await prisma.commerceGiftSession.findUnique({
          where: { id: active.id },
        }),
      ).not.toBeNull();
      const throttle = await prisma.commerceGiftThrottle.findFirstOrThrow();
      expect(Math.abs(throttle.windowAt.valueOf() - Date.now())).toBeLessThan(
        60_000,
      );
      expect(
        await prisma.commerceGiftRedemption.count({
          where: { orderId: order.orderId },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.commerceGiftCard.findUniqueOrThrow({
            where: { id: a.card.id },
          })
        ).status,
      ).toBe("REDEEMED");
    });
  },
);
