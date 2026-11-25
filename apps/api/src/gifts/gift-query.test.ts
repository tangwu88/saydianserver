import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { hashSync } from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { AdminAuthGuard } from "../admin/admin-auth";
import { GiftQueryService } from "./gift-query.service";
import {
  GiftQueryAdminController,
  GiftQueryAuthGuard,
  GiftQueryController,
} from "./gift-query.controller";
import { sha256 } from "../common/crypto";

const password = "synthetic-query-password",
  token = "q".repeat(64),
  id = randomUUID();
function harness() {
  const account = {
    id,
    username: "query_test",
    displayName: "合成查询员",
    passwordHash: hashSync(password, 4),
    active: true,
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const session = {
    id: randomUUID(),
    accountId: id,
    account,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 3600000),
    revokedAt: null as Date | null,
  };
  const logs: any[] = [],
    audits: any[] = [],
    sessions: any[] = [],
    sql: Prisma.Sql[] = [];
  let lockHook = () => {},
    rateLimited = false;
  const db = {
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const statement = Prisma.sql(strings, ...values);
        sql.push(statement);
        if (statement.sql.includes("FOR SHARE")) lockHook();
        return rateLimited &&
          statement.sql.includes('INSERT INTO "CommerceGiftThrottle"')
          ? []
          : [{ count: 1 }];
      },
    ),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(async (fn: any) =>
      typeof fn === "function" ? fn(db) : Promise.all(fn),
    ),
    giftQueryAccount: {
      findUnique: vi.fn(async () => ({ ...account })),
      findUniqueOrThrow: vi.fn(async () => ({ ...account })),
      create: vi.fn(async ({ data }: any) => {
        Object.assign(account, data);
        return { ...account };
      }),
      update: vi.fn(async ({ data }: any) => {
        const { version, ...values } = data;
        Object.assign(account, values);
        account.version += version.increment;
        const { passwordHash, ...result } = account;
        return result;
      }),
      count: vi.fn().mockResolvedValue(0),
    },
    giftQuerySession: {
      findUnique: vi.fn(async ({ where }: any) =>
        !where.tokenHash || where.tokenHash === session.tokenHash
          ? session
          : null,
      ),
      create: vi.fn(async ({ data }: any) => {
        sessions.push(data);
        return data;
      }),
      updateMany: vi.fn(async () => {
        session.revokedAt = new Date();
        return { count: 1 };
      }),
    },
    commerceGiftCard: {
      findMany: vi.fn().mockResolvedValue([
        {
          cardNo: "80100611",
          redemption: { order: { orderNo: "SYNTHETIC-ORDER-1" } },
        },
        { cardNo: "80100612", redemption: null },
      ]),
    },
    giftQueryLog: {
      create: vi.fn(async ({ data }: any) => {
        logs.push(data);
        return { ...data, createdAt: new Date() };
      }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    auditLog: { create: vi.fn(async ({ data }: any) => audits.push(data)) },
  };
  return {
    db,
    service: new GiftQueryService(db as any),
    account,
    session,
    logs,
    audits,
    sessions,
    sql,
    onLock: (fn: () => void) => {
      lockHook = fn;
    },
    limit: () => {
      rateLimited = true;
    },
  };
}

describe("read-only gift inquiry", () => {
  it("deduplicates exact card numbers, preserves input order and exposes only status/order number", async () => {
    const h = harness();
    const result = await h.service.query(
      token,
      { cardNos: "80100612，80100611 80100612\n80100999" },
      { ip: "127.0.0.1", requestId: "synthetic" },
    );
    expect(result.items).toEqual([
      { cardNo: "80100612", status: "NOT_REDEEMED", orderNo: null },
      { cardNo: "80100611", status: "REDEEMED", orderNo: "SYNTHETIC-ORDER-1" },
      { cardNo: "80100999", status: "NOT_FOUND", orderNo: null },
    ]);
    expect(result).toMatchObject({
      cardCount: 3,
      redeemedCount: 1,
      missingCount: 1,
    });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({
      accountId: id,
      username: "query_test",
      cardCount: 3,
      redeemedCount: 1,
      missingCount: 1,
      results: result.items,
    });
    expect(JSON.stringify(h.logs)).not.toContain("127.0.0.1");
    expect(h.db.commerceGiftCard.findMany.mock.calls[0]![0]).toEqual({
      where: { cardNo: { in: ["80100612", "80100611", "80100999"] } },
      select: {
        cardNo: true,
        redemption: { select: { order: { select: { orderNo: true } } } },
      },
    });
  });
  it.each([
    "",
    [80100611],
    "611",
    "80100611');DROP TABLE",
    Array.from({ length: 101 }, (_, i) => String(80100000 + i)),
  ])(
    "audits invalid input without saving arbitrary text: %j",
    async (cardNos) => {
      const h = harness();
      await expect(h.service.query(token, { cardNos }, {})).rejects.toThrow(
        "每次最多100张",
      );
      expect(h.db.commerceGiftCard.findMany).not.toHaveBeenCalled();
      expect(h.logs[0]).toMatchObject({
        outcome: "INVALID_INPUT",
        cardCount: 0,
        results: [],
      });
    },
  );
  it.each(["missing", "expired", "revoked", "inactive"])(
    "rejects %s sessions without reading cards or producing logs",
    async (mode) => {
      const h = harness();
      if (mode === "expired") h.session.expiresAt = new Date(0);
      if (mode === "revoked") h.session.revokedAt = new Date();
      if (mode === "inactive") h.account.active = false;
      await expect(
        h.service.query(
          mode === "missing" ? "admin-token" : token,
          { cardNos: "80100611" },
          {},
        ),
      ).rejects.toThrow("登录已失效");
      expect(h.db.commerceGiftCard.findMany).not.toHaveBeenCalled();
      expect(h.logs).toEqual([]);
    },
  );
  it("rechecks revocation after obtaining shared account/session locks", async () => {
    const h = harness();
    h.onLock(() => {
      h.session.revokedAt = new Date();
    });
    await expect(
      h.service.query(token, { cardNos: "80100611" }, {}),
    ).rejects.toThrow("登录已失效");
    expect(h.db.commerceGiftCard.findMany).not.toHaveBeenCalled();
  });
  it("discloses no results if the audit write fails", async () => {
    const h = harness();
    h.db.giftQueryLog.create.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    await expect(
      h.service.query(token, { cardNos: "80100611" }, {}),
    ).rejects.toThrow("storage unavailable");
  });
  it("limits authenticated queries before reading cards", async () => {
    const h = harness();
    h.limit();
    await expect(
      h.service.query(token, { cardNos: "80100611" }, {}),
    ).rejects.toMatchObject({ status: 429 });
    expect(h.db.commerceGiftCard.findMany).not.toHaveBeenCalled();
  });
  it("stores hashed independent tokens with eight-hour expiry", async () => {
    const h = harness(),
      started = Date.now();
    const response = await h.service.login(
      { username: "QUERY_TEST", password },
      { ip: "127.0.0.1" },
    );
    expect(response.token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(h.sessions[0]).toMatchObject({
      accountId: id,
      tokenHash: sha256(response.token),
    });
    expect(+response.expiresAt - started).toBeGreaterThanOrEqual(8 * 3600000);
    expect(JSON.stringify(response)).not.toContain("password");
    expect(h.sessions[0]).not.toHaveProperty("token");
  });
  it("fails a login whose account changed while comparing the password", async () => {
    const h = harness();
    h.onLock(() => {
      h.account.version++;
    });
    await expect(
      h.service.login({ username: "query_test", password }, {}),
    ).rejects.toThrow("登录已失效");
    expect(h.sessions).toEqual([]);
  });
  it("uses the same generic login failure for missing, disabled or incorrect credentials", async () => {
    for (const mode of ["missing", "disabled", "wrong"]) {
      const h = harness();
      if (mode === "missing")
        h.db.giftQueryAccount.findUnique.mockResolvedValueOnce(null as any);
      if (mode === "disabled") h.account.active = false;
      await expect(
        h.service.login(
          {
            username: "query_test",
            password: mode === "wrong" ? "incorrect" : password,
          },
          {},
        ),
      ).rejects.toThrow("账号或密码错误");
      expect(h.sessions).toEqual([]);
    }
  });
  it("updates disable/password under a version lock and revokes all old sessions without credential audit", async () => {
    const h = harness();
    await h.service.saveAccount(
      randomUUID(),
      id,
      {
        displayName: "新名称",
        active: false,
        version: 0,
        password: "new-synthetic-password",
      },
      {},
    );
    expect(h.db.giftQuerySession.updateMany).toHaveBeenCalledWith({
      where: { accountId: id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(h.sql.some((s) => s.sql.includes("FOR UPDATE"))).toBe(true);
    expect(JSON.stringify(h.audits)).not.toMatch(
      /passwordHash|new-synthetic-password/,
    );
    expect(h.audits[0].afterJson.passwordReset).toBe(true);
  });
  it("preserves credentials and sessions on a stale admin version", async () => {
    const h = harness();
    await expect(
      h.service.saveAccount(
        randomUUID(),
        id,
        { displayName: "新名称", active: false, version: 7 },
        {},
      ),
    ).rejects.toThrow("已变化");
    expect(h.db.giftQueryAccount.update).not.toHaveBeenCalled();
    expect(h.db.giftQuerySession.updateMany).not.toHaveBeenCalled();
  });
  it("rejects passwords exceeding bcrypt's UTF8 byte limit", async () => {
    const h = harness();
    await expect(
      h.service.saveAccount(
        randomUUID(),
        undefined,
        {
          username: "account",
          displayName: "合成",
          active: true,
          password: "密".repeat(25),
        },
        {},
      ),
    ).rejects.toThrow("72字节");
    expect(h.db.giftQueryAccount.create).not.toHaveBeenCalled();
  });
});

describe("gift query HTTP authorization", () => {
  it.each(["me", "logout", "query"])(
    "protects %s with the dedicated query guard",
    (method) => {
      expect(
        Reflect.getMetadata(
          "__guards__",
          (GiftQueryController.prototype as any)[method],
        ),
      ).toContain(GiftQueryAuthGuard);
    },
  );
  it("rejects admin/member tokens through query-session lookup and marks errors noncacheable", async () => {
    const h = harness(),
      setHeader = vi.fn();
    const guard = new GiftQueryAuthGuard(h.service);
    const execution = {
      switchToHttp: () => ({
        getResponse: () => ({ setHeader }),
        getRequest: () => ({ header: () => "Bearer " + "a".repeat(64) }),
      }),
    };
    await expect(guard.canActivate(execution as any)).rejects.toThrow(
      "登录已失效",
    );
    expect(setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "no-store, private",
    );
  });
  it.each(["COMMERCE_OPERATIONS", "CONTENT_EDITOR"])(
    "denies %s account and query-log administration",
    async (role) => {
      const db = {
        adminSession: {
          findUnique: vi
            .fn()
            .mockResolvedValue({
              id: "synthetic",
              expiresAt: new Date(Date.now() + 60000),
              admin: { id: "synthetic", active: true, role, roles: [role] },
            }),
        },
      };
      const execution = {
        switchToHttp: () => ({
          getRequest: () => ({
            path: "/api/saydian-app/admin/v1/commerce-gift-query-logs",
            method: "GET",
            header: () => "Bearer synthetic",
          }),
        }),
        getHandler: () => GiftQueryAdminController.prototype.logs,
        getClass: () => GiftQueryAdminController,
      };
      await expect(
        new AdminAuthGuard(db as any, new Reflector()).canActivate(
          execution as any,
        ),
      ).rejects.toThrow("无权执行");
    },
  );
});
