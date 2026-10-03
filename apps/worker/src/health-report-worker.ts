import {
  CreditLedgerType,
  IntegrationState,
  MembershipStatus,
  NotificationType,
  OutboxStatus,
  Prisma,
  PrismaClient,
  ReportStatus,
  UserStatus,
} from "@prisma/client";
import {
  markWorkerIntegrationVerified,
  resolveWorkerSecrets,
} from "./integration-secrets";
import {
  SLEEP_ANALYSIS_NOTICE,
  SLEEP_REPORT_TEMPLATE,
  sleepAiProviderMatchesNotice,
} from "@saydian/app-contracts";

export class PermanentTaskError extends Error {}

export class SleepProviderError extends Error {
  constructor(
    readonly code:
      | "timeout"
      | "provider_rejected"
      | "provider_busy"
      | "truncated"
      | "invalid_content"
      | "network",
    readonly retryable = true,
  ) {
    super(`sleep_ai:${code}`);
  }
}

export function reportRetryPolicy(
  template: string | undefined,
  attempts: number,
) {
  return template === SLEEP_REPORT_TEMPLATE
    ? {
        maximumAttempts: 3,
        delayMs: Math.min(Math.max(attempts, 1) * 15_000, 30_000),
      }
    : {
        maximumAttempts: 10,
        delayMs: Math.min(2 ** attempts * 30_000, 6 * 3600_000),
      };
}

export class HealthReportWorker {
  constructor(private readonly prisma: PrismaClient) {}

  async retryPolicy(reportId: string, attempts: number) {
    const report = await this.prisma.healthReport.findUnique({
      where: { id: reportId },
      select: { templateVersion: true },
    });
    return reportRetryPolicy(report?.templateVersion, attempts);
  }

  async markWaitingForRetry(reportId: string, error: unknown): Promise<void> {
    await this.prisma.healthReport.updateMany({
      where: {
        id: reportId,
        templateVersion: SLEEP_REPORT_TEMPLATE,
        status: { in: [ReportStatus.QUEUED, ReportStatus.GENERATING] },
      },
      data: {
        status: ReportStatus.QUEUED,
        failureReason: sleepFailureReason(error),
      },
    });
  }

  /** Recover only already queued timeout jobs; generate still rechecks current consent. */
  async recoverTimedOutSleepReports(): Promise<void> {
    const dueBy = new Date(Date.now() + 15_000);
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        eventType: "health_report_generate",
        status: OutboxStatus.PENDING,
        nextAttemptAt: { gt: dueBy },
        OR: [
          { lastError: { contains: "timeout", mode: "insensitive" } },
          { lastError: { contains: "timed out", mode: "insensitive" } },
        ],
      },
      select: { id: true, aggregateId: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    for (const event of events) {
      await this.prisma.$transaction(async (tx) => {
        const report = await tx.healthReport.findUnique({
          where: { id: event.aggregateId },
          select: { templateVersion: true, status: true },
        });
        if (
          report?.templateVersion !== SLEEP_REPORT_TEMPLATE ||
          (report.status !== ReportStatus.QUEUED &&
            report.status !== ReportStatus.GENERATING)
        )
          return;
        const claimed = await tx.outboxEvent.updateMany({
          where: {
            id: event.id,
            aggregateId: event.aggregateId,
            eventType: "health_report_generate",
            status: OutboxStatus.PENDING,
            nextAttemptAt: { gt: dueBy },
          },
          data: { nextAttemptAt: dueBy },
        });
        if (claimed.count !== 1) return;
        await tx.healthReport.updateMany({
          where: {
            id: event.aggregateId,
            templateVersion: SLEEP_REPORT_TEMPLATE,
            status: { in: [ReportStatus.QUEUED, ReportStatus.GENERATING] },
          },
          data: {
            status: ReportStatus.QUEUED,
            failureReason: "sleep_ai:timeout",
          },
        });
      });
    }
  }

  async generate(reportId: string): Promise<void> {
    const report = await this.prisma.healthReport.findUnique({
      where: { id: reportId },
    });
    if (!report || report.status === ReportStatus.REVOKED) return;
    if (report.status === ReportStatus.READY && report.fullContent) return;
    if (
      report.status !== ReportStatus.QUEUED &&
      report.status !== ReportStatus.GENERATING
    )
      return;
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "ai" },
    });
    const publicConfig = asObject(integration?.publicConfig);
    const provider = String(
      publicConfig.provider ?? env("AI_PROVIDER", "disabled"),
    ).trim();
    if (
      integration?.state !== IntegrationState.CONFIGURED ||
      provider === "disabled"
    ) {
      throw new PermanentTaskError("AI report provider is unconfigured");
    }
    const secrets = await resolveWorkerSecrets(this.prisma, "ai", {
      apiKey: "AI_API_KEY",
      baseUrl: "AI_BASE_URL",
      model: "AI_MODEL",
    });
    const providerSettings = {
      baseUrl: String(publicConfig.baseUrl ?? secrets.baseUrl ?? "").replace(
        /\/$/,
        "",
      ),
      apiKey: secrets.apiKey ?? "",
      model: String(publicConfig.model ?? secrets.model ?? "configured-model"),
    };
    if (!providerSettings.baseUrl || !providerSettings.apiKey) {
      throw new PermanentTaskError("AI report provider is unconfigured");
    }
    // A queued task is not permission to keep using data after consent changes.
    // SUPER_ADMIN requests persist a separate audited authorization snapshot;
    // the worker still rejects inactive members and any changed snapshot.
    const adminConsentBypass = report.adminConsentBypass === true;
    const sleepReport = report.templateVersion === SLEEP_REPORT_TEMPLATE;
    if (
      sleepReport &&
      !sleepAiProviderMatchesNotice(providerSettings.baseUrl)
    ) {
      throw new PermanentTaskError(
        "Sleep AI provider does not match the published analysis notice",
      );
    }
    if (sleepReport) await assertSleepReportEnabled(this.prisma);
    const consent = await assertGlobalAnalysisAllowed(
      this.prisma,
      report.userId,
      adminConsentBypass,
      sleepReport,
    );
    const startData = {
      status: ReportStatus.GENERATING,
      generationAttempts: { increment: 1 },
      failureReason: null,
    };
    {
      const started = await this.prisma.healthReport.updateMany({
        where: {
          id: report.id,
          adminConsentBypass,
          status: { in: [ReportStatus.QUEUED, ReportStatus.GENERATING] },
        },
        data: startData,
      });
      if (started.count !== 1) return;
      if (
        (await assertGlobalAnalysisAllowed(
          this.prisma,
          report.userId,
          adminConsentBypass,
          sleepReport,
        )) !== consent
      ) {
        throw new PermanentTaskError(
          "Health AI analysis authorization changed before generation",
        );
      }
    }
    if (sleepReport) await assertSleepReportEnabled(this.prisma);
    const content = await callAiProvider(
      report.metricSummary,
      report.evidenceIndex,
      {
        from: report.windowStart.toISOString(),
        to: report.windowEnd.toISOString(),
        distinctDays: report.distinctDays,
        validRecordCount: report.validRecordCount,
      },
      providerSettings,
      sleepReport,
    );
    await markWorkerIntegrationVerified(this.prisma, "ai");
    const eventId = `health-report-ready:${report.id}`;
    await this.prisma.$transaction(async (tx) => {
      {
        await lockGlobalReport(tx, report.userId, report.id, sleepReport);
        const current = await tx.healthReport.findUnique({
          where: { id: report.id },
        });
        if (!current || current.status !== ReportStatus.GENERATING) return;
        if (sleepReport) await assertSleepReportEnabled(tx);
        // Keep the authorization rows locked until READY and its notification commit.
        if (
          current.adminConsentBypass !== adminConsentBypass ||
          (await assertGlobalAnalysisAllowed(
            tx,
            report.userId,
            adminConsentBypass,
            sleepReport,
          )) !== consent
        ) {
          throw new PermanentTaskError(
            "Health AI analysis authorization changed during generation",
          );
        }
      }
      await tx.healthReport.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.READY,
          fullContent: content as Prisma.InputJsonValue,
          aiGenerated: true,
          aiProvider: provider,
          aiModel: providerSettings.model,
          aiLabelVersion: "ai-content-label-v1",
          generatedAt: new Date(),
          failureReason: null,
        },
      });
      const notification = await tx.notification.upsert({
        where: { userId_eventId: { userId: report.userId, eventId } },
        create: {
          userId: report.userId,
          eventId,
          type: NotificationType.SYSTEM,
          title:
            report.templateVersion === SLEEP_REPORT_TEMPLATE
              ? "睡眠报告已生成"
              : "健康报告已生成",
          body: "你的健康管理参考报告已准备好，点击即可查看。",
          deepLink: `/health/reports/${report.id}`,
          metadata: { reportId: report.id },
        },
        update: { readAt: null },
      });
      await tx.outboxEvent.upsert({
        where: { eventId },
        create: {
          eventId,
          eventType: "health_report_ready",
          aggregateType: "health_report",
          aggregateId: report.id,
          payload: {
            userId: report.userId,
            reportId: report.id,
            notificationId: notification.id,
            deepLink: `/health/reports/${report.id}`,
          },
        },
        update: {},
      });
    });
  }

  async failPermanently(reportId: string, error: unknown): Promise<void> {
    const report = await this.prisma.healthReport.findUnique({
      where: { id: reportId },
    });
    if (
      !report ||
      report.status === ReportStatus.READY ||
      report.status === ReportStatus.REVOKED
    ) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      {
        await lockGlobalReport(tx, report.userId, report.id);
        const current = await tx.healthReport.findUnique({
          where: { id: report.id },
        });
        if (
          !current ||
          current.status === ReportStatus.READY ||
          current.status === ReportStatus.REVOKED
        )
          return;
      }
      const restoreKey = `report-restore:${report.id}`;
      const restored = await tx.reportCreditLedger.findUnique({
        where: { idempotencyKey: restoreKey },
      });
      if (!restored) {
        const consumed = await tx.reportCreditLedger.findUnique({
          where: { idempotencyKey: `report-consume:${report.id}` },
        });
        if (consumed) {
          const now = new Date();
          const membership = consumed.membershipId
            ? await tx.healthMembership.findUnique({
                where: { id: consumed.membershipId },
              })
            : null;
          const canRestoreMembership = Boolean(
            membership &&
            membership.status === MembershipStatus.ACTIVE &&
            membership.expiresAt &&
            membership.expiresAt > now,
          );
          if (canRestoreMembership && membership) {
            await tx.healthMembership.update({
              where: { id: membership.id },
              data: { remainingCredits: { increment: 1 } },
            });
          }
          const current = await tx.reportCreditLedger.aggregate({
            where: { userId: report.userId, membershipId: null },
            _sum: { delta: true },
          });
          await tx.reportCreditLedger.create({
            data: {
              userId: report.userId,
              type: CreditLedgerType.ADMIN_ADJUSTMENT,
              delta: 1,
              balanceAfter: Math.max(0, current._sum.delta ?? 0) + 1,
              sourceType: "generation_failure",
              sourceId: report.id,
              membershipId: canRestoreMembership
                ? (membership?.id ?? null)
                : null,
              healthReportId: report.id,
              expiresAt: canRestoreMembership
                ? (membership?.expiresAt ?? null)
                : null,
              idempotencyKey: restoreKey,
              note: "报告持续生成失败，次数已退回",
            },
          });
        }
      }
      await tx.healthReport.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.FAILED,
          failureReason:
            report.templateVersion === SLEEP_REPORT_TEMPLATE
              ? sleepFailureReason(error)
              : sanitizeError(error),
        },
      });
    });
  }
}

async function assertSleepReportEnabled(
  prisma: PrismaClient | Prisma.TransactionClient,
) {
  const setting = await prisma.appSetting.findFirst({
    where: { key: "say_ring_app_display", public: true },
  });
  if (asObject(setting?.value).sleepAiEnabled !== true)
    throw new PermanentTaskError("Sleep AI reports have been disabled");
}

async function lockGlobalReport(
  tx: Prisma.TransactionClient,
  userId: string,
  reportId: string,
  sleep = false,
): Promise<void> {
  // Always acquire member before profile and report. No lock spans AI I/O.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  if (sleep) {
    await tx.$queryRaw`SELECT "id" FROM "ConsentRecord" WHERE "userId" = ${userId}::uuid AND "documentType" = ${SLEEP_ANALYSIS_NOTICE} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "HealthProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  }
  await tx.$queryRaw`SELECT "id" FROM "HealthReport" WHERE "id" = ${reportId}::uuid FOR UPDATE`;
}

async function assertGlobalAnalysisAllowed(
  prisma: Pick<
    Prisma.TransactionClient,
    "user" | "healthProfile" | "globalLegalDocument" | "consentRecord"
  >,
  userId: string,
  adminConsentBypass = false,
  sleep = false,
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, locale: true },
  });
  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new PermanentTaskError("Health report member is inactive");
  }
  if (sleep && adminConsentBypass)
    throw new PermanentTaskError(
      "Sleep reports require the member's product-scoped consent",
    );
  if (adminConsentBypass) return "super-admin-audited-bypass-v1";
  const record = sleep
    ? await prisma.consentRecord.findFirst({
        where: { userId, documentType: SLEEP_ANALYSIS_NOTICE },
        orderBy: { acceptedAt: "desc" },
      })
    : null;
  const profile = sleep
    ? record && {
        analysisConsentedAt: record.acceptedAt,
        analysisConsentWithdrawn: record.withdrawnAt,
        analysisConsentVersion: record.version,
      }
    : await prisma.healthProfile.findUnique({ where: { userId } });
  if (!profile?.analysisConsentedAt || profile.analysisConsentWithdrawn) {
    throw new PermanentTaskError(
      "Health AI analysis consent is missing or withdrawn",
    );
  }
  // Same language normalization and English fallback as the API's globalLegalReference.
  const raw = String(user.locale ?? "en")
    .split(",")[0]!
    .split(";")[0]!
    .trim()
    .replace(/_/g, "-");
  const supported = ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"];
  const preferred = /^zh-(TW|HK|MO|Hant)(-|$)/i.test(raw)
    ? "zh-Hant"
    : /^zh(-|$)/i.test(raw)
      ? "zh-Hans"
      : (supported.find(
          (locale) => locale.toLowerCase() === raw.toLowerCase(),
        ) ??
        supported.find(
          (locale) => locale === raw.split("-")[0]?.toLowerCase(),
        ) ??
        "en");
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const documents = await prisma.globalLegalDocument.findMany({
    where: {
      documentType: sleep ? SLEEP_ANALYSIS_NOTICE : "health_ai_analysis",
      locale: { in: locales },
      active: true,
      reviewed: true,
      publishedAt: { lte: new Date() },
    },
    orderBy: { publishedAt: "desc" },
  });
  const current = locales
    .map((locale) =>
      documents.find(
        (document) => document.locale === locale && document.contentHtml.trim(),
      ),
    )
    .find(Boolean);
  if (!current || current.version !== profile.analysisConsentVersion) {
    throw new PermanentTaskError(
      "Health AI analysis consent is outdated or notice is unavailable",
    );
  }
  return `${current.version}:${profile.analysisConsentedAt.toISOString()}`;
}

type SleepContentFailureCategory =
  | "provider_response"
  | "response_json"
  | "empty_message"
  | "content_json"
  | "unavailable_metric"
  | "missing_evidence"
  | "content_shape"
  | "sleep_score_shape"
  | "wellness_policy"
  | "validation_unknown";

const sleepContentFailureCategories: ReadonlyMap<
  string,
  SleepContentFailureCategory
> = new Map([
  ["AI report trend references an unavailable metric", "unavailable_metric"],
  ["AI report trend is missing evidence records", "missing_evidence"],
  ["AI report content is incomplete", "content_shape"],
  ["AI sleep score is invalid or incomplete", "sleep_score_shape"],
  ["AI sleep score violates wellness-only policy", "wellness_policy"],
  ["AI report content violates wellness-only policy", "wellness_policy"],
]);

export async function callAiProvider(
  metricSummary: unknown,
  evidenceIndex: unknown,
  period: {
    from: string;
    to: string;
    distinctDays: number;
    validRecordCount: number;
  },
  settings: { baseUrl: string; apiKey: string; model: string },
  sleep = false,
) {
  const evidence = asObject(evidenceIndex);
  let failureStage: SleepContentFailureCategory = "provider_response";
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        ...(sleep && /^glm-5\.3(?:-flashx?)?$/i.test(settings.model.trim())
          ? { reasoning_effort: "low", max_tokens: 4096 }
          : {}),
        messages: [
          {
            role: "system",
            content: sleep
              ? "你是 Say Ring 睡眠管理参考助手。输入仅是单日戒指睡眠汇总和夜睡/小睡会话起止；所有时长单位为秒，timezone 是记录时区。清醒、未知、未佩戴和缺口不计入有效睡眠；缺失字段保持未知，设备评分与AI评分不同。输出 JSON：overview 为详细概览；trends 为数组，每项只有 metric 和 text，metric 固定 sleep，分别结合实际数据说明睡眠时长、阶段结构、清醒/连续性、作息时间和小睡（未提供则明确无法分析）。suggestions 和 limitations 为字符串数组。sleepScore 为 {value:0到100的整数或null,scale:100,confidence:low或moderate,explanation:评分依据及限制}。评分仅是基于本次记录的AI综合参考，不是临床验证量表，不把设备阶段当诊断。证据不足时 value 必须 null，并解释缺项；单日不能声称长期改善、疾病或睡眠效率，不能推算缺失阶段、入睡潜伏期、觉醒次数或用户年龄。建议具体、低风险、可执行；保留单日、佩戴、设备估计误差和AI局限。不得诊断、处方、治疗或药物/补充剂剂量，不输出准确性承诺，不猜个人身份。"
              : "你是赛电健康报告表达助手。输入是去标识化的会员基础资料、活动目标、设备概况、预警汇总和近30天多指标统计。请先检查数据量、单位、时间覆盖和异常值，再做谨慎的趋势说明。输出JSON对象：overview为字符串；trends为对象数组，每项只能包含metric和text，metric必须逐字使用输入中的已有metric；suggestions和limitations为字符串数组。建议应具体、低风险、日常可执行，并结合年龄、性别、身高体重、目标和实际趋势；资料缺失或样本稀疏时明确说未获取或证据不足。不得诊断、不得给出处方/治疗方案/药物或补充剂剂量、不得承诺准确性、不得补造未提供的指标或因果关系。必须注明这是AI生成的健康管理参考，并建议明显不适或持续异常及时就医。不要生成或猜测姓名、联系方式、账号、设备硬件标识或记录编号。",
          },
          {
            role: "user",
            content: JSON.stringify({
              period,
              memberContext: asObject(evidence.memberContext),
              dataQuality: asObject(evidence.dataQuality),
              metrics: metricSummary,
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(sleep ? 120_000 : 60_000),
    });
    if (!response.ok) {
      if (sleep)
        throw new SleepProviderError(
          response.status === 429 || response.status >= 500
            ? "provider_busy"
            : "provider_rejected",
          response.status === 429 || response.status >= 500,
        );
      throw new Error(`AI report provider returned ${response.status}`);
    }
    failureStage = "response_json";
    const payload = asObject(await response.json());
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    if (sleep && asObject(choices[0]).finish_reason === "length")
      throw new SleepProviderError("truncated");
    const message = asObject(asObject(choices[0]).message);
    const raw = String(message.content ?? "").trim();
    failureStage = "empty_message";
    if (!raw) throw new Error("AI report provider returned empty content");
    let parsed: unknown;
    failureStage = "content_json";
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI report provider returned invalid JSON");
    }
    failureStage = "validation_unknown";
    return sleep
      ? validateSleepReportContent(parsed, metricSummary, evidenceIndex)
      : validateReportContent(parsed, metricSummary, evidenceIndex);
  } catch (error) {
    if (!sleep || error instanceof SleepProviderError) throw error;
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    )
      throw new SleepProviderError("timeout");
    if (error instanceof TypeError) throw new SleepProviderError("network");
    // Only fixed categories leave this catch; never log provider data or errors.
    const category =
      error instanceof Error && failureStage === "validation_unknown"
        ? (sleepContentFailureCategories.get(error.message) ?? failureStage)
        : failureStage;
    console.warn("sleep_ai_content_rejected", category);
    throw new SleepProviderError("invalid_content");
  }
}

function sleepFailureReason(error: unknown): string {
  if (error instanceof SleepProviderError) return error.message;
  return "sleep_ai:unavailable";
}

export function validateSleepReportContent(
  value: unknown,
  metricSummary: unknown,
  evidenceIndex: unknown,
): Record<string, unknown> {
  const content = validateReportContent(value, metricSummary, evidenceIndex);
  const score = asObject(asObject(value).sleepScore);
  const explanation = plainText(score.explanation, 1500);
  if (
    score.scale !== 100 ||
    !["low", "moderate"].includes(String(score.confidence)) ||
    !explanation ||
    (score.value !== null &&
      (typeof score.value !== "number" ||
        !Number.isInteger(score.value) ||
        score.value < 0 ||
        score.value > 100))
  )
    throw new Error("AI sleep score is invalid or incomplete");
  if (/确诊|处方|治愈|100%准确|医疗级|替代医生/.test(explanation))
    throw new Error("AI sleep score violates wellness-only policy");
  return {
    ...content,
    aiLabel: "AI生成的睡眠管理参考",
    sleepScore: {
      value: score.value,
      scale: 100,
      confidence: score.confidence,
      explanation,
    },
    safetyNotice:
      "AI评分非设备评分、非临床评估；本报告不用于诊断或治疗。如有明显不适或持续睡眠困扰，请咨询专业医务人员。",
  };
}

export function validateReportContent(
  value: unknown,
  metricSummary: unknown,
  evidenceIndex: unknown,
): Record<string, unknown> {
  const input = asObject(value);
  const overview = plainText(input.overview, 2_000);
  const metricNames = new Set(
    (Array.isArray(metricSummary) ? metricSummary : [])
      .map((item) => plainText(asObject(item).metric, 80))
      .filter(Boolean),
  );
  const evidenceByMetric = new Map<string, string[]>();
  const evidenceRows = asObject(evidenceIndex).byMetric;
  for (const item of Array.isArray(evidenceRows) ? evidenceRows : []) {
    const row = asObject(item);
    const metric = plainText(row.metric, 80);
    const recordIds = Array.isArray(row.recordIds)
      ? row.recordIds
          .map((id) => plainText(id, 160))
          .filter(Boolean)
          .slice(0, 20_000)
      : [];
    if (metric && recordIds.length) evidenceByMetric.set(metric, recordIds);
  }
  const trends = (Array.isArray(input.trends) ? input.trends : [])
    .slice(0, 20)
    .map((item) => {
      const row = asObject(item);
      const metric = plainText(row.metric, 80);
      const text = plainText(row.text, 500);
      if (!metric || !text || !metricNames.has(metric)) {
        throw new Error("AI report trend references an unavailable metric");
      }
      const evidenceRecordIds = evidenceByMetric.get(metric) ?? [];
      if (!evidenceRecordIds.length) {
        throw new Error("AI report trend is missing evidence records");
      }
      return { metric, text, evidenceRecordIds };
    });
  const suggestions = stringArray(input.suggestions, 20, 500);
  const limitations = stringArray(input.limitations, 20, 500);
  if (!overview || !trends.length || !limitations.length) {
    throw new Error("AI report content is incomplete");
  }
  const combined = [
    overview,
    ...trends.map((trend) => trend.text),
    ...suggestions,
    ...limitations,
  ].join(" ");
  if (/确诊|处方|治愈|100%准确|医疗级|替代医生/.test(combined)) {
    throw new Error("AI report content violates wellness-only policy");
  }
  return {
    aiLabel: "AI生成的健康管理参考",
    overview,
    trends,
    suggestions,
    limitations,
    safetyNotice: "本报告不用于诊断或治疗；如有明显不适，请及时就医。",
  };
}

function stringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximumItems)
    .map((item) => plainText(item, maximumLength))
    .filter(Boolean);
}

function plainText(value: unknown, maximumLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function sanitizeError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "report generation failed";
  return message.replace(/[\r\n]/g, " ").slice(0, 500);
}
