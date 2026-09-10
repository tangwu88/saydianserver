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

export class PermanentTaskError extends Error {}

export class HealthReportWorker {
  constructor(private readonly prisma: PrismaClient) {}

  async generate(reportId: string): Promise<void> {
    const report = await this.prisma.healthReport.findUnique({
      where: { id: reportId },
    });
    if (!report || report.status === ReportStatus.REVOKED) return;
    if (report.status === ReportStatus.READY && report.fullContent) return;
    if (isGlobalRealm() && report.status !== ReportStatus.QUEUED && report.status !== ReportStatus.GENERATING) return;
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { key: "ai" },
    });
    const publicConfig = asObject(integration?.publicConfig);
    const provider = String(
      publicConfig.provider ?? env("AI_PROVIDER", "disabled"),
    ).trim();
    if (integration?.state !== IntegrationState.CONFIGURED || provider === "disabled") {
      throw new PermanentTaskError("AI report provider is unconfigured");
    }
    const secrets = await resolveWorkerSecrets(this.prisma, "ai", {
      apiKey: "AI_API_KEY",
      baseUrl: "AI_BASE_URL",
      model: "AI_MODEL",
    });
    const providerSettings = {
      baseUrl: String(publicConfig.baseUrl ?? secrets.baseUrl ?? "").replace(/\/$/, ""),
      apiKey: secrets.apiKey ?? "",
      model: String(publicConfig.model ?? secrets.model ?? "configured-model"),
    };
    if (!providerSettings.baseUrl || !providerSettings.apiKey) {
      throw new PermanentTaskError("AI report provider is unconfigured");
    }
    // A queued task is not permission to keep using data after consent changes.
    const consent = isGlobalRealm() ? await assertGlobalAnalysisAllowed(this.prisma, report.userId) : null;
    const startData = {
      status: ReportStatus.GENERATING,
      generationAttempts: { increment: 1 },
      failureReason: null,
    };
    if (isGlobalRealm()) {
      const started = await this.prisma.healthReport.updateMany({
        where: { id: report.id, status: { in: [ReportStatus.QUEUED, ReportStatus.GENERATING] } }, data: startData,
      });
      if (started.count !== 1) return;
      if (await assertGlobalAnalysisAllowed(this.prisma, report.userId) !== consent) {
        throw new PermanentTaskError("Health AI analysis consent changed before generation");
      }
    } else {
      await this.prisma.healthReport.update({ where: { id: report.id }, data: startData });
    }
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
    );
    await markWorkerIntegrationVerified(this.prisma, "ai");
    const eventId = `health-report-ready:${report.id}`;
    await this.prisma.$transaction(async (tx) => {
      if (isGlobalRealm()) {
        await lockGlobalReport(tx, report.userId, report.id);
        const current = await tx.healthReport.findUnique({ where: { id: report.id } });
        if (!current || current.status !== ReportStatus.GENERATING) return;
        // Keep the consent row locked until READY and its notification commit.
        if (await assertGlobalAnalysisAllowed(tx, report.userId) !== consent) {
          throw new PermanentTaskError("Health AI analysis consent changed during generation");
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
          title: "健康报告已生成",
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
    if (!report || report.status === ReportStatus.READY || report.status === ReportStatus.REVOKED) {
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      if (isGlobalRealm()) {
        await lockGlobalReport(tx, report.userId, report.id);
        const current = await tx.healthReport.findUnique({ where: { id: report.id } });
        if (!current || current.status === ReportStatus.READY || current.status === ReportStatus.REVOKED) return;
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
              membershipId: canRestoreMembership ? membership?.id ?? null : null,
              healthReportId: report.id,
              expiresAt: canRestoreMembership
                ? membership?.expiresAt ?? null
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
          failureReason: sanitizeError(error),
        },
      });
    });
  }
}

function isGlobalRealm(): boolean {
  return process.env.APP_REALM === "global";
}

async function lockGlobalReport(tx: Prisma.TransactionClient, userId: string, reportId: string): Promise<void> {
  // Always acquire member before profile and report. No lock spans AI I/O.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "HealthProfile" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "HealthReport" WHERE "id" = ${reportId}::uuid FOR UPDATE`;
}

async function assertGlobalAnalysisAllowed(
  prisma: Pick<Prisma.TransactionClient, "user" | "healthProfile" | "globalLegalDocument">,
  userId: string,
): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, locale: true } });
  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new PermanentTaskError("Health report member is inactive");
  }
  const profile = await prisma.healthProfile.findUnique({ where: { userId } });
  if (!profile?.analysisConsentedAt || profile.analysisConsentWithdrawn) {
    throw new PermanentTaskError("Health AI analysis consent is missing or withdrawn");
  }
  // Same language normalization and English fallback as the API's globalLegalReference.
  const raw = String(user.locale ?? "en").split(",")[0]!.split(";")[0]!.trim().replace(/_/g, "-");
  const supported = ["en", "zh-Hans", "zh-Hant", "de", "fr", "es", "ja", "ko"];
  const preferred = /^zh-(TW|HK|MO|Hant)(-|$)/i.test(raw) ? "zh-Hant"
    : /^zh(-|$)/i.test(raw) ? "zh-Hans"
      : supported.find(locale => locale.toLowerCase() === raw.toLowerCase())
        ?? supported.find(locale => locale === raw.split("-")[0]?.toLowerCase()) ?? "en";
  const locales = preferred === "en" ? ["en"] : [preferred, "en"];
  const documents = await prisma.globalLegalDocument.findMany({
    where: { documentType: "health_ai_analysis", locale: { in: locales }, active: true, reviewed: true, publishedAt: { lte: new Date() } },
    orderBy: { publishedAt: "desc" },
  });
  const current = locales.map(locale => documents.find(document => document.locale === locale && document.contentHtml.trim())).find(Boolean);
  if (!current || current.version !== profile.analysisConsentVersion) {
    throw new PermanentTaskError("Health AI analysis consent is outdated or notice is unavailable");
  }
  return `${current.version}:${profile.analysisConsentedAt.toISOString()}`;
}

async function callAiProvider(
  metricSummary: unknown,
  evidenceIndex: unknown,
  period: {
    from: string;
    to: string;
    distinctDays: number;
    validRecordCount: number;
  },
  settings: { baseUrl: string; apiKey: string; model: string },
) {
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
      messages: [
        {
          role: "system",
          content:
            "你是赛电健康报告表达助手。输入只有去标识化的统计摘要。输出JSON对象：overview为字符串；trends为对象数组，每项只能包含metric和text，metric必须逐字使用输入中的已有metric；suggestions和limitations为字符串数组。不得诊断、不得给出处方或治疗建议、不得承诺准确性、不得补造未提供的指标。数据不足时明确说未获取。必须注明这是AI生成的健康管理参考，并建议明显不适及时就医。不要生成或猜测记录编号。",
        },
        {
          role: "user",
          content: JSON.stringify({ period, metrics: metricSummary }),
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI report provider returned ${response.status}`);
  const payload = asObject(await response.json());
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = asObject(asObject(choices[0]).message);
  const raw = String(message.content ?? "").trim();
  if (!raw) throw new Error("AI report provider returned empty content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI report provider returned invalid JSON");
  }
  return validateReportContent(parsed, metricSummary, evidenceIndex);
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

function stringArray(value: unknown, maximumItems: number, maximumLength: number) {
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
  const message = error instanceof Error ? error.message : "report generation failed";
  return message.replace(/[\r\n]/g, " ").slice(0, 500);
}
