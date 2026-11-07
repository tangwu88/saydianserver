import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import type Redis from "ioredis";
import {
  ScreenAccumulator,
  screenPeriod,
  lockReportCredits,
  consumeAnalysisCredit,
  analysisConsent,
} from "@saydian/health-domain";
import { MemberHealthAnalysisWorker } from "./member-health-analysis-worker";
import { OutboxWorker } from "./outbox-worker";
import type { PushProvider } from "./push-provider";

describe.runIf(process.env.RUN_HEALTH_SCREEN_DATABASE_TESTS === "1")(
  "health analysis queued authorization and credits",
  () => {
    const tag = "worker-screen-" + randomUUID(),
      userId = randomUUID(),
      partnerId = randomUUID();
    let db: PrismaClient,
      worker: MemberHealthAnalysisWorker,
      outbox: OutboxWorker,
      levelId: string;
    const fetchMock = vi.fn();
    const a = new ScreenAccumulator(
      screenPeriod(7, "Asia/Shanghai", new Date()),
    );
    for (let n = 0; n < 4; n++) {
      const at = new Date(Date.now() - n * 86400000);
      a.add({
        id: randomUUID(),
        metric: "HEART_RATE",
        observedAt: at,
        createdAt: at,
        updatedAt: at,
        values: { bpm: 71 + n },
        unit: "bpm",
        quality: "VALID",
        sourceOrigin: "watch_history",
        sourceModel: "SYNTHETIC",
        sourceMetadata: { timeBasis: "sdk" },
        aggregationKind: null,
        aggregationActive: false,
        aggregationLocalDate: null,
      });
    }
    const facts = a.finish(null, null, { age: 40, gender: "MALE" });
    const answer = {
      summary: [
        {
          text: "已记录心率数据，需结合测量背景查看",
          evidence: ["heart_rate"],
        },
      ],
      insights: [
        {
          key: "heart_rate",
          text: "本周期有4天记录",
          evidence: ["heart_rate"],
        },
      ],
      suggestions: [{ text: "继续按说明记录", evidence: ["heart_rate"] }],
      limitations: ["AI生成的健康管理参考，不用于临床诊断"],
    };
    const response = () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(answer) },
            },
          ],
        }),
        { status: 200 },
      );
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL || "");
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        !url.pathname.includes("health_screen_test")
      )
        throw Error("Dedicated local health_screen_test database required");
      for (const [k, v] of Object.entries({
        WORKER_OUTBOUND_PAUSED: "false",
        HEALTH_REPORT_WORKER_ENABLED: "true",
        MAINTENANCE_READ_ONLY: "false",
        BUSINESS_WRITES_PAUSED: "false",
        H5_DEMO_ENABLED: "false",
        AI_API_KEY: "SYNTHETIC_NEVER_SENT",
        AI_MODEL: "qwen-plus",
        AI_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      }))
        vi.stubEnv(k, v);
      vi.stubGlobal("fetch", fetchMock);
      db = new PrismaClient();
      worker = new MemberHealthAnalysisWorker(db);
      outbox = new OutboxWorker(
        db,
        { set: async () => "OK", del: async () => 1 } as unknown as Redis,
        {} as PushProvider,
        undefined,
        undefined,
        undefined,
        undefined,
        worker,
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
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen-plus",
          },
        },
        update: {
          state: "CONFIGURED",
          publicConfig: {
            baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen-plus",
          },
        },
      });
      const level = await db.partnerLevel.upsert({
        where: { code: "distribution-1" },
        create: { code: "distribution-1", name: "Synthetic strategic" },
        update: { active: true },
      });
      levelId = level.id;
      await db.brandPartner.create({
        data: {
          id: partnerId,
          username: tag,
          partnerNo: tag,
          promotionCode: tag,
          name: "SYNTHETIC",
          levelId,
          passwordHash: "not-a-password",
        },
      });
      await db.globalLegalDocument.create({
        data: {
          documentType: "health_ai_analysis",
          version: tag,
          locale: "zh-Hans",
          title: "Synthetic worker notice",
          contentHtml: "<p>Only local regression</p>",
          active: true,
          reviewed: true,
          publishedAt: new Date(),
        },
      });
      await db.user.create({
        data: {
          id: userId,
          partnerId,
          locale: "zh-Hans",
          nickname: "SYNTHETIC WORKER",
          healthProfile: {
            create: {
              analysisConsentVersion: tag,
              analysisConsentedAt: new Date(),
            },
          },
        },
      });
      await db.reportCreditLedger.create({
        data: {
          userId,
          type: "ADMIN_ADJUSTMENT",
          delta: 10,
          balanceAfter: 10,
          sourceType: "qa",
          sourceId: tag,
          idempotencyKey: tag,
        },
      });
    });
    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(response());
    });
    afterAll(async () => {
      if (db) {
        await db.outboxEvent.deleteMany({
          where: {
            aggregateId: {
              in: (
                await db.memberHealthAnalysis.findMany({
                  where: { userId },
                  select: { id: true },
                })
              ).map((x) => x.id),
            },
          },
        });
        await db.user.deleteMany({ where: { id: userId } });
        await db.brandPartner.deleteMany({ where: { id: partnerId } });
        await db.globalLegalDocument.deleteMany({ where: { version: tag } });
        await db.$disconnect();
      }
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });
    async function enqueue() {
      return db.$transaction(async (tx) => {
        await lockReportCredits(tx, userId);
        const id = randomUUID();
        await tx.memberHealthAnalysis.create({
          data: {
            id,
            userId,
            actorType: "PARTNER",
            actorId: partnerId,
            consentSnapshot: await analysisConsent(tx, userId, false),
            requestKey: randomUUID(),
            inputDigest: facts.dataDigest,
            windowDays: 7,
            period: facts.period as unknown as Prisma.InputJsonValue,
            facts: facts as unknown as Prisma.InputJsonValue,
            evidenceIndex: [],
            scoreSnapshot: facts.score as unknown as Prisma.InputJsonValue,
            templateVersion: "worker-test",
          },
        });
        await consumeAnalysisCredit(tx, userId, id);
        await tx.outboxEvent.create({
          data: {
            eventId: tag + id,
            eventType: "member_health_analysis_generate",
            aggregateType: "member_health_analysis",
            aggregateId: id,
            payload: { analysisId: id },
          },
        });
        return id;
      });
    }
    it("persists validated output in the independent analysis store, once per outbox event", async () => {
      const id = await enqueue();
      await outbox.runOnce();
      await outbox.runOnce();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const row = await db.memberHealthAnalysis.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe("READY");
      expect(row.aiModel).toBe("qwen-plus");
      expect(row.content).toEqual(answer);
      expect(await db.healthReport.count({ where: { userId } })).toBe(0);
      const body = String(fetchMock.mock.calls[0]![1].body);
      expect(body).not.toContain(userId);
      expect(body).not.toContain("SYNTHETIC WORKER");
    });
    it("rechecks ownership before calling the provider and refunds once", async () => {
      const id = await enqueue();
      await db.user.update({
        where: { id: userId },
        data: { partnerId: null },
      });
      await outbox.runOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        (await db.memberHealthAnalysis.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe("FAILED");
      await Promise.all([
        worker.failPermanently(id),
        worker.failPermanently(id),
      ]);
      expect(
        await db.reportCreditLedger.count({
          where: { idempotencyKey: `member-analysis-restore:${id}` },
        }),
      ).toBe(1);
      await db.user.update({ where: { id: userId }, data: { partnerId } });
    });
    it("discards provider output when consent is withdrawn while a request runs", async () => {
      const id = await enqueue();
      fetchMock.mockImplementationOnce(async () => {
        await db.healthProfile.update({
          where: { userId },
          data: { analysisConsentWithdrawn: new Date() },
        });
        return response();
      });
      await outbox.runOnce();
      const row = await db.memberHealthAnalysis.findUniqueOrThrow({
        where: { id },
      });
      expect(row.status).toBe("FAILED");
      expect(row.content).toBeNull();
      expect(
        await db.reportCreditLedger.count({
          where: { idempotencyKey: `member-analysis-restore:${id}` },
        }),
      ).toBe(1);
      await db.healthProfile.update({
        where: { userId },
        data: { analysisConsentWithdrawn: null },
      });
    });
    it("rejects a tier downgrade before provider invocation", async () => {
      const id = await enqueue();
      await db.partnerLevel.update({
        where: { id: levelId },
        data: { active: false },
      });
      await outbox.runOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        (await db.memberHealthAnalysis.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe("FAILED");
      await db.partnerLevel.update({
        where: { id: levelId },
        data: { active: true },
      });
    });
    it("retries temporary errors without extra debits and refunds after final failure", async () => {
      const id = await enqueue();
      fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
      for (let n = 0; n < 3; n++) {
        await db.outboxEvent.updateMany({
          where: { aggregateId: id },
          data: { nextAttemptAt: new Date(0) },
        });
        await outbox.runOnce();
      }
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(
        (await db.memberHealthAnalysis.findUniqueOrThrow({ where: { id } }))
          .status,
      ).toBe("FAILED");
      expect(
        await db.reportCreditLedger.count({
          where: { memberHealthAnalysisId: id, type: "CONSUME" },
        }),
      ).toBe(1);
      expect(
        await db.reportCreditLedger.count({
          where: { idempotencyKey: `member-analysis-restore:${id}` },
        }),
      ).toBe(1);
      expect(
        (await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: id } }))
          .status,
      ).toBe("DEAD_LETTER");
    });
  },
);
