import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  HttpException,
} from "@nestjs/common";
import {
  BusinessType,
  PaymentChannel,
  PaymentStatus,
  Prisma,
} from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { randomInt, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { PrismaService } from "../common/prisma.service";
import {
  isUuid,
  normalizedMobile,
  randomToken,
  safeObject,
  sha256,
} from "../common/crypto";
import { globalLegalBundle } from "../auth/global-legal";
import { AuthService } from "../auth/auth.service";
import { SmsAdapterService } from "../auth/sms-adapter.service";
import { completeCommercePayment } from "../commerce/commerce-payment-settlement";
import { markPaymentStockItems } from "../commerce/commerce-payment-stock";
import {
  assertGiftAvailable,
  giftBinding,
  giftCardNumber,
  giftCheckCode,
  giftCsv,
  giftNumber,
  giftPayloadHash,
  giftPublicCard,
  giftRequestKey,
  giftSecret,
  giftSessionMs,
  giftVerificationMs,
  formatGiftCardNo,
  giftAvailability,
} from "./gift-policy";

type Actor = { id: string; sessionId: string };
type Context = { ip?: string | undefined; requestId?: string | undefined };
type Db = Prisma.TransactionClient;
const adminCardSelect = {
  id: true,
  batchId: true,
  number: true,
  cardNo: true,
  status: true,
  productId: true,
  allowedSkuIds: true,
  expiresAt: true,
  version: true,
  createdAt: true,
} as const;
const pageOf = (value: unknown) =>
  Math.max(1, Math.min(100_000, Number.parseInt(String(value || 1), 10) || 1));

@Injectable()
export class GiftService {
  private cleanupAfter = 0;
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sms: SmsAdapterService,
  ) {}

  async capabilities() {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: "commerce_gift_redemption" },
    });
    return {
      enabled:
        process.env.DEPLOYMENT_SITE !== "us" &&
        safeObject(setting?.value).enabled === true,
    };
  }
  private async enabled() {
    if (!(await this.capabilities()).enabled)
      throw new ServiceUnavailableException("礼品兑换暂未开放，请联系发卡方");
    // Bounded cleanup on a permitted write request. Public GETs never mutate data.
    const now = Date.now(),
      clock = Prisma.sql`(${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
      yesterday = Prisma.sql`(${new Date(Date.now() - 86_400_000).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    if (now >= this.cleanupAfter) {
      this.cleanupAfter = now + 300_000;
      await this.prisma
        .$executeRaw`DELETE FROM "CommerceGiftSession" WHERE id IN (SELECT id FROM "CommerceGiftSession" WHERE "expiresAt" <= ${clock} ORDER BY "expiresAt" LIMIT 500)`;
      await this.prisma
        .$executeRaw`DELETE FROM "CommerceGiftThrottle" WHERE key IN (SELECT key FROM "CommerceGiftThrottle" WHERE "windowAt" < ${yesterday} LIMIT 1000)`;
    }
  }
  async settings(adminId: string, input: unknown, context: Context) {
    const body = safeObject(input);
    if (typeof body.enabled !== "boolean")
      throw new BadRequestException("请选择是否开放兑换");
    return this.prisma.$transaction(async (tx) => {
      const enabled = body.enabled === true;
      const previous = await tx.appSetting.findUnique({
        where: { key: "commerce_gift_redemption" },
      });
      await tx.appSetting.upsert({
        where: { key: "commerce_gift_redemption" },
        create: {
          key: "commerce_gift_redemption",
          value: { enabled },
          public: false,
        },
        update: { value: { enabled }, public: false },
      });
      await this.audit(
        tx,
        adminId,
        "GIFT_SETTINGS",
        "settings",
        previous?.value ?? null,
        { enabled },
        context,
      );
      return { enabled };
    });
  }
  private link(cardNo: string) {
    const base = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8080/";
    return new URL(
      `/global/saidian-mall/#/pages/gift-redemption/index?cardNo=${encodeURIComponent(cardNo)}`,
      base,
    ).href;
  }
  async qr(id: string) {
    if (!isUuid(id)) throw new NotFoundException("兑换卡不存在");
    const card = await this.prisma.commerceGiftCard.findUnique({
      where: { id },
      select: adminCardSelect,
    });
    if (!card) throw new NotFoundException("兑换卡不存在");
    const link = this.link(card.cardNo);
    return {
      serialNo: String(card.number),
      cardNo: card.cardNo,
      link,
      qrDataUrl: await QRCode.toDataURL(link, { width: 400, margin: 2 }),
    };
  }
  async batches(query: Record<string, string>) {
    const page = pageOf(query.page),
      q = String(query.q || "").slice(0, 80);
    const where = q
      ? { OR: [{ name: { contains: q } }, { batchNo: { contains: q } }] }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.commerceGiftBatch.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * 20,
        take: 20,
        select: {
          id: true,
          batchNo: true,
          name: true,
          createdAt: true,
          createdById: true,
          activatedAt: true,
          _count: { select: { cards: true } },
        },
      }),
      this.prisma.commerceGiftBatch.count({ where }),
    ]);
    return { items, total, page };
  }
  async cards(query: Record<string, string>) {
    const page = pageOf(query.page),
      q = String(query.q || "").slice(0, 80);
    const where: Prisma.CommerceGiftCardWhereInput = {
      ...(query.batchId && isUuid(query.batchId)
        ? { batchId: query.batchId }
        : {}),
      ...(q
        ? {
            AND: [
              {
                OR: this.cardSearch(q),
              },
            ],
          }
        : {}),
      ...(query.status === "EXPIRED"
        ? { status: "ACTIVE", expiresAt: { lte: new Date() } }
        : ["DRAFT", "ACTIVE", "REDEEMED", "VOID"].includes(query.status || "")
          ? {
              status: query.status!,
              ...(query.status === "ACTIVE"
                ? {
                    OR: [
                      { expiresAt: null },
                      { expiresAt: { gt: new Date() } },
                    ],
                  }
                : {}),
            }
          : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.commerceGiftCard.findMany({
        where,
        select: {
          ...adminCardSelect,
          product: { select: { name: true, displayName: true } },
          batch: { select: { name: true, batchNo: true } },
          redemption: {
            select: {
              orderId: true,
              redeemedAt: true,
              userId: true,
              order: { select: { orderNo: true } },
            },
          },
        },
        orderBy: { number: "desc" },
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.commerceGiftCard.count({ where }),
    ]);
    return {
      items: items.map((card) => ({
        ...giftPublicCard(card),
        product: card.product,
        batch: card.batch,
        redemption: card.redemption,
      })),
      total,
      page,
    };
  }
  async records(query: Record<string, string>) {
    const page = pageOf(query.page),
      q = String(query.q || "").slice(0, 80);
    const where: Prisma.CommerceGiftRedemptionWhereInput = q
      ? {
          OR: [
            { verifiedMobile: { contains: q } },
            {
              card: {
                OR: this.cardSearch(q),
              },
            },
            { order: { orderNo: { contains: q } } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.commerceGiftRedemption.findMany({
        where,
        include: {
          card: { select: { number: true, cardNo: true } },
          order: { select: { orderNo: true, status: true } },
        },
        orderBy: { redeemedAt: "desc" },
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.prisma.commerceGiftRedemption.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        card: { serialNo: String(item.card.number), cardNo: item.card.cardNo },
      })),
      total,
      page,
    };
  }
  private cardSearch(value: string): Prisma.CommerceGiftCardWhereInput[] {
    if (!/^\d+$/.test(value)) return [{ serialNo: { contains: value } }];
    const number = Number(value);
    const numbered =
      Number.isSafeInteger(number) && number > 0 && number <= 2_147_483_647
        ? [{ number }]
        : [];
    return [...numbered, { cardNo: value }];
  }
  async products() {
    return this.prisma.commerceProduct.findMany({
      where: {
        status: "PUBLISHED",
        localArchived: false,
        skus: { some: { enabled: true } },
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        skus: {
          where: { enabled: true },
          select: { id: true, specification: true, stock: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
  }
  private async binding(db: Db, input: unknown) {
    const binding = giftBinding(input);
    const product = await db.commerceProduct.findFirst({
      where: {
        id: binding.productId,
        status: "PUBLISHED",
        localArchived: false,
      },
      include: {
        skus: { where: { id: { in: binding.allowedSkuIds }, enabled: true } },
      },
    });
    if (!product || product.skus.length !== binding.allowedSkuIds.length)
      throw new BadRequestException(
        "商品已下架或所选规格不属于该商品，请重新选择",
      );
    return { binding, product };
  }
  async generate(adminId: string, input: unknown, context: Context) {
    const body = safeObject(input),
      requestKey = giftRequestKey(body.requestKey),
      name = String(body.name || "").trim();
    if (
      !name ||
      name.length > 80 ||
      !Number.isInteger(body.quantity) ||
      Number(body.quantity) < 1 ||
      Number(body.quantity) > 100
    )
      throw new BadRequestException("请输入批次名称，每批可生成1至100张卡");
    const binding = giftBinding(body),
      requestHash = giftPayloadHash([name, body.quantity, binding]);
    const previous = await this.prisma.commerceGiftBatch.findUnique({
      where: { requestKey },
    });
    const repeated = (batch: NonNullable<typeof previous>) => {
      if (batch.createdById !== adminId || batch.requestHash !== requestHash)
        throw new ConflictException("生成请求编号已用于其他参数");
      return {
        batchId: batch.id,
        batchNo: batch.batchNo,
        alreadyGenerated: true,
        filename: null,
        csv: null,
      };
    };
    if (previous) return repeated(previous);
    // Bounded batch and sequential hashing avoid unbounded server memory use.
    const cards: Array<{
      id: string;
      serialNo: string;
      secret: string;
      secretHash: string;
    }> = [];
    for (let index = 0; index < Number(body.quantity); index++) {
      const secret = giftSecret();
      cards.push({
        id: randomUUID(),
        serialNo: giftNumber("GN"),
        secret,
        secretHash: await hash(secret, 12),
      });
    }
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended('commerce-gift-numbering', 0))`;
          const existing = await tx.commerceGiftBatch.findUnique({
            where: { requestKey },
          });
          if (existing) return repeated(existing);
          const { product } = await this.binding(tx, body);
          let productCode = await tx.commerceGiftProductCode.findUnique({
            where: { productId: product.id },
          });
          if (!productCode) {
            const last = await tx.commerceGiftProductCode.findFirst({
              orderBy: { code: "desc" },
            });
            const code = (last?.code || 0) + 1;
            if (code > 99)
              throw new ConflictException(
                "两位商品编号已分配完，最多支持99款兑换商品",
              );
            productCode = await tx.commerceGiftProductCode.create({
              data: { productId: product.id, code },
            });
          }
          if (productCode.lastSerial + cards.length > 99999)
            throw new ConflictException("该商品的五位卡号流水已用完");
          const numbered = cards.map((card, index) => ({
            ...card,
            cardNo: formatGiftCardNo(
              productCode!.code,
              productCode!.lastSerial + index + 1,
            ),
          }));
          await tx.commerceGiftProductCode.update({
            where: { productId: product.id },
            data: { lastSerial: { increment: cards.length } },
          });
          const batch = await tx.commerceGiftBatch.create({
            data: {
              batchNo: giftNumber("GB"),
              createdAt: new Date(),
              name,
              requestKey,
              requestHash,
              createdById: adminId,
            },
          });
          await tx.commerceGiftCard.createMany({
            data: numbered.map(({ secret: _secret, ...card }) => ({
              ...card,
              ...binding,
              createdAt: new Date(),
              batchId: batch.id,
            })),
          });
          const persisted = await tx.commerceGiftCard.findMany({
            where: { batchId: batch.id },
            select: { id: true, number: true },
          });
          const numbers = new Map(
            persisted.map((card) => [card.id, card.number]),
          );
          await this.audit(
            tx,
            adminId,
            "GIFT_BATCH_GENERATE_ONCE",
            batch.id,
            null,
            {
              batchNo: batch.batchNo,
              name,
              quantity: cards.length,
              ...binding,
            },
            context,
          );
          const csv = giftCsv([
            ["编号", "卡号", "校验码", "绑定商品", "有效期", "兑换链接"],
            ...numbered.map((card) => [
              numbers.get(card.id)!,
              card.cardNo,
              card.secret,
              product.displayName || product.name,
              binding.expiresAt?.toISOString() || "不限",
              this.link(card.cardNo),
            ]),
          ]);
          return {
            batchId: batch.id,
            batchNo: batch.batchNo,
            alreadyGenerated: false,
            filename: batch.batchNo + ".csv",
            csv,
          };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      const committed = await this.prisma.commerceGiftBatch.findUnique({
        where: { requestKey },
      });
      if (committed) return repeated(committed);
      throw error;
    }
  }
  async change(adminId: string, input: unknown, context: Context) {
    const body = safeObject(input),
      action = String(body.action || ""),
      reason = String(body.reason || "").trim();
    if (
      !["ACTIVATE", "BIND", "VOID"].includes(action) ||
      !reason ||
      reason.length > 200
    )
      throw new BadRequestException("请选择操作并填写原因（最多200字）");
    if (action === "ACTIVATE" && body.downloadConfirmed !== true)
      throw new BadRequestException("请先确认已保存明文下载文件");
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (
      (body.batchId !== undefined && !isUuid(String(body.batchId))) ||
      (!body.batchId && !ids.length) ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== "string" || !isUuid(id))
    )
      throw new BadRequestException("请选择有效卡片或批次");
    return this.prisma.$transaction(
      async (tx) => {
        const rows = isUuid(String(body.batchId || ""))
          ? await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT id FROM "CommerceGiftCard" WHERE "batchId" = ${body.batchId as string}::uuid ORDER BY id FOR UPDATE`
          : await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT id FROM "CommerceGiftCard" WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${String(id)}::uuid`))}) ORDER BY id FOR UPDATE`;
        if (!rows.length || (!body.batchId && rows.length !== ids.length))
          throw new NotFoundException("部分兑换卡不存在，请刷新后重试");
        const cards = await tx.commerceGiftCard.findMany({
          where: { id: { in: rows.map((row) => row.id) } },
        });
        if (action === "BIND" && cards.some((card) => card.status !== "DRAFT"))
          throw new ConflictException("仅未启用卡片可以改绑或启用");
        if (
          body.version !== undefined &&
          (cards.length !== 1 || cards[0]!.version !== body.version)
        )
          throw new ConflictException("卡片已变化，请刷新后重试");
        const eligible = cards.filter((card) =>
          action === "VOID"
            ? ["DRAFT", "ACTIVE"].includes(card.status)
            : card.status === "DRAFT",
        );
        if (!eligible.length)
          throw new ConflictException("没有可操作的卡片，已兑换卡不可作废");
        const binding =
          action === "BIND"
            ? (await this.binding(tx, body)).binding
            : undefined;
        if (action === "ACTIVATE")
          for (const card of eligible) await this.binding(tx, card);
        for (const card of eligible) {
          const next = await tx.commerceGiftCard.update({
            where: { id: card.id },
            data: {
              ...(binding || {}),
              ...(action === "ACTIVATE"
                ? { status: "ACTIVE" }
                : action === "VOID"
                  ? { status: "VOID" }
                  : {}),
              version: { increment: 1 },
            },
          });
          await this.audit(
            tx,
            adminId,
            "GIFT_CARD_" + action,
            card.id,
            giftPublicCard(card),
            { ...giftPublicCard(next), reason },
            context,
          );
        }
        if (action === "ACTIVATE")
          await tx.commerceGiftBatch.updateMany({
            where: {
              id: { in: [...new Set(cards.map((card) => card.batchId))] },
            },
            data: { activatedAt: new Date(), activatedById: adminId },
          });
        return { changed: eligible.length };
      },
      { timeout: 15_000 },
    );
  }
  private async audit(
    tx: Db,
    actorId: string,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
    context: Context,
  ) {
    await tx.auditLog.create({
      data: {
        actorType: "ADMIN",
        createdAt: new Date(),
        actorId,
        action,
        entityType: "commerce_gift",
        entityId: id,
        requestId: context.requestId ?? null,
        beforeJson:
          before === null
            ? Prisma.JsonNull
            : JSON.parse(JSON.stringify(before)),
        afterJson: JSON.parse(JSON.stringify(after)),
      },
    });
  }
  private async rate(key: string, limit: number, milliseconds: number) {
    const digest = sha256(key),
      clock = Prisma.sql`(${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
      start = Prisma.sql`(${new Date(Date.now() - milliseconds).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "CommerceGiftThrottle" (key, count, "windowAt") VALUES (${digest}, 1, ${clock})
      ON CONFLICT (key) DO UPDATE SET count = CASE WHEN "CommerceGiftThrottle"."windowAt" <= ${start} THEN 1 ELSE "CommerceGiftThrottle".count + 1 END,
      "windowAt" = CASE WHEN "CommerceGiftThrottle"."windowAt" <= ${start} THEN ${clock} ELSE "CommerceGiftThrottle"."windowAt" END
      WHERE "CommerceGiftThrottle"."windowAt" <= ${start} OR "CommerceGiftThrottle".count < ${limit} RETURNING count`;
    if (!rows.length) throw new HttpException("操作过于频繁，请稍后再试", 429);
  }
  async validate(input: unknown, context: Context) {
    await this.enabled();
    await this.rate("validate-ip:" + context.ip, 30, 600_000);
    const body = safeObject(input),
      cardNo = giftCardNumber(body.cardNo),
      secret = giftCheckCode(body.checkCode);
    await this.rate("validate-card:" + cardNo, 10, 600_000);
    const card = await this.prisma.commerceGiftCard.findUnique({
      where: { cardNo },
    });
    // Equal expensive work for unknown card numbers; never disclose status without the secret.
    const valid = await compare(
      secret,
      card?.secretHash ||
        "$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi",
    );
    if (!card || !valid) throw new BadRequestException("卡号或校验码不正确");
    assertGiftAvailable(card);
    const token = randomToken(32);
    await this.prisma.commerceGiftSession.create({
      data: {
        tokenHash: sha256(token),
        createdAt: new Date(),
        cardId: card.id,
        expiresAt: new Date(Date.now() + giftSessionMs),
      },
    });
    return {
      token,
      expiresAt: new Date(Date.now() + giftSessionMs),
      ...(await this.view(token)),
    };
  }
  private async session(token: unknown, db: Db = this.prisma) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("兑换验证已失效，请重新输入卡号和校验码");
    const session = await db.commerceGiftSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { card: true },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException("兑换验证已失效，请重新输入卡号和校验码");
    return session;
  }
  private async owner(token: unknown, actor: Actor, db: Db = this.prisma) {
    const session = await this.session(token, db);
    if (
      session.userId !== actor.id ||
      session.userSessionId !== actor.sessionId ||
      !session.mobile ||
      !session.verifiedAt
    )
      throw new ForbiddenException("请使用本次短信验证的手机号继续兑换");
    const active = await db.userSession.findFirst({
      where: {
        id: actor.sessionId,
        userId: actor.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: "ACTIVE", mobile: session.mobile },
      },
      select: { id: true },
    });
    if (!active)
      throw new UnauthorizedException("登录已失效，请重新验证手机号");
    return session;
  }
  async view(token: unknown) {
    await this.enabled();
    const session = await this.session(token);
    assertGiftAvailable(session.card);
    const product = await this.prisma.commerceProduct.findFirst({
      where: {
        id: session.card.productId,
        status: "PUBLISHED",
        localArchived: false,
      },
      select: {
        id: true,
        name: true,
        displayName: true,
        coverImage: true,
        source: true,
        skus: {
          where: { id: { in: session.card.allowedSkuIds }, enabled: true },
          select: { id: true, specification: true, image: true, stock: true },
        },
      },
    });
    if (!product) throw new ConflictException("兑换商品暂不可用，请联系发卡方");
    const legal = await globalLegalBundle(this.prisma, "en", "saydian-global");
    if (!legal)
      throw new ServiceUnavailableException(
        "用户协议与隐私政策暂时无法查看，请稍后再试",
      );
    return {
      card: {
        serialNo: String(session.card.number),
        expiresAt: session.card.expiresAt,
      },
      product: {
        id: product.id,
        name: product.name,
        displayName: product.displayName,
        coverImage: product.coverImage,
        skus: product.skus.map((sku) => ({
          ...sku,
          ...giftAvailability(product.source, sku.stock),
        })),
      },
      phoneVerified:
        !!session.verifiedAt &&
        session.verifiedAt.valueOf() > Date.now() - giftVerificationMs,
      consentVersion: legal.consentVersion,
    };
  }
  async requestSms(input: unknown, context: Context) {
    await this.enabled();
    const body = safeObject(input),
      session = await this.session(body.token),
      mobile = normalizedMobile(body.mobile);
    assertGiftAvailable(session.card);
    if (!/^\+861[3-9]\d{9}$/.test(mobile))
      throw new BadRequestException("请输入中国大陆手机号");
    await this.rate("sms-ip:" + context.ip, 10, 3_600_000);
    await this.rate("sms-phone-hour:" + mobile, 5, 3_600_000);
    await this.rate("sms-phone:" + mobile, 1, 60_000);
    await this.rate("sms-session:" + session.id, 1, 60_000);
    const mock =
      process.env.NODE_ENV !== "production" &&
      process.env.ALLOW_TEST_OTP === "true";
    const code = mock ? "123456" : String(randomInt(100000, 1000000));
    const otpHash = await hash(code, 10);
    await this.prisma.commerceGiftSession.update({
      where: { id: session.id },
      data: {
        mobile,
        otpHash,
        otpExpiresAt: new Date(Date.now() + 300_000),
        otpAttempts: 0,
        verifiedAt: null,
        userId: null,
        userSessionId: null,
      },
    });
    try {
      if (!mock) await this.sms.send(mobile, code, "gift_redemption");
    } catch (error) {
      await this.prisma.commerceGiftSession.updateMany({
        where: { id: session.id, otpHash },
        data: { otpHash: null, otpExpiresAt: null },
      });
      throw error;
    }
    return {
      expiresIn: 300,
      retryAfter: 60,
      ...(mock ? { devCode: code } : {}),
    };
  }
  async verifySms(input: unknown, context: Context) {
    await this.enabled();
    const body = safeObject(input);
    if (
      body.consentAccepted !== true ||
      typeof body.consentVersion !== "string" ||
      !body.consentVersion ||
      body.consentVersion.length > 80
    )
      throw new BadRequestException("请阅读并同意用户协议与隐私政策");
    await this.rate("sms-check-ip:" + context.ip, 30, 600_000);
    const initial = await this.session(body.token);
    await this.rate("sms-check-session:" + initial.id, 10, 600_000);
    // Commit failed attempt counters even when the supplied code is wrong.
    const result = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CommerceGiftSession" WHERE id = ${initial.id}::uuid FOR UPDATE`;
        const session = await this.session(body.token, tx);
        assertGiftAvailable(session.card);
        if (normalizedMobile(body.mobile) !== session.mobile) return null;
        if (
          !session.otpHash ||
          !session.otpExpiresAt ||
          session.otpExpiresAt <= new Date() ||
          session.otpAttempts >= 5 ||
          !session.mobile
        )
          return null;
        const valid =
          typeof body.code === "string" &&
          /^\d{6}$/.test(body.code) &&
          (await compare(body.code, session.otpHash));
        if (!valid) {
          await tx.commerceGiftSession.update({
            where: { id: session.id },
            data: { otpAttempts: { increment: 1 } },
          });
          return null;
        }
        const user = await this.auth.memberForVerifiedGiftMobile(
          tx,
          session.mobile,
          String(body.consentVersion),
        );
        const verifiedAt = new Date();
        await tx.commerceGiftSession.update({
          where: { id: session.id },
          data: {
            otpHash: null,
            otpExpiresAt: null,
            userId: user.id,
            verifiedAt,
          },
        });
        return { userId: user.id, mobile: session.mobile, verifiedAt };
      },
      { timeout: 15_000 },
    );
    if (!result)
      throw new BadRequestException(
        "短信验证码错误、已使用或已过期，请重新获取",
      );
    const sessionId = randomUUID(),
      login = await this.auth.issueMallSession(result.userId, sessionId);
    const bound = await this.prisma.commerceGiftSession.updateMany({
      where: {
        id: initial.id,
        userId: result.userId,
        mobile: result.mobile,
        verifiedAt: result.verifiedAt,
        otpHash: null,
      },
      data: { userSessionId: sessionId },
    });
    if (!bound.count) {
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      });
      throw new ConflictException("手机号验证已变化，请重新验证");
    }
    return login;
  }
  async preview(actor: Actor, input: unknown) {
    await this.enabled();
    const body = safeObject(input),
      session = await this.owner(body.token, actor);
    assertGiftAvailable(session.card);
    if (session.verifiedAt!.valueOf() <= Date.now() - giftVerificationMs)
      throw new ForbiddenException("手机号验证已过期，请重新验证");
    return this.quote(this.prisma, session.card, actor.id, body);
  }
  private async quote(
    db: Db,
    card: { productId: string; allowedSkuIds: string[] },
    userId: string,
    body: Record<string, unknown>,
  ) {
    const skuId = String(body.skuId || ""),
      addressId = String(body.addressId || "");
    if (!card.allowedSkuIds.includes(skuId) || !isUuid(addressId))
      throw new BadRequestException("请选择可兑换的规格和收货地址");
    const [sku, address] = await Promise.all([
      db.commerceSku.findFirst({
        where: {
          id: skuId,
          productId: card.productId,
          enabled: true,
          product: { status: "PUBLISHED", localArchived: false },
        },
        include: { product: true },
      }),
      db.commerceAddress.findFirst({ where: { id: addressId, userId } }),
    ]);
    if (!sku)
      throw new ConflictException("该规格暂不可兑换，请重新选择，卡片尚未使用");
    const availability = giftAvailability(sku.product.source, sku.stock);
    if (!availability.redeemable)
      throw new ConflictException(
        "该规格暂时缺货，请选择其他规格或稍后兑换，卡片尚未使用",
      );
    if (!Number.isSafeInteger(sku.salePriceCents) || sku.salePriceCents < 0)
      throw new ConflictException("商品价格暂不可用，请联系发卡方");
    if (!address || address.countryCode !== "CN")
      throw new BadRequestException("请选择当前会员的中国大陆收货地址");
    const fingerprint = giftPayloadHash([
      card.productId,
      sku.id,
      sku.specification,
      sku.product.displayName || sku.product.name,
      sku.salePriceCents,
      availability.estimatedDispatchDays,
      address.id,
      address.name,
      address.mobile,
      address.province,
      address.city,
      address.district,
      address.detail,
      address.countryCode,
    ]);
    return {
      sku: {
        id: sku.id,
        productId: sku.productId,
        name: sku.product.displayName || sku.product.name,
        specification: sku.specification,
        image: sku.image || sku.product.coverImage,
        priceCents: sku.salePriceCents,
        erpSkuId: sku.erpSkuId,
        estimatedDispatchDays: availability.estimatedDispatchDays,
      },
      address,
      quantity: 1,
      giftDiscountCents: sku.salePriceCents,
      shippingCents: 0,
      payableCents: 0,
      fingerprint,
    };
  }
  async result(actor: Actor, input: unknown) {
    const body = safeObject(input),
      session = await this.owner(body.token, actor);
    const record = await this.prisma.commerceGiftRedemption.findUnique({
      where: { cardId: session.cardId },
      select: {
        userId: true,
        orderId: true,
        order: { select: { orderNo: true } },
      },
    });
    if (!record) return { completed: false };
    if (record.userId !== actor.id)
      throw new ConflictException("该卡已兑换，请使用兑换手机号查看订单");
    return {
      completed: true,
      orderId: record.orderId,
      orderNo: record.order.orderNo,
    };
  }
  async redeem(actor: Actor, input: unknown, context: Context) {
    await this.enabled();
    const body = safeObject(input),
      key = giftRequestKey(body.requestKey);
    const initial = await this.owner(body.token, actor);
    await this.rate("submit-user:" + actor.id, 30, 60_000);
    const requestKey = "gift:" + sha256(actor.id + ":" + key),
      requestHash = giftPayloadHash([
        initial.cardId,
        body.skuId,
        body.addressId,
        body.fingerprint,
      ]);
    const recover = async () => {
      const record = await this.prisma.commerceGiftRedemption.findUnique({
        where: { cardId: initial.cardId },
        include: { order: { select: { orderNo: true } } },
      });
      if (!record) return null;
      if (record.userId !== actor.id)
        throw new ConflictException("该卡已兑换，请使用兑换手机号查看订单");
      if (record.requestHash !== requestHash)
        throw new ConflictException("该卡已完成其他兑换，请从我的订单查看");
      return { orderId: record.orderId, orderNo: record.order.orderNo };
    };
    const committed = await recover();
    if (committed) return committed;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "CommerceGiftCard" WHERE id = ${initial.cardId}::uuid FOR UPDATE`;
          const session = await this.owner(body.token, actor, tx);
          const existing = await tx.commerceGiftRedemption.findUnique({
            where: { cardId: session.cardId },
            include: { order: true },
          });
          if (existing) {
            if (
              existing.userId !== actor.id ||
              existing.requestHash !== requestHash
            )
              throw new ConflictException("该卡已兑换，请查看我的订单");
            return {
              orderId: existing.orderId,
              orderNo: existing.order.orderNo,
            };
          }
          assertGiftAvailable(session.card);
          if (session.verifiedAt!.valueOf() <= Date.now() - giftVerificationMs)
            throw new ForbiddenException("手机号验证已过期，请重新验证");
          if (!session.card.allowedSkuIds.includes(String(body.skuId)))
            throw new BadRequestException("请选择有效规格");
          await tx.$queryRaw`SELECT id FROM "CommerceSku" WHERE id = ${String(body.skuId)}::uuid FOR UPDATE`;
          const quote = await this.quote(tx, session.card, actor.id, body);
          if (body.fingerprint !== quote.fingerprint)
            throw new ConflictException(
              "商品、地址或预计发货时间信息已变化，请重新确认",
            );
          const now = new Date(),
            address = quote.address,
            sku = quote.sku;
          const order = await tx.commerceOrder.create({
            data: {
              orderNo: giftNumber("GD"),
              createdAt: now,
              userId: actor.id,
              giftCardSerial: String(session.card.number),
              giftDiscountCents: sku.priceCents,
              subtotalCents: sku.priceCents,
              payableCents: 0,
              shippingCents: 0,
              pricingVersion: 1,
              pricingVerifiedAt: now,
              requestHash,
              idempotencyKey: requestKey,
              recipientName: address.name,
              recipientMobile: address.mobile,
              countryCode: "CN",
              province: address.province,
              city: address.city,
              district: address.district,
              addressDetail: address.detail,
              postalCode: address.postalCode,
              adminRemark: "礼品兑换：" + session.card.number,
              items: {
                create: {
                  productId: sku.productId,
                  skuId: sku.id,
                  erpSkuIdSnapshot: sku.erpSkuId,
                  nameSnapshot: sku.name,
                  specificationSnapshot: sku.specification,
                  imageSnapshot: sku.image,
                  unitPriceCents: sku.priceCents,
                  quantity: 1,
                  totalCents: sku.priceCents,
                  giftDiscountCentsSnapshot: sku.priceCents,
                  couponDiscountCentsSnapshot: 0,
                  pointDiscountCentsSnapshot: 0,
                  cashPaidCentsSnapshot: 0,
                },
              },
            },
            include: { items: true },
          });
          await tx.paymentIntent.create({
            data: {
              paymentNo: giftNumber("GP"),
              createdAt: now,
              userId: actor.id,
              businessType: BusinessType.COMMERCE_ORDER,
              businessId: order.id,
              commerceOrderId: order.id,
              channel: PaymentChannel.GIFT_REDEMPTION,
              status: PaymentStatus.SUCCEEDED,
              amountCents: 0,
              description: "礼品兑换",
              paidAt: now,
              idempotencyKey: "gift-settlement:" + order.id,
            },
          });
          await markPaymentStockItems(tx, order.id, order.items);
          await completeCommercePayment(tx, order.id);
          await tx.commerceIntegrationJob.updateMany({
            where: { idempotencyKey: `jushuitan-order:${order.id}` },
            data: { createdAt: now, nextRunAt: now },
          });
          const member = await tx.user.findUniqueOrThrow({
            where: { id: actor.id },
            select: { compatibilityId: true },
          });
          await tx.commerceGiftRedemption.create({
            data: {
              cardId: session.cardId,
              redeemedAt: now,
              orderId: order.id,
              userId: actor.id,
              memberNoSnapshot: member.compatibilityId,
              verifiedMobile: session.mobile!,
              verifiedAt: session.verifiedAt!,
              clientIp: context.ip?.slice(0, 100) ?? null,
              requestId: context.requestId ?? null,
              requestKey,
              requestHash,
              productSnapshot: JSON.parse(JSON.stringify(sku)),
              addressSnapshot: JSON.parse(JSON.stringify(address)),
            },
          });
          await tx.commerceGiftCard.update({
            where: { id: session.cardId },
            data: { status: "REDEEMED", version: { increment: 1 } },
          });
          await tx.auditLog.create({
            data: {
              actorType: "USER",
              createdAt: now,
              actorId: actor.id,
              action: "GIFT_REDEEMED",
              entityType: "commerce_order",
              entityId: order.id,
              requestId: context.requestId ?? null,
              afterJson: {
                cardId: session.cardId,
                serialNo: String(session.card.number),
                orderNo: order.orderNo,
              },
            },
          });
          return { orderId: order.id, orderNo: order.orderNo };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      const result = await recover();
      if (result) return result;
      throw error;
    }
  }
}
