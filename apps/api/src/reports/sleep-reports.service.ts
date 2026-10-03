import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { IntegrationState, Prisma, ReportStatus } from "@prisma/client";
import {
  canonicalSleepInput,
  healthReportWorkerEnabled,
  normalizeSleepReportInput,
  SLEEP_ANALYSIS_NOTICE,
  sleepAiProviderMatchesNotice,
  SLEEP_REPORT_TEMPLATE,
} from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";
import { serializeReport } from "./health-reports.service";
import { readSleepAnalysisConsent } from "./sleep-analysis-consent";

@Injectable()
export class SleepReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async availability(userId: string) {
    const [analysisConsent, integration, setting] = await Promise.all([
      readSleepAnalysisConsent(this.prisma, userId),
      this.prisma.integrationConfig.findUnique({ where: { key: "ai" } }),
      this.prisma.appSetting.findFirst({
        where: { key: "say_ring_app_display", public: true },
      }),
    ]);
    const enabled = safeObject(setting?.value).sleepAiEnabled === true;
    const provider = String(
      safeObject(integration?.publicConfig).provider ?? "disabled",
    );
    const checks = {
      featureEnabled: enabled,
      providerReady:
        integration?.state === IntegrationState.CONFIGURED &&
        provider !== "disabled" &&
        sleepAiProviderMatchesNotice(
          safeObject(integration?.publicConfig).baseUrl,
        ),
      workerReady: healthReportWorkerEnabled(process.env),
      noticeReady: Boolean(analysisConsent.document),
    };
    const unavailableReasons = [
      !checks.featureEnabled && "sleep_ai_disabled",
      !checks.providerReady && "ai_provider_unconfigured",
      !checks.workerReady && "report_worker_paused",
      !checks.noticeReady && "sleep_analysis_notice_unavailable",
    ].filter((value): value is string => typeof value === "string");
    const reasons: Record<string, string> = {
      sleep_ai_disabled: "睡眠 AI 分析暂未开启",
      ai_provider_unconfigured: "睡眠 AI 服务尚未完成配置",
      report_worker_paused: "睡眠报告生成任务已暂停，请稍后重试",
      sleep_analysis_notice_unavailable:
        "Say Ring 睡眠 AI 分析说明尚未发布，请稍后重试",
    };
    return {
      available: unavailableReasons.length === 0,
      reason: unavailableReasons.length
        ? unavailableReasons.map((code) => reasons[code]).join("；")
        : null,
      unavailableReasons,
      checks,
      analysisConsent,
    };
  }

  async setAnalysisConsent(userId: string, input: unknown) {
    const body = safeObject(input);
    if (typeof body.granted !== "boolean")
      throw new BadRequestException("请明确是否同意睡眠 AI 分析");
    const granted = body.granted;
    const version = String(body.version ?? "").trim();
    if (granted && (!version || version.length > 80))
      throw new BadRequestException("请先阅读当前睡眠 AI 分析说明");
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const member = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });
      if (member?.status !== "ACTIVE")
        throw new ForbiddenException("账号状态已变更，请重新登录");
      const now = new Date();
      if (granted) {
        const current = await readSleepAnalysisConsent(tx, userId);
        if (!current.document)
          throw new ConflictException("Say Ring 睡眠 AI 分析说明尚未发布");
        if (current.availableVersion !== version)
          throw new ConflictException(
            "睡眠 AI 分析说明已更新，请重新阅读并确认",
          );
        await tx.consentRecord.upsert({
          where: {
            userId_documentType_version: {
              userId,
              documentType: SLEEP_ANALYSIS_NOTICE,
              version,
            },
          },
          create: {
            userId,
            documentType: SLEEP_ANALYSIS_NOTICE,
            version,
            acceptedAt: now,
            source: "say_ring_sleep_report",
          },
          update: {
            acceptedAt: now,
            withdrawnAt: null,
            source: "say_ring_sleep_report",
          },
        });
      } else {
        await tx.consentRecord.updateMany({
          where: {
            userId,
            documentType: SLEEP_ANALYSIS_NOTICE,
            withdrawnAt: null,
          },
          data: { withdrawnAt: now },
        });
      }
      return readSleepAnalysisConsent(tx, userId);
    });
  }

  async find(
    userId: string,
    sdkDate: string,
    sourceKey: string,
    sourceHash: string,
  ) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(sdkDate) ||
      !/^[a-f0-9]{64}$/.test(sourceKey) ||
      !/^[a-f0-9]{64}$/.test(sourceHash)
    )
      throw new BadRequestException("睡眠报告查询格式无效");
    const report = await this.prisma.healthReport.findFirst({
      where: {
        userId,
        templateVersion: SLEEP_REPORT_TEMPLATE,
        AND: [
          { freePreview: { path: ["sdkDate"], equals: sdkDate } },
          { freePreview: { path: ["sourceKey"], equals: sourceKey } },
          { freePreview: { path: ["sourceHash"], equals: sourceHash } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    return { report: report ? serializeReport(report) : null };
  }

  async create(userId: string, input: unknown) {
    let sleep;
    try {
      sleep = normalizeSleepReportInput(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "睡眠数据无效",
      );
    }
    const availability = await this.availability(userId);
    if (!availability.available)
      throw new ConflictException(availability.reason);
    if (!availability.analysisConsent.granted)
      throw new ForbiddenException(
        "请先阅读并同意当前 Say Ring 睡眠 AI 分析说明",
      );
    const sourceHash = sha256(canonicalSleepInput(sleep));
    const inputDigest = sha256(
      `${userId}:${SLEEP_REPORT_TEMPLATE}:${sourceHash}`,
    );
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"health-report-create:" + userId}, 0))`;
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        const [member, consent] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            select: { status: true },
          }),
          readSleepAnalysisConsent(tx, userId),
        ]);
        if (
          member?.status !== "ACTIVE" ||
          !consent.granted ||
          consent.version !== availability.analysisConsent.availableVersion
        )
          throw new ForbiddenException(
            "账号或健康分析授权已变更，请刷新后重试",
          );
        const previous = await tx.healthReport.findFirst({
          where: { userId, inputDigest, status: { not: ReportStatus.REVOKED } },
          orderBy: { createdAt: "desc" },
        });
        if (previous)
          return {
            ...serializeReport(previous),
            reused: true,
            needsPayment: false,
          };
        const start = new Date(`${sleep.sdkDate}T00:00:00${sleep.timezone}`);
        const evidenceId = `sleep-summary:${sourceHash}`;
        const { sourceKey: _privateKey, ...deidentifiedSleep } = sleep;
        const report = await tx.healthReport.create({
          data: {
            userId,
            status: ReportStatus.QUEUED,
            windowStart: start,
            windowEnd: new Date(start.getTime() + 86_400_000 - 1),
            distinctDays: 1,
            validRecordCount: 1,
            metricSummary: [
              { metric: "sleep", unit: "seconds", ...deidentifiedSleep },
            ] as unknown as Prisma.InputJsonValue,
            evidenceIndex: {
              byMetric: [{ metric: "sleep", recordIds: [evidenceId] }],
              dataQuality: {
                distinctDays: 1,
                validRecordCount: 1,
                source: "member_uploaded_wearable_summary",
                stageDetailsAvailable:
                  sleep.deepSeconds !== undefined &&
                  sleep.lightSeconds !== undefined &&
                  sleep.remSeconds !== undefined,
                timeCoverageAvailable: sleep.sessions.length > 0,
              },
            },
            inputDigest,
            templateVersion: SLEEP_REPORT_TEMPLATE,
            freePreview: {
              title: `${sleep.sdkDate} 睡眠分析报告`,
              summary: "AI 睡眠评分与分析建议正在生成",
              sdkDate: sleep.sdkDate,
              sourceKey: sleep.sourceKey,
              sourceHash,
              totalSeconds: sleep.totalSeconds,
              disclaimer:
                "AI评分并非设备评分或临床评估，仅供日常健康管理参考。",
            },
          },
        });
        await tx.outboxEvent.upsert({
          where: { eventId: `health-report-generate:${report.id}` },
          create: {
            eventId: `health-report-generate:${report.id}`,
            eventType: "health_report_generate",
            aggregateType: "health_report",
            aggregateId: report.id,
            payload: { userId, reportId: report.id },
          },
          update: {},
        });
        return {
          ...serializeReport(report),
          reused: false,
          needsPayment: false,
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }
}
