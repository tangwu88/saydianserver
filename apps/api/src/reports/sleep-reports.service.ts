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
  SLEEP_REPORT_TEMPLATE,
} from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";
import {
  HealthReportsService,
  serializeReport,
} from "./health-reports.service";

@Injectable()
export class SleepReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthReports: HealthReportsService,
  ) {}

  async availability(userId: string) {
    const [profile, integration, setting] = await Promise.all([
      this.healthReports.profile(userId),
      this.prisma.integrationConfig.findUnique({ where: { key: "ai" } }),
      this.prisma.appSetting.findFirst({
        where: { key: "say_ring_app_display", public: true },
      }),
    ]);
    const enabled = safeObject(setting?.value).sleepAiEnabled === true;
    const provider = String(
      safeObject(integration?.publicConfig).provider ?? "disabled",
    );
    const available =
      enabled &&
      integration?.state === IntegrationState.CONFIGURED &&
      provider !== "disabled" &&
      healthReportWorkerEnabled(process.env) &&
      Boolean(profile.analysisConsent.document);
    return {
      available,
      reason: !enabled
        ? "睡眠 AI 分析暂未开启"
        : !available
          ? "睡眠 AI 分析服务或分析说明暂不可用"
          : null,
      analysisConsent: profile.analysisConsent,
    };
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
      throw new ForbiddenException("请先阅读并同意当前健康 AI 分析说明");
    const sourceHash = sha256(canonicalSleepInput(sleep));
    const inputDigest = sha256(
      `${userId}:${SLEEP_REPORT_TEMPLATE}:${sourceHash}`,
    );
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"health-report-create:" + userId}, 0))`;
        const [member, profile] = await Promise.all([
          tx.user.findUnique({
            where: { id: userId },
            select: { status: true },
          }),
          tx.healthProfile.findUnique({ where: { userId } }),
        ]);
        if (
          member?.status !== "ACTIVE" ||
          !profile?.analysisConsentedAt ||
          profile.analysisConsentWithdrawn ||
          profile.analysisConsentVersion !==
            availability.analysisConsent.availableVersion
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
