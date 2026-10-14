import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { vi } from "vitest";
import { BillingService } from "../billing/billing.service";
import { PartnerService } from "./partner.service";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PartnerOnboardingService } from "./partner-onboarding.service";
import { PartnerAgreementService } from "./partner-agreement.service";
import { PartnerAuthGuard, PartnerAuthService } from "./partner-auth";
import { PartnerCommerceService } from "./partner-commerce.service";
import { sha256 } from "../common/crypto";
import { hash } from "bcryptjs";

describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")(
  "partner onboarding real PostgreSQL boundaries",
  () => {
    const tag = randomUUID(),
      actor = randomUUID();
    const codeVerifier = "v".repeat(43),
      codeChallenge = createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");
    const redeem = (ticket: { ticket: string }) =>
      onboarding.redeemTicket({ ...ticket, codeVerifier });
    let prisma: PrismaClient,
      onboarding: PartnerOnboardingService,
      agreements: PartnerAgreementService,
      user: any,
      source: any,
      level: any,
      partner: any,
      application: any,
      token: string;
    const form = {
      name: "合成合作测试",
      contactName: "合成联系人",
      mobile: "19900000000",
      region: "合成地区",
      description: "隔离测试，不会创建真实合作、付款或发货",
      idempotencyKey: tag,
    };
    function context(path: string, currentToken = token) {
      return {
        switchToHttp: () => ({
          getRequest: () => ({
            path: `/api/saydian-app/vip/v1/${path}`,
            originalUrl: `/api/saydian-app/vip/v1/${path}`,
            header: () => `Bearer ${currentToken}`,
          }),
        }),
      } as any;
    }
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !/qa|test/.test(url.pathname)
      )
        throw new Error("Disposable loopback database only");
      prisma = new PrismaClient();
      onboarding = new PartnerOnboardingService(prisma as any);
      agreements = new PartnerAgreementService(prisma as any);
      // This suite needs its own QA database; original immutable acceptance data remain intact.
      await prisma.partnerAgreement.updateMany({
        where: { active: true },
        data: { active: false },
      });
      user = await prisma.user.create({
        data: {
          nickname: "合成会员",
          email: `partner-${tag}@example.invalid`,
          emailVerifiedAt: new Date(),
        },
      });
      source = await prisma.userSession.create({
        data: {
          userId: user.id,
          accessJti: randomUUID(),
          refreshTokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      level = await prisma.partnerLevel.create({
        data: { code: `qa-${tag}`, name: "合成合作等级", sort: 10000 },
      });
    });
    afterAll(async () => {
      await prisma?.$disconnect();
    });
    it("allows one pending member application under concurrency and preserves content idempotency", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => onboarding.apply(user.id, form, "qa")),
      );
      expect(new Set(results.map((x) => x.id)).size).toBe(1);
      application = results[0];
      await expect(
        onboarding.apply(user.id, { ...form, name: "篡改内容" }, "qa"),
      ).rejects.toThrow("不同内容");
      await expect(
        onboarding.apply(
          user.id,
          { ...form, idempotencyKey: randomUUID() },
          "qa",
        ),
      ).rejects.toThrow("已有申请");
      expect(
        (await onboarding.memberStatus(randomUUID())).application,
      ).toBeNull();
      const unverified = await prisma.user.create({
        data: {
          nickname: "未验证",
          email: `unverified-${tag}@example.invalid`,
        },
      });
      await expect(onboarding.apply(unverified.id, form, "qa")).rejects.toThrow(
        "验证",
      );
    });
    it("approves once, binds the exact member and initializes independent zero funds", async () => {
      const result = await Promise.all(
        Array.from({ length: 4 }, () =>
          onboarding.review(
            actor,
            application.id,
            { decision: "APPROVED", levelId: level.id, username: `qa-${tag}` },
            "qa",
          ),
        ),
      );
      expect(new Set(result.map((x) => x.partnerId)).size).toBe(1);
      partner = await prisma.brandPartner.findUniqueOrThrow({
        where: { id: result[0]!.partnerId! },
        include: { wallet: true },
      });
      expect(partner.linkedMemberId).toBe(user.id);
      expect(partner.wallet).toMatchObject({
        balanceCents: 0,
        depositCents: 0,
      });
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
          .partnerId,
      ).toBeNull();
      expect(
        await prisma.auditLog.count({
          where: {
            entityId: application.id,
            action: "PARTNER_APPLICATION_APPROVED",
          },
        }),
      ).toBe(1);
      await expect(
        onboarding.review(
          actor,
          application.id,
          { decision: "REJECTED", reason: "冲突" },
          "qa",
        ),
      ).rejects.toThrow("已审核");
    });
    it("redeems a hashed short lived ticket once and rejects use after account epoch change", async () => {
      const ticket = await onboarding.loginTicket(user.id, source.id, {
        codeChallenge,
      });
      await expect(
        onboarding.redeemTicket({
          ...ticket,
          codeVerifier: "wrong-browser".padEnd(43, "x"),
        }),
      ).rejects.toThrow("浏览器不匹配");
      const stored = await prisma.partnerLoginTicket.findUniqueOrThrow({
        where: { tokenHash: sha256(ticket.ticket) },
      });
      expect(stored.tokenHash).not.toBe(ticket.ticket);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 6 }, () => redeem(ticket)),
      );
      expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      token = (
        outcomes.find(
          (x) => x.status === "fulfilled",
        ) as PromiseFulfilledResult<any>
      ).value.token;
      expect(
        await new PartnerAuthGuard(prisma as any).canActivate(
          context("wallet"),
        ),
      ).toBe(true);
      const outdated = await onboarding.loginTicket(user.id, source.id, {
        codeChallenge,
      });
      await prisma.brandPartner.update({
        where: { id: partner.id },
        data: { name: "更新资料" },
      });
      await expect(redeem(outdated)).rejects.toThrow("失效");
      const expired = await onboarding.loginTicket(user.id, source.id, {
        codeChallenge,
      });
      await prisma.partnerLoginTicket.update({
        where: { tokenHash: sha256(expired.ticket) },
        data: { expiresAt: new Date(0) },
      });
      await expect(redeem(expired)).rejects.toThrow("失效");
    });
    it("does not enforce drafts, then requires reading and current version acceptance on server", async () => {
      const document = await agreements.draft(
        actor,
        {
          title: "合成合作协议",
          version: `qa-${tag}`,
          content: "合成草稿，验证版本签署，不是正式协议。",
        },
        "qa",
      );
      expect(
        (await agreements.current(partner.id, randomUUID())).agreement,
      ).toBeNull();
      expect(
        await new PartnerAuthGuard(prisma as any).canActivate(
          context("orders"),
        ),
      ).toBe(true);
      await agreements.publish(
        actor,
        document.id,
        { contentSha256: document.contentSha256 },
        "qa",
      );
      await expect(
        new PartnerAuthGuard(prisma as any).canActivate(context("orders")),
      ).rejects.toMatchObject({
        response: { errorKey: "PARTNER_AGREEMENT_REQUIRED" },
      });
      expect(
        await new PartnerAuthGuard(prisma as any).canActivate(
          context("agreement"),
        ),
      ).toBe(true);
      await expect(
        agreements.accept(
          partner.id,
          randomUUID(),
          {
            agreementId: document.id,
            contentSha256: document.contentSha256,
            agreed: true,
          },
          "qa",
        ),
      ).rejects.toThrow("先打开");
      await agreements.current(partner.id, randomUUID());
      await expect(
        agreements.accept(
          partner.id,
          randomUUID(),
          { agreementId: document.id, contentSha256: "changed", agreed: true },
          "qa",
        ),
      ).rejects.toThrow("更新");
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          agreements.accept(
            partner.id,
            randomUUID(),
            {
              agreementId: document.id,
              contentSha256: document.contentSha256,
              agreed: true,
            },
            "qa",
            "127.0.0.1",
            "synthetic-client",
          ),
        ),
      );
      expect(results.every((x) => x.accepted)).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: {
            entityId: document.id,
            actorId: partner.id,
            action: "PARTNER_AGREEMENT_ACCEPTED",
          },
        }),
      ).toBe(1);
      expect(
        await new PartnerAuthGuard(prisma as any).canActivate(
          context("orders"),
        ),
      ).toBe(true);
      await expect(
        prisma.partnerAgreement.update({
          where: { id: document.id },
          data: { content: "篡改" },
        }),
      ).rejects.toThrow("immutable");
      const receipt = await prisma.partnerAgreementAcceptance.findUniqueOrThrow(
        {
          where: {
            partnerId_agreementId: {
              partnerId: partner.id,
              agreementId: document.id,
            },
          },
        },
      );
      await expect(
        prisma.partnerAgreementAcceptance.update({
          where: { id: receipt.id },
          data: { acceptedAt: null },
        }),
      ).rejects.toThrow("immutable");
      const next = await agreements.draft(
        actor,
        { title: "新合成协议", version: `qa-next-${tag}`, content: "新版本" },
        "qa",
      );
      await agreements.publish(
        actor,
        next.id,
        { contentSha256: next.contentSha256 },
        "qa",
      );
      await expect(
        new PartnerAuthGuard(prisma as any).canActivate(context("products")),
      ).rejects.toThrow("合作协议");
      await prisma.partnerAgreement.update({
        where: { id: next.id },
        data: { active: false },
      });
    });
    it("filters unpriced/disabled/unavailable SKUs and product counts before pagination", async () => {
      const product = await prisma.commerceProduct.create({
        data: {
          source: "LOCAL",
          erpItemId: `qa-${tag}`,
          name: "合成报价商品",
          status: "PUBLISHED",
          skus: {
            create: [
              {
                erpSkuId: `qa-one-${tag}`,
                erpItemId: `qa-${tag}`,
                salePriceCents: 1000,
              },
              {
                erpSkuId: `qa-two-${tag}`,
                erpItemId: `qa-${tag}`,
                salePriceCents: 2000,
              },
            ],
          },
        },
        include: { skus: true },
      });
      const commerce = new PartnerCommerceService(prisma as any);
      expect(
        (await commerce.products(partner.id, "合成报价商品", 1)).items,
      ).toHaveLength(0);
      await prisma.partnerSkuPrice.create({
        data: {
          levelId: level.id,
          skuId: product.skus[0]!.id,
          priceCents: 800,
        },
      });
      const result = await commerce.products(partner.id, "合成报价商品", 1);
      expect(result.total).toBe(1);
      expect(result.items[0]!.skus).toHaveLength(1);
      await prisma.partnerSkuPrice.update({
        where: {
          levelId_skuId: { levelId: level.id, skuId: product.skus[0]!.id },
        },
        data: { enabled: false },
      });
      expect(
        (await commerce.products(partner.id, "合成报价商品", 1)).total,
      ).toBe(0);
    });
    it("stores and credits JSAPI and H5 recharges using the existing payment ownership constraints", async () => {
      const provider = {
        identity: vi.fn(async () => ({
          merchantId: "SYNTHETIC-MERCHANT",
          appId: "SYNTHETIC-APP",
        })),
        resolveOfficialPayer: vi.fn(async () => "SYNTHETIC-OPENID"),
        create: vi.fn(async () => ({ type: "SYNTHETIC_PAYMENT" })),
      };
      const billing = new BillingService(
          prisma as any,
          provider as any,
          {} as any,
        ),
        service = new PartnerService(prisma as any, billing);
      for (const [channel, ua] of [
        ["wechat_jsapi", "iPhone MicroMessenger"],
        ["wechat_h5", "iPhone Safari"],
      ]) {
        const idempotencyKey = randomUUID();
        const recharge = await service.createRecharge(
          partner.id,
          { amountCents: 100, channel, idempotencyKey },
          "127.0.0.1",
          ua,
        );
        const intent = await prisma.paymentIntent.findUniqueOrThrow({
          where: { id: recharge.payment.id },
        });
        expect(intent).toMatchObject({
          partnerId: partner.id,
          userId: null,
          amountCents: 100,
        });
        await Promise.all(
          Array.from({ length: 4 }, () =>
            billing.markPaid(intent.paymentNo, `SYNTHETIC-${intent.id}`, 100, {
              mchid: "SYNTHETIC-MERCHANT",
              appid: "SYNTHETIC-APP",
              amount: { currency: "CNY" },
            }),
          ),
        );
        const replay = await service.createRecharge(
          partner.id,
          { amountCents: 100, channel, idempotencyKey },
          "127.0.0.1",
          "Desktop Chrome",
        );
        expect(replay.id).toBe(recharge.id);
      }
      expect(provider.resolveOfficialPayer).toHaveBeenCalledWith(
        user.id,
        "SYNTHETIC-APP",
      );
      expect(
        (
          await prisma.partnerWallet.findUniqueOrThrow({
            where: { partnerId: partner.id },
          })
        ).balanceCents,
      ).toBe(200);
      await expect(
        service.createRecharge(
          partner.id,
          {
            amountCents: 100,
            channel: "alipay_wap",
            idempotencyKey: randomUUID(),
          },
          "127.0.0.1",
          "iPhone MicroMessenger",
        ),
      ).rejects.toThrow("当前浏览器");
    });
    it("revokes member-derived access after member logout and account disable/reset", async () => {
      await prisma.userSession.update({
        where: { id: source.id },
        data: { revokedAt: new Date() },
      });
      await expect(
        new PartnerAuthGuard(prisma as any).canActivate(context("wallet")),
      ).rejects.toThrow("会员登录已失效");
      await prisma.brandPartner.update({
        where: { id: partner.id },
        data: { passwordHash: await hash("synthetic-only-password", 4) },
      });
      const auth = new PartnerAuthService(prisma as any),
        passwordSession = await auth.login({
          username: partner.username,
          password: "synthetic-only-password",
        });
      await prisma.brandPartner.update({
        where: { id: partner.id },
        data: { active: false },
      });
      await expect(
        new PartnerAuthGuard(prisma as any).canActivate(
          context("wallet", passwordSession.token),
        ),
      ).rejects.toThrow("登录已失效");
    });
  },
);
