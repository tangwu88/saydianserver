import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { SayHeathService } from "./service";
import { SayHeathAdminController } from "./sayheath.controller";
import { documents, release } from "./policy";
import { UserAuthGuard } from "../common/user-auth.guard";
import type { PrismaService } from "../common/prisma.service";
import type { AuthService } from "../auth/auth.service";
describe.runIf(process.env.RUN_SAYHEATH_DATABASE_TESTS === "1")(
  "SayHeath isolated database",
  () => {
    let db: PrismaClient, svc: SayHeathService, admin: SayHeathAdminController;
    const key = "a".repeat(64),
      id = randomUUID(),
      password = "Synthetic-only-4817",
      v = "test-" + id,
      ids: string[] = [];
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL ?? "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !["/sayheath_test", "/saydian_app_test"].includes(url.pathname)
      )
        throw Error("Isolated local test database required");
      vi.stubEnv("DEPLOYMENT_SITE", "us");
      vi.stubEnv("GLOBAL_UNVERIFIED_REGISTRATION_ENABLED", "true");
      db = new PrismaClient();
      svc = new SayHeathService(db as PrismaService, {} as AuthService);
      admin = new SayHeathAdminController(db as PrismaService);
      for (const documentType of documents)
        await db.globalLegalDocument.create({
          data: {
            documentType,
            version: v,
            locale: "en",
            active: true,
            reviewed: true,
            publishedAt: new Date(),
            title: "Fixture",
            contentHtml: "<p>Fixture</p>",
          },
        });
    });
    afterAll(async () => {
      if (db) {
        await db.user.deleteMany({ where: { id: { in: ids } } });
        await db.globalLegalDocument.deleteMany({
          where: { version: v, documentType: { in: [...documents] } },
        });
        await db.sayHeathSwitch.deleteMany({ where: { release } });
        await db.auditLog.deleteMany({ where: { actorId: id } });
        await db.$disconnect();
      }
      vi.unstubAllEnvs();
    });
    it("separates identity, history, captures, per-category grants and both participants", async () => {
      const make = async (suffix: string) => {
        const email = id + suffix + "@example.invalid";
        const res = await svc.sign(
          { email, password, release, accepted: true, legalVersion: v },
          true,
        );
        ids.push(res.userId);
        return {
          email,
          token: res.token,
          s: await svc.session("Bearer " + res.token),
        };
      };
      const a = await make("a"),
        b = await make("b"),
        c = await make("c");
      const existing = await svc.sign(
        { email: a.email, password, release, accepted: true, legalVersion: v },
        false,
      );
      expect(existing.userId).toBe(a.s.userId);
      await expect(
        svc.sign(
          {
            email: a.email,
            password,
            release,
            accepted: false,
            legalVersion: v,
          },
          false,
        ),
      ).rejects.toThrow();
      await expect(svc.session("Bearer legacy")).rejects.toThrow();
      await expect(
        new UserAuthGuard(db as PrismaService).canActivate({
          switchToHttp: () => ({
            getRequest: () => ({
              path: "/api/v1/member/health",
              header: () => "Bearer " + a.token,
            }),
          }),
        } as never),
      ).rejects.toThrow();
      expect(
        Object.values((await svc.policy(db, a.s)).features).every(
          (f) => !f.enabled && !f.consented,
        ),
      ).toBe(true);
      await db.healthRecord.createMany({
        data: [
          {
            userId: a.s.userId,
            clientRecordId: "old-bp",
            metric: "BLOOD_PRESSURE",
            values: { systolic: 115, diastolic: 75 },
            unit: "mmHg",
          },
          {
            userId: a.s.userId,
            clientRecordId: "activity",
            metric: "STEPS",
            values: { steps: 125, nested: { pulse: 100 } },
            unit: "steps",
          },
          {
            userId: a.s.userId,
            clientRecordId: "sleep",
            metric: "SLEEP",
            values: { hours: 7 },
            unit: "h",
          },
        ].map((r) => ({
          ...r,
          observedAt: new Date(),
          timezoneOffsetMinutes: 0,
          sourcePlatform: "test",
        })) as never,
      });
      const history = await svc.activity(db, a.s.userId, ["activity", "sleep"]);
      expect(history.items).toHaveLength(2);
      expect(JSON.stringify(history)).not.toContain("pulse");
      await expect(
        svc.capture(db, a.s, { feature: "bloodPressure", deviceKey: key }),
      ).rejects.toThrow();
      const actor = { id, role: "SUPER_ADMIN" },
        sw = await admin.set(actor, "bloodPressure", {
          enabled: true,
          expectedRevision: null,
          release,
        });
      await expect(
        svc.capture(db, a.s, { feature: "bloodPressure", deviceKey: key }),
      ).rejects.toThrow();
      await svc.grant(db, a.s, { feature: "bloodPressure", allow: true });
      expect(await svc.history(db, a.s, "bloodPressure")).toEqual([]);
      const ticket = await svc.capture(db, a.s, {
        feature: "bloodPressure",
        deviceKey: key,
      });
      const packet = {
        deviceKey: key,
        feature: "bloodPressure",
        unit: "mmHg",
        values: { systolic: 114, diastolic: 75 },
        observedAt: new Date(+ticket.startedAt + 1).toISOString(),
      };
      await expect(svc.receive(db, b.s, ticket.id, packet)).rejects.toThrow();
      await expect(
        svc.receive(db, a.s, ticket.id, {
          ...packet,
          observedAt: new Date(+ticket.startedAt - 60000).toISOString(),
        }),
      ).rejects.toThrow();
      await expect(
        svc.receive(db, a.s, ticket.id, {
          ...packet,
          values: { ...packet.values, heartRate: 70 },
        }),
      ).rejects.toThrow();
      expect(await svc.receive(db, a.s, ticket.id, packet)).toMatchObject({
        received: true,
        id: ticket.id,
      });
      expect(await svc.receive(db, a.s, ticket.id, packet)).toMatchObject({
        received: true,
        id: ticket.id,
      });
      expect(await svc.history(db, a.s, "bloodPressure")).toHaveLength(1);
      expect(await svc.reading(db, a.s, ticket.id)).toMatchObject({
        id: ticket.id,
        values: packet.values,
      });
      await expect(svc.reading(db, b.s, ticket.id)).rejects.toThrow();
      const family = await svc.invite(db, a.s, {
        email: b.email,
        activity: true,
        sleep: true,
      });
      await expect(
        svc.familyAction(db, b.s, family.id, "read", {}),
      ).rejects.toThrow();
      await svc.familyAction(db, b.s, family.id, "accept", {
        activity: true,
        sleep: false,
      });
      expect(
        await svc.familyAction(db, b.s, family.id, "read", {}),
      ).toMatchObject({ items: [{ feature: "activity", value: 125 }] });
      await expect(
        svc.familyAction(db, c.s, family.id, "read", {}),
      ).rejects.toThrow();
      await svc.familyAction(db, a.s, family.id, "offer", {
        activity: false,
        sleep: true,
      });
      await expect(
        svc.familyAction(db, b.s, family.id, "read", {}),
      ).rejects.toThrow();
      await svc.familyAction(db, a.s, family.id, "offer", {
        activity: true,
        sleep: true,
      });
      await expect(
        svc.familyAction(db, b.s, family.id, "read", {}),
      ).rejects.toThrow();
      const off = await admin.set(actor, "bloodPressure", {
        release,
        enabled: false,
        expectedRevision: sw.revision,
      });
      await expect(svc.history(db, a.s, "bloodPressure")).rejects.toThrow();
      await admin.set(actor, "bloodPressure", {
        release,
        enabled: true,
        expectedRevision: off.revision,
      });
      await expect(svc.history(db, a.s, "bloodPressure")).rejects.toThrow();
      await svc.grant(db, a.s, { feature: "bloodPressure", allow: true });
      await expect(svc.receive(db, a.s, ticket.id, packet)).rejects.toThrow();
      await svc.grant(db, a.s, { feature: "bloodPressure", allow: false });
      await expect(svc.history(db, a.s, "bloodPressure")).rejects.toThrow();
      await expect(svc.reading(db, a.s, ticket.id)).rejects.toThrow();
      await db.user.update({
        where: { id: a.s.userId },
        data: { passwordHash: "synthetic-rotated" },
      });
      await expect(svc.session("Bearer " + a.token)).rejects.toThrow();
      vi.stubEnv("DEPLOYMENT_SITE", "cn");
      await expect(svc.legal()).rejects.toThrow();
    });
  },
);
