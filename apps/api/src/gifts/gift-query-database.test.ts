import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GiftQueryService } from "./gift-query.service";

describe.runIf(process.env.RUN_GIFT_DATABASE_TESTS === "1")(
  "gift inquiry PostgreSQL acceptance",
  () => {
    let db: PrismaClient,
      service: GiftQueryService,
      ownsFixture = false;
    const context = { ip: "127.0.0.1", requestId: "synthetic-query-test" };
    const password = "synthetic-query-password";
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !/^\/saydian_gift_test_[0-9a-f]+$/.test(url.pathname)
      )
        throw new Error(
          "Only the owned isolated loopback gift test database is allowed",
        );
      db = new PrismaClient();
      if (
        (await db.giftQueryAccount.count()) ||
        (await db.giftQueryLog.count()) ||
        (await db.commerceGiftCard.count()) ||
        (await db.user.count())
      )
        throw new Error(
          "Existing data retained; inquiry tests require an empty owned database",
        );
      ownsFixture = true;
      service = new GiftQueryService(db as any);
    });
    afterAll(async () => {
      if (db && ownsFixture)
        await db.$executeRawUnsafe(
          'TRUNCATE "GiftQueryLog", "GiftQuerySession", "GiftQueryAccount", "CommerceGiftBatch", "CommerceGiftProductCode", "CommerceGiftThrottle", "User", "CommerceProduct", "AuditLog" CASCADE',
        );
      if (db) await db.$disconnect();
    });
    async function account() {
      const created = await service.saveAccount(
        randomUUID(),
        undefined,
        {
          username: "q_" + randomUUID().replaceAll("-", ""),
          displayName: "合成查询账号",
          password,
          active: true,
        },
        context,
      );
      const login = await service.login(
        { username: created.username, password },
        context,
      );
      return { created, login };
    }
    it("looks up exact cardNo independent of management number and audits only safe response fields", async () => {
      const { created, login } = await account();
      const product = await db.commerceProduct.create({
        data: {
          erpItemId: randomUUID(),
          name: "合成查询礼品",
          source: "LOCAL",
          status: "PUBLISHED",
          gallery: [],
          tags: [],
          skus: {
            create: {
              erpSkuId: randomUUID(),
              erpItemId: "synthetic-query-product",
              salePriceCents: 1,
              stock: 10,
            },
          },
        },
        include: { skus: true },
      });
      const batch = await db.commerceGiftBatch.create({
        data: {
          batchNo: randomUUID(),
          name: "合成批次",
          requestKey: randomUUID(),
          requestHash: "synthetic",
          createdById: randomUUID(),
        },
      });
      const base = {
        batchId: batch.id,
        productId: product.id,
        allowedSkuIds: [product.skus[0]!.id],
        secretHash: "synthetic-private-hash",
      };
      await db.commerceGiftCard.create({
        data: {
          ...base,
          cardNo: "80100611",
          serialNo: randomUUID(),
          status: "REDEEMED",
        },
      });
      await db.commerceGiftCard.create({
        data: {
          ...base,
          cardNo: "80100612",
          serialNo: randomUUID(),
          status: "ACTIVE",
        },
      });
      // A management ID equal to another card's printed cardNo must never be selected.
      await db.commerceGiftCard.create({
        data: {
          ...base,
          number: 80100611,
          cardNo: "80100613",
          serialNo: randomUUID(),
          status: "DRAFT",
        },
      });
      const user = await db.user.create({ data: { nickname: "合成兑换人" } });
      const order = await db.commerceOrder.create({
        data: {
          orderNo: "SYNTHETIC-QUERY-" + randomUUID(),
          userId: user.id,
          status: "REFUNDED",
          subtotalCents: 1,
          payableCents: 0,
          recipientName: "仅合成收货人",
          recipientMobile: "13900000000",
          province: "合成省",
          city: "合成市",
          district: "合成区",
          addressDetail: "合成私有地址",
          idempotencyKey: randomUUID(),
        },
      });
      const card = await db.commerceGiftCard.findUniqueOrThrow({
        where: { cardNo: "80100611" },
      });
      await db.commerceGiftRedemption.create({
        data: {
          cardId: card.id,
          orderId: order.id,
          userId: user.id,
          memberNoSnapshot: user.compatibilityId,
          verifiedMobile: "13800000000",
          verifiedAt: new Date(),
          requestKey: randomUUID(),
          requestHash: "synthetic",
          productSnapshot: {},
          addressSnapshot: {},
        },
      });
      const before = await db.commerceGiftCard.findMany({
        orderBy: { cardNo: "asc" },
      });
      const result = await service.query(
        login.token,
        { cardNos: ["80100611", "80100612", "80100999", "80100611"] },
        context,
      );
      expect(result.items).toEqual([
        { cardNo: "80100611", status: "REDEEMED", orderNo: order.orderNo },
        { cardNo: "80100612", status: "NOT_REDEEMED", orderNo: null },
        { cardNo: "80100999", status: "NOT_FOUND", orderNo: null },
      ]);
      expect(
        await db.commerceGiftCard.findMany({ orderBy: { cardNo: "asc" } }),
      ).toEqual(before);
      const logs = await service.logs({ accountId: created.id });
      expect(logs.total).toBe(1);
      expect(logs.items[0]?.results).toEqual(result.items);
      expect(JSON.stringify(logs)).not.toMatch(
        /13900000000|13800000000|私有地址|secretHash|userId|password/,
      );
      const stats = (await service.accounts()).find(
        (a) => a.id === created.id,
      )!;
      expect(stats).toMatchObject({
        queryCount: 1,
        failedCount: 0,
        cardCount: 3,
        redeemedCount: 1,
      });
      expect(stats).not.toHaveProperty("passwordHash");
      // A refunded order still represents a completed redemption, never a reusable card.
      expect(
        (await db.commerceOrder.findUniqueOrThrow({ where: { id: order.id } }))
          .status,
      ).toBe("REFUNDED");
    });
    it("persists invalid attempts, filters/paginates by account, and counts repeated queries separately", async () => {
      const { created, login } = await account();
      await expect(
        service.query(
          login.token,
          { cardNos: "arbitrary-invalid-content" },
          context,
        ),
      ).rejects.toThrow("8位卡号");
      for (let i = 0; i < 31; i++)
        await service.query(login.token, { cardNos: "80100612" }, context);
      const a = await service.logs({ accountId: created.id }),
        b = await service.logs({ accountId: created.id, page: "2" });
      expect(a.total).toBe(32);
      expect(a.items).toHaveLength(30);
      expect(b.items).toHaveLength(2);
      expect(a.items.every((log) => log.accountId === created.id)).toBe(true);
      expect(
        b.items.find((log) => log.outcome === "INVALID_INPUT")?.results,
      ).toEqual([]);
      expect(
        (await service.accounts()).find((row) => row.id === created.id),
      ).toMatchObject({ queryCount: 32, failedCount: 1, cardCount: 31 });
      expect(
        JSON.stringify(await service.logs({ accountId: created.id })),
      ).not.toContain("arbitrary-invalid-content");
    });
    it("rejects other identity tokens and expired/revoked sessions", async () => {
      const { login } = await account();
      await expect(
        service.query("m".repeat(64), { cardNos: "80100611" }, context),
      ).rejects.toThrow("登录已失效");
      await service.logout(login.token);
      await expect(service.me(login.token)).rejects.toThrow("登录已失效");
      const fresh = await account();
      await db.giftQuerySession.updateMany({
        where: { accountId: fresh.created.id },
        data: { expiresAt: new Date(0) },
      });
      await expect(
        service.query(fresh.login.token, { cardNos: "80100611" }, context),
      ).rejects.toThrow("登录已失效");
    });
    it("disable/enable never resurrects sessions and optimistic conflicts preserve data", async () => {
      const { created, login } = await account();
      const changed = await service.saveAccount(
        randomUUID(),
        created.id,
        { displayName: "合成停用", active: false, version: 0 },
        context,
      );
      await expect(service.me(login.token)).rejects.toThrow("登录已失效");
      await expect(
        service.saveAccount(
          randomUUID(),
          created.id,
          { displayName: "旧提交", active: true, version: 0 },
          context,
        ),
      ).rejects.toThrow("已变化");
      await service.saveAccount(
        randomUUID(),
        created.id,
        { displayName: "合成启用", active: true, version: changed.version },
        context,
      );
      await expect(service.me(login.token)).rejects.toThrow("登录已失效");
      await expect(
        service.login({ username: created.username, password }, context),
      ).resolves.toHaveProperty("token");
    });
    it("password reset revokes every old session and no hashes enter administrator audits", async () => {
      const { created, login } = await account(),
        next = "next-synthetic-password";
      const other = await service.login(
        { username: created.username, password },
        context,
      );
      await service.saveAccount(
        randomUUID(),
        created.id,
        { displayName: "合成新密码", active: true, version: 0, password: next },
        context,
      );
      await expect(service.me(login.token)).rejects.toThrow("登录已失效");
      await expect(service.me(other.token)).rejects.toThrow("登录已失效");
      await expect(
        service.login({ username: created.username, password }, context),
      ).rejects.toThrow("账号或密码错误");
      await expect(
        service.login({ username: created.username, password: next }, context),
      ).resolves.toHaveProperty("token");
      expect(
        JSON.stringify(
          await db.auditLog.findMany({ where: { entityId: created.id } }),
        ),
      ).not.toMatch(
        /passwordHash|next-synthetic-password|synthetic-query-password/,
      );
    });
    it("query waits for an account disable transaction and returns no result/log after it commits", async () => {
      const { created, login } = await account();
      let acquired!: () => void, release!: () => void;
      const ready = new Promise<void>((yes) => {
          acquired = yes;
        }),
        unblock = new Promise<void>((yes) => {
          release = yes;
        });
      const edit = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "GiftQueryAccount" WHERE id=${created.id}::uuid FOR UPDATE`;
        acquired();
        await unblock;
        await tx.giftQueryAccount.update({
          where: { id: created.id },
          data: { active: false, version: { increment: 1 } },
        });
        await tx.giftQuerySession.updateMany({
          where: { accountId: created.id },
          data: { revokedAt: new Date() },
        });
      });
      await ready;
      // Attach rejection handling before releasing to avoid an unhandled rejection.
      const pending = service
        .query(login.token, { cardNos: "80100611" }, context)
        .then(
          () => "unexpected-success",
          () => "denied",
        );
      release();
      await edit;
      expect(await pending).toBe("denied");
      expect(
        await db.giftQueryLog.count({ where: { accountId: created.id } }),
      ).toBe(0);
    });
    it("enforces account limits across distinct service instances", async () => {
      const { login } = await account(),
        other = new GiftQueryService(db as any);
      await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
          (i % 2 ? service : other).query(
            login.token,
            { cardNos: "80100612" },
            context,
          ),
        ),
      );
      await expect(
        other.query(login.token, { cardNos: "80100612" }, context),
      ).rejects.toMatchObject({ status: 429 });
    });
  },
);
