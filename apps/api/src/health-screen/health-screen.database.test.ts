import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { MemberScreenLogin } from "./member-screen-login";
import { HealthScreenService } from "./health-screen.service";
import type { PrismaService } from "../common/prisma.service";
import type { IntegrationSecretsService } from "../common/integration-secrets.service";
import {
  authorizeScreen,
  analysisConsent,
  lockReportCredits,
  restoreAnalysisCredit,
  draftRules,
  type ScreenActor,
} from "@saydian/health-domain";

describe.runIf(process.env.RUN_HEALTH_SCREEN_DATABASE_TESTS === "1")(
  "isolated PostgreSQL health screen",
  () => {
    const tag = "hs-" + randomUUID(),
      userId = randomUUID(),
      otherId = randomUUID(),
      superId = randomUUID(),
      auditorId = randomUUID(),
      opsId = randomUUID(),
      partnerId = randomUUID(),
      otherPartnerId = randomUUID();
    const admin: ScreenActor = { type: "ADMIN", id: superId },
      auditor: ScreenActor = { type: "ADMIN", id: auditorId },
      partner: ScreenActor = { type: "PARTNER", id: partnerId };
    let db: PrismaClient, svc: HealthScreenService, levelId: string;
    const rules: string[] = [];
    const now = new Date();
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || "");
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.includes("health_screen_test")
      )
        throw Error("Requires dedicated loopback health_screen_test database");
      vi.stubEnv("H5_DEMO_ENABLED", "false");
      vi.stubEnv("WORKER_OUTBOUND_PAUSED", "false");
      vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
      vi.stubEnv("MAINTENANCE_READ_ONLY", "false");
      db = new PrismaClient();
      svc = new HealthScreenService(
        db as PrismaService,
        {
          resolve: async () => ({
            apiKey: "SYNTHETIC_NEVER_SENT",
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen-plus",
          }),
        } as unknown as IntegrationSecretsService,
      );
      await db.appSetting.upsert({
        where: { key: "member_health_screen" },
        create: { key: "member_health_screen", value: { enabled: true } },
        update: { value: { enabled: true } },
      });
      await db.integrationConfig.upsert({
        where: { key: "ai" },
        create: {
          key: "ai",
          state: "CONFIGURED",
          publicConfig: {
            provider: "compatible",
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen-plus",
          },
        },
        update: {
          state: "CONFIGURED",
          publicConfig: {
            provider: "compatible",
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen-plus",
          },
        },
      });
      for (const [id, role] of [
        [superId, "SUPER_ADMIN"],
        [auditorId, "HEALTH_AUDITOR"],
        [opsId, "APP_OPERATIONS"],
      ] as const)
        await db.adminUser.create({
          data: {
            id,
            username: tag + id,
            displayName: "SYNTHETIC",
            passwordHash: "not-a-login-password",
            role,
            roles: [role],
          },
        });
      const level = await db.partnerLevel.upsert({
        where: { code: "distribution-1" },
        create: { code: "distribution-1", name: "QA strategic" },
        update: { active: true },
      });
      levelId = level.id;
      for (const id of [partnerId, otherPartnerId])
        await db.brandPartner.create({
          data: {
            id,
            partnerNo: tag + id,
            username: tag + id,
            name: "SYNTHETIC",
            passwordHash: "not-a-login-password",
            promotionCode: tag + id,
            levelId,
          },
        });
      await db.globalLegalDocument.create({
        data: {
          documentType: "health_ai_analysis",
          version: tag,
          locale: "zh-Hans",
          title: "Synthetic analysis notice",
          contentHtml: "<p>Only test</p>",
          active: true,
          reviewed: true,
          publishedAt: now,
        },
      });
      for (const id of [userId, otherId])
        await db.user.create({
          data: {
            id,
            nickname: "SYNTHETIC HEALTH QA",
            weightKg: 70,
            locale: "zh-Hans",
            gender: "MALE",
            birthday: new Date("1980-01-01"),
            partnerId: id === userId ? partnerId : otherPartnerId,
            healthProfile: {
              create: {
                timezone: "Asia/Shanghai",
                screenName: "合成测评会员",
                analysisConsentVersion: tag,
                analysisConsentedAt: now,
              },
            },
          },
        });
      await db.healthRecord.createMany({
        data: Array.from({ length: 95 }, (_, i) => ({
          userId,
          clientRecordId: tag + i,
          metric: "HEART_RATE",
          observedAt: new Date(now.valueOf() - i * 86400000),
          timezoneOffsetMinutes: 480,
          values: { bpm: 68 + (i % 10) },
          unit: "bpm",
          quality: "VALID",
          sourcePlatform: "qa",
          sourceOrigin: "watch_history",
          sourceModel: "SYNTHETIC",
          sourceMetadata: { timeBasis: "sdk" },
        })),
      });
      await db.reportCreditLedger.create({
        data: {
          userId,
          type: "ADMIN_ADJUSTMENT",
          delta: 5,
          balanceAfter: 5,
          sourceType: "qa",
          sourceId: tag,
          idempotencyKey: tag,
        },
      });
    }, 30000);
    it("requires profile after access checks, persists only missing fields and leaves App nickname intact", async () => {
      const id = randomUUID();
      await db.user.create({ data: { id, nickname: "微信用户", partnerId } });
      try {
        const self: ScreenActor = { type: "MEMBER", id };
        expect((await svc.profileGate(id, self)).missing).toEqual([
          "name",
          "gender",
          "birthday",
          "weightKg",
        ]);
        await expect(svc.load(id, 7, self)).rejects.toMatchObject({
          status: 428,
        });
        await expect(
          svc.records(id, { days: "7" }, self),
        ).rejects.toMatchObject({ status: 428 });
        await expect(svc.load(userId, 7, self)).rejects.toMatchObject({
          status: 403,
        });
        expect((await svc.profileGate(id, partner)).canComplete).toBe(false);
        const fields = {
          name: "示例小林",
          gender: "FEMALE",
          birthday: "2016-02-29",
          weightKg: 35,
        };
        await expect(
          svc.completeProfile(id, fields, partner),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          svc.completeProfile(id, { ...fields, birthday: "2015-02-29" }, self),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
          svc.completeProfile(id, { ...fields, userId }, self),
        ).rejects.toMatchObject({ status: 400 });
        expect((await svc.completeProfile(id, fields, self)).missing).toEqual(
          [],
        );
        expect((await svc.load(id, 7, self)).member).toMatchObject({
          id,
          nickname: "示例小林",
          gender: "FEMALE",
          weightKg: 35,
        });
        expect(
          (await db.user.findUniqueOrThrow({ where: { id } })).nickname,
        ).toBe("微信用户");
        await expect(
          svc.completeProfile(id, { weightKg: 90 }, admin),
        ).rejects.toMatchObject({ status: 409 });
        await db.user.update({ where: { id }, data: { birthday: null } });
        await expect(svc.updates(id, 7, self)).rejects.toMatchObject({
          status: 428,
        });
      } finally {
        await db.user.delete({ where: { id } });
      }
    });
    it("edits existing personal details with a version check and keeps the member number and measurements", async () => {
      const id = randomUUID(),
        self: ScreenActor = { type: "MEMBER", id };
      await db.user.create({
        data: {
          id,
          nickname: "隔离编辑验收",
          gender: "MALE",
          birthday: new Date("1986-01-01"),
          weightKg: 71,
          heightCm: 170.25,
          partnerId,
          healthProfile: { create: { screenName: "原姓名" } },
        },
      });
      try {
        const gate = await svc.profileGate(id, self);
        const input = {
          expectedRevision: gate.revision,
          name: "已更新姓名",
          birthday: "2015-01-01",
          gender: "FEMALE",
          weightKg: 36.5,
          heightCm: 141.25,
        };
        await expect(
          svc.completeProfile(id, input, partner),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          svc.completeProfile(id, { ...input, heightCm: 401 }, self),
        ).rejects.toMatchObject({ status: 400 });
        const saved = await svc.completeProfile(id, input, self);
        expect(saved.memberNo).toBe(gate.memberNo);
        expect(saved.profile).toMatchObject({
          name: input.name,
          heightCm: 141.25,
          weightKg: 36.5,
          gender: "FEMALE",
        });
        await expect(
          svc.completeProfile(
            id,
            { expectedRevision: gate.revision, weightKg: 68 },
            admin,
          ),
        ).rejects.toMatchObject({ status: 409 });
        const changes = await Promise.allSettled(
          [65, 67].map((weightKg) =>
            svc.completeProfile(
              id,
              { expectedRevision: saved.revision, weightKg },
              admin,
            ),
          ),
        );
        expect(changes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(changes.find((r) => r.status === "rejected")).toMatchObject({
          reason: { status: 409 },
        });
        const current = await svc.profileGate(id, self);
        await svc.completeProfile(
          id,
          { expectedRevision: current.revision, heightCm: null },
          self,
        );
        expect((await svc.load(id, 7, self)).member).toMatchObject({
          id,
          gender: "FEMALE",
          nickname: "已更新姓名",
          heightCm: null,
          memberNo: gate.memberNo,
        });
        expect(await db.healthRecord.count({ where: { userId: id } })).toBe(0);
        expect(
          await db.user.findUniqueOrThrow({
            where: { id },
            select: { nickname: true },
          }),
        ).toEqual({ nickname: "隔离编辑验收" });
        const audit = await db.auditLog.findMany({
          where: {
            action: "MEMBER_HEALTH_SCREEN_PROFILE_UPDATED",
            entityId: id,
          },
        });
        expect(audit).toHaveLength(3);
        expect(JSON.stringify(audit.map((r) => r.afterJson))).not.toContain(
          input.name,
        );
      } finally {
        await db.user.delete({ where: { id } });
      }
    });
    it("separates scan and desktop secrets, consumes once and revokes with the parent member session", async () => {
      const login = new MemberScreenLogin(db as unknown as PrismaService);
      const orig = await db.userSession.create({
        data: {
          userId,
          accessJti: randomUUID(),
          refreshTokenHash: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const user = { id: userId, sessionId: orig.id };
      try {
        const req = await login.createQr();
        const token = new URLSearchParams(
          new URL(req.scanUrl).hash.split("?")[1],
        ).get("scan")!;
        expect(req.scanUrl).not.toContain(req.poll);
        expect((await login.inspect(token)).match).toBe(req.match);
        expect(await login.poll(req.poll)).toEqual({ status: "pending" });
        await expect(login.poll(token)).rejects.toMatchObject({ status: 410 });
        await expect(
          login.approve(token, { ...user, id: otherId }),
        ).rejects.toMatchObject({ status: 401 });
        await login.approve(token, user);
        const results = await Promise.allSettled([
          login.poll(req.poll),
          login.poll(req.poll),
        ]);
        const valid = results.flatMap((r) =>
          r.status === "fulfilled" && "token" in r.value
            ? [r.value.token!]
            : [],
        );
        expect(valid).toHaveLength(1);
        expect((await login.resolve(valid[0]!)).id).toBe(userId);
        const sms = await login.exchange(user);
        await login.logout(sms.token);
        await expect(login.resolve(sms.token)).rejects.toMatchObject({
          status: 401,
        });
        const cancelled = await login.createQr();
        await login.cancel(cancelled.poll);
        await expect(login.poll(cancelled.poll)).rejects.toMatchObject({
          status: 410,
        });
        await db.userSession.update({
          where: { id: orig.id },
          data: { revokedAt: new Date() },
        });
        await expect(login.resolve(valid[0]!)).rejects.toMatchObject({
          status: 401,
        });
      } finally {
        await db.userSession.delete({ where: { id: orig.id } });
      }
    });
    afterAll(async () => {
      if (!db) return;
      const analyses = await db.memberHealthAnalysis.findMany({
        where: { userId: { in: [userId, otherId] } },
        select: { id: true },
      });
      await db.outboxEvent.deleteMany({
        where: { aggregateId: { in: analyses.map((x) => x.id) } },
      });
      await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
      await db.healthScoreRuleVersion.deleteMany({
        where: { id: { in: rules } },
      });
      await db.brandPartner.deleteMany({
        where: { id: { in: [partnerId, otherPartnerId] } },
      });
      await db.adminUser.deleteMany({
        where: { id: { in: [superId, auditorId, opsId] } },
      });
      await db.globalLegalDocument.deleteMany({ where: { version: tag } });
      await db.auditLog.deleteMany({
        where: {
          actorId: {
            in: [superId, auditorId, opsId, partnerId, otherPartnerId],
          },
        },
      });
      await db.$disconnect();
      vi.unstubAllEnvs();
    });
    it("loads complete 90-day windows without the old 31-day truncation", async () => {
      const r = await svc.load(userId, "90", admin);
      expect(r.coverageDays).toBe(90);
      expect(r.recordCount).toBe(90);
      expect(r.series[0]!.points).toHaveLength(90);
      expect(r.score.total).toBeNull();
    });
    it("rejects non-health admins, cross-partner reads and downgraded strategic level", async () => {
      await expect(
        svc.load(userId, 7, { type: "ADMIN", id: opsId }),
      ).rejects.toThrow();
      await expect(svc.load(otherId, 7, partner)).rejects.toThrow();
      await db.partnerLevel.update({
        where: { id: levelId },
        data: { active: false },
      });
      await expect(svc.load(userId, 7, partner)).rejects.toThrow();
      await db.partnerLevel.update({
        where: { id: levelId },
        data: { active: true },
      });
      expect((await svc.load(userId, 7, partner)).member.id).toBe(userId);
    });
    it("audits access and requires an explicit reason for auditor record inspection", async () => {
      await expect(svc.records(userId, { days: "7" }, auditor)).rejects.toThrow(
        "原因",
      );
      const r = await svc.records(
        userId,
        { days: "90", reason: "合成会员数据回归验证" },
        auditor,
        "qa-request",
      );
      expect(r.items).toHaveLength(50);
      expect(r.nextCursor).toBeTruthy();
      const second = await svc.records(
        userId,
        { days: "90", reason: "合成会员数据回归验证", cursor: r.nextCursor! },
        auditor,
      );
      expect(second.items).toHaveLength(40);
      expect(new Set([...r.items, ...second.items].map((x) => x.id)).size).toBe(
        90,
      );
      const times = [...r.items, ...second.items].map((x) => x.measuredAt);
      expect(times).toEqual([...times].sort().reverse());
      expect(
        await db.auditLog.count({ where: { requestId: "qa-request" } }),
      ).toBe(1);
    });
    it("does not restore a removed health role through the legacy primary role", async () => {
      await db.adminUser.update({
        where: { id: superId },
        data: { roles: ["APP_OPERATIONS"] },
      });
      try {
        await expect(svc.load(userId, 7, admin)).rejects.toThrow();
      } finally {
        await db.adminUser.update({
          where: { id: superId },
          data: { roles: ["SUPER_ADMIN"] },
        });
      }
    });
    it("creates one analysis and debits once for simultaneous different request keys", async () => {
      const screen = await svc.load(userId, 7, partner),
        requests = Array.from({ length: 4 }, () => ({
          days: 7,
          inputDigest: screen.dataDigest,
          requestKey: randomUUID(),
        }));
      const results = await Promise.all(
        requests.map((input) => svc.generate(userId, input, partner)),
      );
      expect(new Set(results.map((r) => r.id)).size).toBe(1);
      const id = results[0]!.id;
      expect(
        await db.reportCreditLedger.count({
          where: { memberHealthAnalysisId: id, type: "CONSUME" },
        }),
      ).toBe(1);
      expect(await db.outboxEvent.count({ where: { aggregateId: id } })).toBe(
        1,
      );
      expect((await svc.generate(userId, requests[0], partner)).id).toBe(id);
    });
    it("does not expose analysis results after member reassignment or consent withdrawal", async () => {
      const row = await db.memberHealthAnalysis.findFirstOrThrow({
        where: { userId, consentBypass: false },
      });
      await db.user.update({
        where: { id: userId },
        data: { partnerId: otherPartnerId },
      });
      await expect(svc.result(userId, row.id, partner)).rejects.toThrow();
      await expect(authorizeScreen(db, partner, userId)).rejects.toThrow();
      await db.user.update({ where: { id: userId }, data: { partnerId } });
      await db.healthProfile.update({
        where: { userId },
        data: { analysisConsentWithdrawn: new Date() },
      });
      await expect(svc.result(userId, row.id, partner)).rejects.toThrow();
      expect((await svc.load(userId, 7, partner)).analysis).toBeNull();
      await expect(analysisConsent(db, userId, false)).rejects.toThrow();
      await db.healthProfile.update({
        where: { userId },
        data: { analysisConsentWithdrawn: null },
      });
    });
    it("restores a consumed credit exactly once under repeated failure handling", async () => {
      const row = await db.memberHealthAnalysis.findFirstOrThrow({
        where: { userId, consentBypass: false },
      });
      await Promise.all(
        Array.from({ length: 3 }, () =>
          db.$transaction(async (tx) => {
            await lockReportCredits(tx, userId);
            await restoreAnalysisCredit(tx, userId, row.id);
          }),
        ),
      );
      expect(
        await db.reportCreditLedger.count({
          where: { idempotencyKey: `member-analysis-restore:${row.id}` },
        }),
      ).toBe(1);
    });
    it("prevents stale data submissions and transaction failure leaves no task or debit", async () => {
      const before = await db.memberHealthAnalysis.count({ where: { userId } });
      await expect(
        svc.generate(
          userId,
          { days: 7, inputDigest: "0".repeat(64), requestKey: randomUUID() },
          partner,
        ),
      ).rejects.toThrow("更新");
      expect(await db.memberHealthAnalysis.count({ where: { userId } })).toBe(
        before,
      );
    });
    it("allows audited super-admin bypass but never grants it to partners", async () => {
      await db.healthProfile.update({
        where: { userId },
        data: { analysisConsentWithdrawn: new Date() },
      });
      const screen = await svc.load(userId, 7, admin);
      const r = await svc.generate(
        userId,
        { days: 7, inputDigest: screen.dataDigest, requestKey: randomUUID() },
        admin,
      );
      expect(
        await db.reportCreditLedger.count({
          where: { memberHealthAnalysisId: r.id },
        }),
      ).toBe(0);
      await expect(svc.result(userId, r.id, partner)).rejects.toThrow();
      await db.healthProfile.update({
        where: { userId },
        data: { analysisConsentWithdrawn: null },
      });
    });
    it("allows only super-admin to publish; published rules are immutable and version changes invalidate analysis", async () => {
      const before = await svc.load(userId, 7, admin);
      await expect(svc.saveRules({}, auditor)).rejects.toThrow();
      const ruleset = draftRules();
      ruleset.items = ruleset.items.slice(0, 1).map((i) => ({
        ...i,
        bands: [{ min: null, max: null, score: 80 }],
        basis: "ONLY SYNTHETIC QA; not a production health rule",
        referenceUrl: "https://example.org/qa",
      }));
      const saved = await svc.saveRules({ rules: ruleset }, admin);
      rules.push(saved.id);
      await svc.publish(
        saved.id,
        { reviewed: true, expectedUpdatedAt: saved.updatedAt.toISOString() },
        admin,
      );
      await expect(
        svc.saveRules({ id: saved.id, rules: ruleset }, admin),
      ).rejects.toThrow("不可修改");
      const current = await svc.load(userId, 7, admin);
      expect(current.score.total).toBe(80);
      expect(current.dataDigest).not.toBe(before.dataDigest);
      expect(current.analysisStale).toBe(true);
      await db.healthScoreRuleVersion.update({
        where: { id: saved.id },
        data: { status: "ARCHIVED" },
      });
    });
    it("checks feature state on every request and does not delete historical data when disabled", async () => {
      await svc.settings({ enabled: false }, admin);
      await expect(svc.load(userId, 7, admin)).rejects.toThrow("尚未开放");
      expect(await db.healthRecord.count({ where: { userId } })).toBe(95);
      await svc.settings({ enabled: true }, admin);
    });
    it("records manual references idempotently without changing original measurements, and includes them in analysis", async () => {
      const rawBefore = await db.healthRecord.findMany({
        where: { userId },
        orderBy: { id: "asc" },
      });
      const before = await svc.load(userId, 7, admin);
      const input = {
        metric: "BLOOD_GLUCOSE",
        measuredAt: new Date(Date.now() - 3600000).toISOString(),
        unit: "mmol/L",
        values: { value: 5.8 },
        method: "GLUCOSE_METER",
        context: "FASTING",
        requestKey: randomUUID(),
      };
      const saved = await Promise.all([
        svc.saveReference(userId, input, partner),
        svc.saveReference(userId, input, partner),
      ]);
      expect(saved[0]!.id).toBe(saved[1]!.id);
      expect(
        await db.healthRecord.findMany({
          where: { userId },
          orderBy: { id: "asc" },
        }),
      ).toEqual(rawBefore);
      const after = await svc.load(userId, 7, admin);
      expect(after.dataDigest).not.toBe(before.dataDigest);
      expect(after.series.find((s) => s.kind === "reference")?.average).toBe(
        5.8,
      );
      expect(
        after.series.find((s) => s.key === "blood_glucose")?.eligibleCount || 0,
      ).toBe(0);
      await expect(
        svc.saveReference(userId, { ...input, values: { value: 7 } }, partner),
      ).rejects.toThrow("请求已处理");
      await expect(
        svc.saveReference(otherId, input, partner),
      ).rejects.toThrow();
    });
    it("rechecks access to reference history, writes and revision polling after ownership changes", async () => {
      await db.user.update({
        where: { id: userId },
        data: { partnerId: otherPartnerId },
      });
      try {
        await expect(
          svc.references(userId, undefined, partner),
        ).rejects.toThrow();
        await expect(svc.updates(userId, 7, partner)).rejects.toThrow();
        await expect(
          svc.saveReference(
            userId,
            {
              metric: "BLOOD_PRESSURE",
              measuredAt: new Date(Date.now() - 1000).toISOString(),
              unit: "mmHg",
              values: { systolic: 120, diastolic: 80 },
              method: "BLOOD_PRESSURE_MONITOR",
              context: "RESTING",
              requestKey: randomUUID(),
            },
            partner,
          ),
        ).rejects.toThrow();
      } finally {
        await db.user.update({ where: { id: userId }, data: { partnerId } });
      }
      await expect(
        svc.references(userId, undefined, { type: "ADMIN", id: opsId }),
      ).rejects.toThrow();
    });
    it("retains withdrawn reference history and updates the digest without rewriting AI snapshots", async () => {
      const row = (await svc.references(userId, undefined, admin)).items[0]!;
      const before = await svc.load(userId, 7, admin),
        revision = await svc.updates(userId, 7, admin);
      await expect(
        svc.voidReference(
          otherId,
          row.id,
          { reason: "错误输入需要撤销" },
          admin,
        ),
      ).rejects.toThrow();
      const result = await svc.voidReference(
        userId,
        row.id,
        { reason: "本地合成验收撤销" },
        admin,
      );
      expect(result.voidedAt).not.toBeNull();
      await svc.voidReference(
        userId,
        row.id,
        { reason: "重复提交不得覆盖" },
        admin,
      );
      expect(
        (await svc.references(userId, undefined, admin)).items[0]!.voidReason,
      ).toBe("本地合成验收撤销");
      const after = await svc.load(userId, 7, admin);
      expect(after.series.some((s) => s.kind === "reference")).toBe(false);
      expect(after.dataDigest).not.toBe(before.dataDigest);
      expect(await svc.updates(userId, 7, admin)).not.toEqual(revision);
      expect(
        await db.auditLog.count({
          where: { action: "MEMBER_HEALTH_REFERENCE_VOID", entityId: userId },
        }),
      ).toBe(1);
    });

    it("persists uric acid and lipid panels, revises the metabolic hotspot and preserves raw data", async () => {
      const rawBefore = await db.healthRecord.findMany({
        where: { userId },
        orderBy: { id: "asc" },
      });
      const before = await svc.load(userId, 7, admin);
      const rev = await svc.updates(userId, 7, partner);
      for (const patch of [
        { metric: "URIC_ACID", unit: "μmol/L", values: { value: 360 } },
        {
          metric: "BLOOD_LIPIDS",
          unit: "mmol/L",
          values: {
            totalCholesterol: 4.5,
            triglycerides: 1.2,
            hdl: 1.3,
            ldl: 2.5,
          },
        },
      ]) {
        await svc.saveReference(
          userId,
          {
            ...patch,
            method: "LAB_REPORT",
            context: "FASTING",
            measuredAt: new Date(Date.now() - 1000).toISOString(),
            requestKey: randomUUID(),
          },
          partner,
        );
      }
      const after = await svc.load(userId, 7, partner);
      expect(after.series.filter((s) => s.kind === "reference")).toHaveLength(
        5,
      );
      expect(
        after.series
          .filter((s) => s.kind === "reference")
          .every((s) => s.group === "metabolic" && s.eligibleCount === 0),
      ).toBe(true);
      expect(after.eligibleRecordCount).toBe(before.eligibleRecordCount);
      expect(after.dataDigest).not.toBe(before.dataDigest);
      expect(await svc.updates(userId, 7, partner)).not.toEqual(rev);
      expect(
        await db.healthRecord.findMany({
          where: { userId },
          orderBy: { id: "asc" },
        }),
      ).toEqual(rawBefore);
      const history = (await svc.references(userId, undefined, partner)).items;
      expect(
        history.some(
          (r) => r.metric === "BLOOD_LIPIDS" && r.values.hdl === 1.3,
        ),
      ).toBe(true);
    });
    it("includes every new upload in regional updates without promoting unknown-quality records into scores", async () => {
      const before = await svc.updates(userId, 7, admin),
        facts = await svc.load(userId, 7, admin),
        prefix = "regional-upload-" + randomUUID();
      const records = [
        { metric: "HEART_RATE", unit: "bpm", values: { bpm: 74 } },
        { metric: "ECG", unit: null, values: {} },
        { metric: "BLOOD_OXYGEN", unit: "%", values: { percent: 98 } },
        { metric: "STEPS", unit: "steps", values: { steps: 42 } },
        { metric: "BODY_COMPOSITION", unit: "%", values: { bodyFat: 20 } },
        { metric: "BLOOD_COMPOSITION", unit: null, values: {} },
      ] as const;
      try {
        await db.healthRecord.createMany({
          data: records.map((r, i) => ({
            ...r,
            userId,
            clientRecordId: prefix + i,
            observedAt: new Date(Date.now() - 1000),
            timezoneOffsetMinutes: 480,
            quality: "UNKNOWN",
            sourcePlatform: "qa",
            sourceOrigin: "app_measurement",
            sourceModel: "SYNTHETIC",
            sourceMetadata: { timeBasis: "sdk" },
          })),
        });
        const after = await svc.updates(userId, 7, admin);
        for (const [group, added] of [
          ["cardiovascular", 2],
          ["oxygen", 1],
          ["activity", 1],
          ["metabolic", 2],
        ] as const)
          expect(after.groups.find((g) => g.group === group)?.count).toBe(
            (before.groups.find((g) => g.group === group)?.count || 0) + added,
          );
        expect((await svc.load(userId, 7, admin)).eligibleRecordCount).toBe(
          facts.eligibleRecordCount,
        );
      } finally {
        await db.healthRecord.deleteMany({
          where: { userId, clientRecordId: { startsWith: prefix } },
        });
      }
    });
    it("detects updated old measurements and rejects reference writes during maintenance", async () => {
      const before = await svc.updates(userId, 90, admin);
      const oldest = await db.healthRecord.findFirstOrThrow({
        where: {
          userId,
          observedAt: { gte: new Date(Date.now() - 88 * 86400000) },
        },
        orderBy: { observedAt: "asc" },
      });
      await db.healthRecord.update({
        where: { id: oldest.id },
        data: { updatedAt: new Date(Date.now() + 1000) },
      });
      expect(await svc.updates(userId, 90, admin)).not.toEqual(before);
      vi.stubEnv("BUSINESS_WRITES_PAUSED", "true");
      try {
        await expect(svc.saveReference(userId, {}, admin)).rejects.toThrow(
          "暂停",
        );
      } finally {
        vi.stubEnv("BUSINESS_WRITES_PAUSED", "false");
      }
    });
  },
);
