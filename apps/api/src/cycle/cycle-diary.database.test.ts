import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaService } from "../common/prisma.service";
import { CycleService } from "./cycle.service";

// 必须显式指定本机测试库，使用两个独立随机合成会员，不接触真实用户。
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")(
  "local PostgreSQL: cycle diary across client generations",
  () => {
    const [a, b] = [randomUUID(), randomUUID()] as const;
    const date = "2020-03-01",
      id = "daily-" + date;
    let db: PrismaClient, svc: CycleService;
    beforeAll(async () => {
      if (
        !["127.0.0.1", "localhost"].includes(
          new URL(process.env.DATABASE_URL ?? "").hostname,
        )
      )
        throw new Error("Non-local database refused");
      db = new PrismaClient();
      svc = new CycleService(db as PrismaService, {} as never);
      await db.user.createMany({
        data: [a, b].map((id) => ({ id, nickname: "CYCLE_SYNTHETIC" })),
      });
    });
    afterAll(async () => {
      if (!db) return;
      await db.user.deleteMany({ where: { id: { in: [a, b] } } });
      await db.$disconnect();
    });
    it("replays an offline v2 diary, a v1 edit keeps symptoms, v2 can clear/delete and other owners cannot see it", async () => {
      const settings = {
        enabled: true,
        adultConfirmed: true,
        purposeAccepted: true,
        recordOnly: false,
        historyComplete: false,
        hideSummary: true,
        remind: false,
        recordRemind: false,
        leadDays: 2,
        hour: 9,
        minute: 0,
      };
      await svc.sync(a, {
        rows: [
          {
            id: "settings",
            kind: "settings",
            data: settings,
            baseRevision: 0,
            deleted: false,
            mutationId: randomUUID(),
          },
        ],
      });
      const write = (
        rev: number,
        d: Record<string, unknown>,
        deleted = false,
      ) => ({
        id,
        kind: "daily",
        baseRevision: rev,
        deleted,
        data: deleted ? {} : { date, ...d },
        mutationId: randomUUID(),
      });
      const queued = write(0, {
        flow: "light",
        symptoms: ["headache", "bloating"],
      });
      await svc.sync(a, { schemaVersion: 2, rows: [queued] });
      await svc.sync(a, { schemaVersion: 2, rows: [queued] });
      const legacy = await svc.changes(a, 0, false);
      expect(legacy.rows).toContainEqual(
        expect.objectContaining({
          id,
          revision: 1,
          data: { date, flow: "light" },
        }),
      );
      const oldEdit = write(1, { flow: "medium", mood: "calm" });
      await svc.sync(a, { rows: [oldEdit] });
      expect((await svc.changes(a, legacy.cursor, true)).rows).toEqual([
        expect.objectContaining({
          id,
          revision: 2,
          data: {
            date,
            flow: "medium",
            mood: "calm",
            symptoms: ["headache", "bloating"],
          },
        }),
      ]);
      expect((await svc.changes(b, 0, true)).rows).toHaveLength(0);
      await svc.sync(a, {
        schemaVersion: 2,
        rows: [write(2, { symptoms: [] })],
      });
      expect((await svc.changes(a, 0, true)).rows).toContainEqual(
        expect.objectContaining({
          id,
          revision: 3,
          data: { date, symptoms: [] },
        }),
      );
      await svc.sync(a, { rows: [write(3, {}, true)] });
      for (const extended of [false, true])
        expect((await svc.changes(a, 0, extended)).rows).toContainEqual(
          expect.objectContaining({ id, deleted: true, revision: 4, data: {} }),
        );
    });
  },
);
