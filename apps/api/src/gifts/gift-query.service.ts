import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { parseGiftCardNos } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { isUuid, randomToken, safeObject, sha256 } from "../common/crypto";

type Db = Prisma.TransactionClient;
type Context = { requestId?: string | undefined; ip?: string | undefined };
const publicAccount = {
  id: true,
  username: true,
  displayName: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;
const expired = () => new UnauthorizedException("查询登录已失效，请重新登录");
const dummyHash = "$2b$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi";

@Injectable()
export class GiftQueryService {
  constructor(private readonly prisma: PrismaService) {}

  // Atomic database limits apply across API instances and restarts.
  private async rate(key: string, limit: number) {
    const digest = sha256("gift-query:" + key);
    const clock = Prisma.sql`(${new Date().toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    const start = Prisma.sql`(${new Date(Date.now() - 600_000).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "CommerceGiftThrottle" (key, count, "windowAt") VALUES (${digest}, 1, ${clock})
      ON CONFLICT (key) DO UPDATE SET count = CASE WHEN "CommerceGiftThrottle"."windowAt" <= ${start} THEN 1 ELSE "CommerceGiftThrottle".count + 1 END,
      "windowAt" = CASE WHEN "CommerceGiftThrottle"."windowAt" <= ${start} THEN ${clock} ELSE "CommerceGiftThrottle"."windowAt" END
      WHERE "CommerceGiftThrottle"."windowAt" <= ${start} OR "CommerceGiftThrottle".count < ${limit} RETURNING count`;
    if (!rows.length) throw new HttpException("查询过于频繁，请稍后再试", 429);
  }

  async login(input: unknown, context: Context) {
    const body = safeObject(input);
    const username =
      typeof body.username === "string"
        ? body.username.trim().toLowerCase()
        : "";
    const password = typeof body.password === "string" ? body.password : "";
    await this.rate("login-ip:" + context.ip, 30);
    if (
      !/^[a-z0-9_-]{3,64}$/.test(username) ||
      !password ||
      Buffer.byteLength(password) > 72
    )
      throw new UnauthorizedException("账号或密码错误");
    await this.rate("login-account:" + username, 10);
    const account = await this.prisma.giftQueryAccount.findUnique({
      where: { username },
    });
    const valid = await compare(password, account?.passwordHash || dummyHash);
    if (!account?.active || !valid)
      throw new UnauthorizedException("账号或密码错误");
    const token = randomToken(),
      expiresAt = new Date(Date.now() + 8 * 3_600_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "GiftQueryAccount" WHERE id = ${account.id}::uuid FOR SHARE`;
      const current = await tx.giftQueryAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      if (!current.active || current.version !== account.version)
        throw expired();
      await tx.giftQuerySession.create({
        data: { accountId: account.id, tokenHash: sha256(token), expiresAt },
      });
    });
    // Only our expired sessions; no credential/query logs are deleted.
    await this.prisma
      .$executeRaw`DELETE FROM "GiftQuerySession" WHERE id IN (SELECT id FROM "GiftQuerySession" WHERE "expiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') ORDER BY "expiresAt" LIMIT 500)`;
    return {
      token,
      expiresAt,
      username: account.username,
      displayName: account.displayName,
    };
  }

  private token(value: unknown) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(value))
      throw expired();
    return sha256(value);
  }

  private async session(value: unknown, tx: Db, lock = false) {
    const tokenHash = this.token(value);
    const session = await tx.giftQuerySession.findUnique({
      where: { tokenHash },
    });
    if (!session) throw expired();
    if (lock) {
      // Same lock order as account editing: disabling/resetting cannot race a query.
      await tx.$queryRaw`SELECT id FROM "GiftQueryAccount" WHERE id = ${session.accountId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "GiftQuerySession" WHERE id = ${session.id}::uuid FOR SHARE`;
    }
    const current = await tx.giftQuerySession.findUnique({
      where: { id: session.id },
      include: { account: true },
    });
    if (
      !current ||
      current.revokedAt ||
      current.expiresAt <= new Date() ||
      !current.account.active
    )
      throw expired();
    return current;
  }

  async me(token: unknown) {
    const session = await this.session(token, this.prisma);
    return {
      username: session.account.username,
      displayName: session.account.displayName,
      expiresAt: session.expiresAt,
    };
  }

  async logout(token: unknown) {
    await this.prisma.giftQuerySession.updateMany({
      where: { tokenHash: this.token(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  async query(token: unknown, input: unknown, context: Context) {
    const auth = await this.session(token, this.prisma);
    await this.rate("query-account:" + auth.accountId, 60);
    let cardNos: string[] = [],
      invalid = false;
    try {
      cardNos = parseGiftCardNos(safeObject(input).cardNos);
    } catch {
      invalid = true;
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await this.session(token, tx, true);
      const cards = invalid
        ? []
        : await tx.commerceGiftCard.findMany({
            where: { cardNo: { in: cardNos } },
            select: {
              cardNo: true,
              redemption: { select: { order: { select: { orderNo: true } } } },
            },
          });
      const byNo = new Map(cards.map((card) => [card.cardNo, card]));
      const items = cardNos.map((cardNo) => {
        const card = byNo.get(cardNo);
        return {
          cardNo,
          status: !card
            ? "NOT_FOUND"
            : card.redemption
              ? "REDEEMED"
              : "NOT_REDEEMED",
          orderNo: card?.redemption?.order.orderNo || null,
        };
      });
      const redeemedCount = items.filter(
        (item) => item.status === "REDEEMED",
      ).length;
      const missingCount = items.filter(
        (item) => item.status === "NOT_FOUND",
      ).length;
      // Persist the exact response snapshot before disclosing any card/order data.
      const log = await tx.giftQueryLog.create({
        data: {
          accountId: session.accountId,
          username: session.account.username,
          outcome: invalid ? "INVALID_INPUT" : "SUCCESS",
          cardCount: items.length,
          redeemedCount,
          missingCount,
          results: items,
          requestId: context.requestId ?? null,
          ipHash: context.ip ? sha256(context.ip) : null,
        },
      });
      return {
        items,
        cardCount: items.length,
        redeemedCount,
        missingCount,
        queriedAt: log.createdAt,
      };
    });
    if (invalid)
      throw new BadRequestException(
        "请输入8开头的8位卡号，例如80100611；去重后每次最多100张",
      );
    return result;
  }

  async accounts() {
    const { items, totals } = await this.prisma.$transaction(async (tx) => {
      const items = await tx.giftQueryAccount.findMany({
        select: publicAccount,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      const totals = await tx.giftQueryLog.groupBy({
        by: ["accountId", "outcome"],
        orderBy: { accountId: "asc" },
        _count: { _all: true },
        _sum: { cardCount: true, redeemedCount: true, missingCount: true },
        _max: { createdAt: true },
      });
      return { items, totals };
    });
    return items.map((item) => {
      const groups = totals.filter((row) => row.accountId === item.id);
      return {
        ...item,
        queryCount: groups.reduce((n, row) => n + row._count._all, 0),
        failedCount: groups
          .filter((row) => row.outcome !== "SUCCESS")
          .reduce((n, row) => n + row._count._all, 0),
        cardCount: groups.reduce((n, row) => n + (row._sum.cardCount || 0), 0),
        redeemedCount: groups.reduce(
          (n, row) => n + (row._sum.redeemedCount || 0),
          0,
        ),
        lastQueryAt:
          groups
            .map((row) => row._max.createdAt)
            .filter((date): date is Date => !!date)
            .sort((a, b) => +b - +a)[0] || null,
      };
    });
  }

  async saveAccount(
    adminId: string,
    id: string | undefined,
    input: unknown,
    context: Context,
  ) {
    const body = safeObject(input);
    const username =
      typeof body.username === "string"
        ? body.username.trim().toLowerCase()
        : "";
    const displayName =
      typeof body.displayName === "string" ? body.displayName.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (id && !isUuid(id)) throw new BadRequestException("查询账号ID不正确");
    if (
      (!id && !/^[a-z0-9_-]{3,64}$/.test(username)) ||
      !displayName ||
      displayName.length > 80 ||
      typeof body.active !== "boolean"
    )
      throw new BadRequestException(
        "请填写查询账号、名称和启用状态；账号使用3至64位字母、数字、下划线或短横线",
      );
    if (
      (!id || password) &&
      (password.length < 10 || Buffer.byteLength(password) > 72)
    )
      throw new BadRequestException("密码至少10个字符，最多72字节");
    if (id && (!Number.isSafeInteger(body.version) || Number(body.version) < 0))
      throw new BadRequestException("请刷新查询账号后重试");
    const passwordHash = password ? await hash(password, 12) : undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!id) {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(76251925)`;
          if ((await tx.giftQueryAccount.count()) >= 100)
            throw new BadRequestException("查询账号最多100个，请管理已有账号");
        } else
          await tx.$queryRaw`SELECT id FROM "GiftQueryAccount" WHERE id = ${id}::uuid FOR UPDATE`;
        const before = id
          ? await tx.giftQueryAccount.findUnique({
              where: { id },
              select: publicAccount,
            })
          : null;
        if (id && !before) throw new NotFoundException("查询账号不存在");
        if (before && before.version !== body.version)
          throw new ConflictException("查询账号已变化，请刷新后重试");
        const account = id
          ? await tx.giftQueryAccount.update({
              where: { id },
              data: {
                displayName,
                active: body.active as boolean,
                ...(passwordHash ? { passwordHash } : {}),
                version: { increment: 1 },
              },
              select: publicAccount,
            })
          : await tx.giftQueryAccount.create({
              data: {
                username,
                displayName,
                active: body.active as boolean,
                passwordHash: passwordHash!,
              },
              select: publicAccount,
            });
        if (id)
          await tx.giftQuerySession.updateMany({
            where: { accountId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        const snapshot = (value: typeof account) => ({
          id: value.id,
          username: value.username,
          displayName: value.displayName,
          active: value.active,
          version: value.version,
          createdAt: value.createdAt.toISOString(),
          updatedAt: value.updatedAt.toISOString(),
        });
        await tx.auditLog.create({
          data: {
            actorType: "ADMIN",
            actorId: adminId,
            action: id
              ? "GIFT_QUERY_ACCOUNT_UPDATE"
              : "GIFT_QUERY_ACCOUNT_CREATE",
            entityType: "GiftQueryAccount",
            entityId: account.id,
            beforeJson: before ? snapshot(before) : Prisma.JsonNull,
            afterJson: { ...snapshot(account), passwordReset: !!passwordHash },
            requestId: context.requestId ?? null,
            ipHash: context.ip ? sha256(context.ip) : null,
          },
        });
        return account;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ConflictException("查询账号已存在");
      throw error;
    }
  }

  async logs(query: Record<string, string>) {
    const page = Math.max(
      1,
      Math.min(100_000, parseInt(query.page || "1", 10) || 1),
    );
    if (query.accountId && !isUuid(query.accountId))
      throw new BadRequestException("查询账号ID不正确");
    const where = query.accountId ? { accountId: query.accountId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.giftQueryLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * 30,
        take: 30,
        select: {
          id: true,
          accountId: true,
          username: true,
          outcome: true,
          cardCount: true,
          redeemedCount: true,
          missingCount: true,
          results: true,
          createdAt: true,
        },
      }),
      this.prisma.giftQueryLog.count({ where }),
    ]);
    return { items, total, page };
  }
}
