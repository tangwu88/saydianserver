import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaService } from "../common/prisma.service";
import { CycleService } from "./cycle.service";
import { CnCycleService } from "./cn-cycle.service";
import { CnCycleController } from "./cn-cycle.controller";

// Explicit isolated local DB only. Same synthetic owner and mutation IDs in both products.
describe.runIf(process.env.RUN_LOCAL_DATABASE_TESTS === "1")(
  "CN cycle product isolation in PostgreSQL",
  () => {
    const [a, b] = [randomUUID(), randomUUID()];
    let db: PrismaClient, cn: CnCycleService, ring: CycleService;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/ringlab" ||
        url.username !== "ringqa"
      )
        throw new Error("Isolated ringlab DB required");
      db = new PrismaClient();
      cn = new CnCycleService(db as PrismaService, {} as never);
      ring = new CycleService(db as PrismaService, {} as never);
      await db.user.createMany({
        data: [a, b].map((id) => ({ id, nickname: "CN_CYCLE_SYNTHETIC" })),
      });
    });
    afterAll(async () => {
      if (db) {
        await db.user.deleteMany({ where: { id: { in: [a, b] } } });
        await db.$disconnect();
      }
    });
    const settings = (hide: boolean) => ({
      enabled: true,
      adultConfirmed: true,
      purposeAccepted: true,
      recordOnly: false,
      historyComplete: false,
      hideSummary: hide,
      remind: false,
      recordRemind: false,
      leadDays: 2,
      hour: 9,
      minute: 0,
    });
    const row = (
      id: string,
      kind: string,
      data: object,
      mutationId: string,
    ) => ({ id, kind, data, baseRevision: 0, deleted: false, mutationId });
    it("adds CN cycle tables without rewriting source cycle payloads", async () => {
      const schema = "cn_cycle_upgrade_" + randomUUID().replaceAll("-", "");
      if (!/^cn_cycle_upgrade_[a-f0-9]{32}$/.test(schema))
        throw new Error("Invalid fixture schema");
      await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      try {
        await db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          await tx.$executeRawUnsafe(
            'CREATE TABLE "User" (id uuid PRIMARY KEY)',
          );
          const original = readFileSync(
            "prisma/migrations/20261104160000_say_ring_cycle/migration.sql",
            "utf8",
          );
          for (const raw of original
            .slice(original.indexOf("CREATE TABLE"))
            .split(";")) {
            if (raw.trim()) await tx.$executeRawUnsafe(raw);
          }
          await tx.$executeRaw`INSERT INTO "User"(id) VALUES (${a}::uuid)`;
          await tx.$executeRaw`INSERT INTO "CycleRecord"("userId","clientId",kind,data,"changeSeq","updatedAt") VALUES (${a}::uuid,'legacy','daily','{"date":"2020-03-01","flow":"light"}'::jsonb,1,now())`;
          const before = await tx.$queryRawUnsafe(
            'SELECT to_jsonb(r) AS value FROM "CycleRecord" r',
          );
          const migration = readFileSync(
            "prisma/migrations/20261128120000_cn_cycle/migration.sql",
            "utf8",
          );
          for (const raw of migration.replace(/--[^\n]*/g, "").split(";")) {
            if (raw.trim()) await tx.$executeRawUnsafe(raw);
          }
          expect(
            await tx.$queryRawUnsafe(
              'SELECT to_jsonb(r) AS value FROM "CycleRecord" r',
            ),
          ).toEqual(before);
          expect(
            await tx.$queryRawUnsafe('SELECT * FROM "CnCycleRecord"'),
          ).toEqual([]);
        });
      } finally {
        await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      }
    });
    it("isolates settings, idempotency, records, artifacts, erase epochs and consents while retaining source data", async () => {
      const mutation = randomUUID();
      await ring.sync(a, {
        rows: [row("settings", "settings", settings(false), mutation)],
      });
      await cn.sync(a, {
        rows: [row("settings", "settings", settings(true), mutation)],
      });
      const daily = row(
        "daily-2020-03-01",
        "daily",
        { date: "2020-03-01", flow: "light", symptoms: ["headache"] },
        randomUUID(),
      );
      await cn.sync(a, { schemaVersion: 2, rows: [daily] });
      await cn.sync(a, { schemaVersion: 2, rows: [daily] });
      expect((await ring.changes(a, 0, true)).rows).toHaveLength(1);
      expect((await cn.changes(a, 0, true)).rows).toHaveLength(2);
      expect((await cn.changes(b, 0, true)).rows).toEqual([]);
      expect(
        await db.cnCycleRecord.findUnique({
          where: { userId_clientId: { userId: a, clientId: daily.id } },
        }),
      ).toMatchObject({ revision: 1 });
      await db.cycleArtifact.create({
        data: {
          userId: a,
          kind: "prediction",
          inputHash: "old",
          payload: { retained: true },
          sourceSequence: 1,
        },
      });
      await db.cnCycleArtifact.create({
        data: {
          userId: a,
          kind: "prediction",
          inputHash: "cn",
          payload: { private: true },
          sourceSequence: 2,
        },
      });
      for (const documentType of [
        "say_ring_cycle_ai_analysis",
        "saydian_cn_cycle_ai_analysis",
      ]) {
        await db.consentRecord.create({
          data: {
            userId: a,
            documentType,
            version: "synthetic-v1",
            acceptedAt: new Date(),
            source: "synthetic",
          },
        });
      }
      await cn.erase(a);
      expect(
        await db.cycleRecord.count({ where: { userId: a, deleted: false } }),
      ).toBe(1);
      expect(await db.cycleArtifact.count({ where: { userId: a } })).toBe(1);
      expect(await db.cnCycleArtifact.count({ where: { userId: a } })).toBe(0);
      expect(await db.cnCycleMutation.count({ where: { userId: a } })).toBe(0);
      expect(
        await db.cnCycleState.findUnique({ where: { userId: a } }),
      ).toMatchObject({ epoch: 1 });
      expect(
        await db.cycleState.findUnique({ where: { userId: a } }),
      ).toMatchObject({ epoch: 0 });
      expect(
        await db.consentRecord.findFirst({
          where: { userId: a, documentType: "say_ring_cycle_ai_analysis" },
        }),
      ).toMatchObject({ withdrawnAt: null });
      expect(
        (
          await db.consentRecord.findFirst({
            where: { userId: a, documentType: "saydian_cn_cycle_ai_analysis" },
          })
        )?.withdrawnAt,
      ).not.toBeNull();
      await expect(
        cn.sync(a, { schemaVersion: 2, epoch: 0, rows: [daily] }),
      ).rejects.toThrow();
    });
    it("rejects stale/foreign owner before read or deletion", async () => {
      const controller = new CnCycleController(cn),
        user = { id: a } as never;
      const own = createHash("sha256")
        .update("saydian-health-owner:member:" + a)
        .digest("hex");
      expect(() => controller.changes(user, "foreign")).toThrow();
      expect(() =>
        controller.erase(user, { ownerHash: "foreign", confirmed: true }),
      ).toThrow();
      await expect(
        controller.changes(user, own, "0", "2"),
      ).resolves.toHaveProperty("rows");
    });
  },
);
