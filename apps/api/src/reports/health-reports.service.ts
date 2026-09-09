import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  CreditLedgerType,
  DataQuality,
  MembershipStatus,
  OutboxStatus,
  Prisma,
  ReportStatus as PrismaReportStatus,
} from "@prisma/client";
import type {
  HealthProfileContract,
  HealthReportContract,
  HealthReportEligibilityContract,
} from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { isGlobalRealm } from "../common/deployment-realm";
import { globalError } from "../auth/global-identity";
import { globalLegalReference } from "../auth/global-legal";
import {
  buildHealthEvidence,
  type EvidenceRecord,
  type HealthEvidence,
} from "../health/health-evidence";

const REPORT_WINDOW_DAYS = 30;
const MINIMUM_DISTINCT_DAYS = 3;
const REPORT_TEMPLATE_VERSION = "wellness-report-v1";
const ANALYSIS_CONSENT_TYPE = "health_ai_analysis";

@Injectable()
export class HealthReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(userId: string): Promise<HealthProfileContract> {
    const period = reportPeriod();
    const [profile, records, devices, warningCount] = await Promise.all([
      this.prisma.healthProfile.findUnique({ where: { userId } }),
      this.loadEvidenceRecords(userId, period.from, period.to),
      this.prisma.deviceBinding.findMany({
        where: { userId, unboundAt: null },
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          model: true,
          displayName: true,
          firmware: true,
          lastSeenAt: true,
        },
      }),
      this.prisma.healthWarningEvent.count({
        where: { userId, observedAt: { gte: period.from, lte: period.to } },
      }),
    ]);
    const evidence = buildHealthEvidence(records);
    const analysisDocument = isGlobalRealm() ? await this.analysisDocument(userId) : null;
    return {
      memberId: userId,
      period: isoPeriod(period),
      dataCompleteness: {
        validRecordCount: evidence.validRecordIds.length,
        distinctDays: evidence.distinctDays,
        metricCount: evidence.metrics.length,
      },
      metrics: evidence.metrics.map((metric) => ({
        metric: metric.metric,
        recordCount: metric.recordCount,
        latestObservedAt: metric.latestObservedAt,
        latestValue: metric.latestValue,
      })),
      devices: devices.map((device) => ({
        id: device.id,
        model: device.model,
        displayName: device.displayName,
        ...(device.firmware ? { firmware: device.firmware } : {}),
        ...(device.lastSeenAt
          ? { lastSeenAt: device.lastSeenAt.toISOString() }
          : {}),
      })),
      activeWarningCount: warningCount,
      analysisConsent: {
        ...(isGlobalRealm() ? { availableVersion: analysisDocument?.version ?? null, document: analysisDocument } : {}),
        granted: Boolean(
          profile?.analysisConsentedAt && !profile.analysisConsentWithdrawn && (!isGlobalRealm() || (analysisDocument && analysisDocument.version === profile.analysisConsentVersion)),
        ),
        version: profile?.analysisConsentVersion ?? null,
        grantedAt: profile?.analysisConsentedAt?.toISOString() ?? null,
        withdrawnAt:
          profile?.analysisConsentWithdrawn?.toISOString() ?? null,
      },
    };
  }

  async setAnalysisConsent(userId: string, input: unknown) {
    const body = safeObject(input);
    const granted = body.granted === true;
    const version = String(body.version ?? "").trim();
    if (granted && (!version || version.length > 80)) {
      throw new BadRequestException("请先阅读并同意健康分析说明");
    }
    if (isGlobalRealm() && granted) {
      const document = await this.analysisDocument(userId, body.locale);
      if (!document) throw globalError(503, "analysis_consent_unavailable", "The health analysis notice is not available yet.");
      if (document.version !== version) throw globalError(409, "consent_outdated", "Read and agree to the latest health analysis notice.");
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      if (granted) {
        await tx.consentRecord.upsert({
          where: {
            userId_documentType_version: {
              userId,
              documentType: ANALYSIS_CONSENT_TYPE,
              version,
            },
          },
          create: {
            userId,
            documentType: ANALYSIS_CONSENT_TYPE,
            version,
            source: "app_health_report",
          },
          update: { withdrawnAt: null, source: "app_health_report" },
        });
      } else {
        await tx.consentRecord.updateMany({
          where: {
            userId,
            documentType: ANALYSIS_CONSENT_TYPE,
            withdrawnAt: null,
          },
          data: { withdrawnAt: now },
        });
      }
      const profile = await tx.healthProfile.upsert({
        where: { userId },
        create: {
          userId,
          analysisConsentVersion: granted ? version : null,
          analysisConsentedAt: granted ? now : null,
          analysisConsentWithdrawn: granted ? null : now,
        },
        update: granted
          ? {
              analysisConsentVersion: version,
              analysisConsentedAt: now,
              analysisConsentWithdrawn: null,
            }
          : { analysisConsentWithdrawn: now },
      });
      return {
        granted,
        version: granted ? profile.analysisConsentVersion : null,
        grantedAt: granted
          ? profile.analysisConsentedAt?.toISOString() ?? null
          : null,
        withdrawnAt: granted
          ? null
          : profile.analysisConsentWithdrawn?.toISOString() ?? null,
      };
    });
  }

  private async analysisDocument(userId: string, localeInput?: unknown) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
    return globalLegalReference(this.prisma, ANALYSIS_CONSENT_TYPE, localeInput ?? user?.locale);
  }

  async eligibility(userId: string): Promise<HealthReportEligibilityContract> {
    const period = reportPeriod();
    const [records, profile, credits] = await Promise.all([
      this.loadEvidenceRecords(userId, period.from, period.to),
      this.prisma.healthProfile.findUnique({ where: { userId } }),
      this.availableCredits(userId),
    ]);
    const evidence = buildHealthEvidence(records);
    const missing: string[] = [];
    if (evidence.distinctDays < MINIMUM_DISTINCT_DAYS) {
      missing.push(`还需要至少${MINIMUM_DISTINCT_DAYS - evidence.distinctDays}天有效记录`);
    }
    if (evidence.validRecordIds.length === 0) {
      missing.push("暂未获取可用于分析的健康记录");
    }
    const analysisDocument = isGlobalRealm() ? await this.analysisDocument(userId) : null;
    const consentRequired = !(
      profile?.analysisConsentedAt && !profile.analysisConsentWithdrawn && (!isGlobalRealm() || (analysisDocument && analysisDocument.version === profile.analysisConsentVersion))
    );
    return {
      eligible: missing.length === 0,
      period: isoPeriod(period),
      validRecordCount: evidence.validRecordIds.length,
      distinctDays: evidence.distinctDays,
      minimumDistinctDays: MINIMUM_DISTINCT_DAYS,
      missing,
      consentRequired,
      availableCredits: credits.total,
    };
  }

  async create(userId: string): Promise<HealthReportContract & { needsPayment: boolean }> {
    const period = reportPeriod();
    const [records, profile] = await Promise.all([
      this.loadEvidenceRecords(userId, period.from, period.to),
      this.prisma.healthProfile.findUnique({ where: { userId } }),
    ]);
    const evidence = buildHealthEvidence(records);
    if (evidence.distinctDays < MINIMUM_DISTINCT_DAYS || !evidence.validRecordIds.length) {
      throw new BadRequestException(
        `需要至少${MINIMUM_DISTINCT_DAYS}个不同日期的有效记录，暂不创建支付订单`,
      );
    }
    if (!profile?.analysisConsentedAt || profile.analysisConsentWithdrawn) {
      throw new ForbiddenException("同意健康分析说明后才能生成详细报告");
    }
    if (isGlobalRealm()) {
      const document = await this.analysisDocument(userId);
      if (!document || document.version !== profile.analysisConsentVersion) throw globalError(409, "consent_outdated", "Read and agree to the latest health analysis notice.");
    }
    const inputDigest = evidenceDigest(userId, period, evidence);
    const reusable = await this.prisma.healthReport.findFirst({
      where: {
        userId,
        inputDigest,
        status: {
          in: [
            PrismaReportStatus.AWAITING_PAYMENT,
            PrismaReportStatus.QUEUED,
            PrismaReportStatus.GENERATING,
            PrismaReportStatus.READY,
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (reusable) {
      return {
        ...serializeReport(reusable),
        needsPayment: reusable.status === PrismaReportStatus.AWAITING_PAYMENT,
      };
    }

    const report = await this.prisma.healthReport.create({
      data: {
        userId,
        windowStart: period.from,
        windowEnd: period.to,
        distinctDays: evidence.distinctDays,
        validRecordCount: evidence.validRecordIds.length,
        metricSummary: evidence.metrics.map(({ recordIds: _recordIds, ...metric }) => metric) as unknown as Prisma.InputJsonValue,
        evidenceIndex: {
          byMetric: evidence.metrics.map((metric) => ({
            metric: metric.metric,
            recordIds: metric.recordIds,
          })),
          excludedRecordCount: evidence.invalidRecordIds.length,
        },
        inputDigest,
        freePreview: buildFreePreview(evidence),
        templateVersion: REPORT_TEMPLATE_VERSION,
      },
    });
    const queued = await this.consumeCreditAndQueue(userId, report.id);
    const current = queued
      ? await this.prisma.healthReport.findUniqueOrThrow({ where: { id: report.id } })
      : report;
    return { ...serializeReport(current), needsPayment: !queued };
  }

  async list(userId: string) {
    const reports = await this.prisma.healthReport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { items: reports.map(serializeReport) };
  }

  async get(userId: string, id: string): Promise<HealthReportContract> {
    const report = await this.ownedReport(userId, id);
    return serializeReport(report);
  }

  async full(userId: string, id: string) {
    const report = await this.ownedReport(userId, id);
    if (report.status === PrismaReportStatus.REVOKED) {
      throw new ForbiddenException("该报告对应权益已退款，暂时无法查看");
    }
    if (report.status !== PrismaReportStatus.READY || !report.fullContent) {
      throw new ConflictException(
        report.status === PrismaReportStatus.FAILED
          ? "报告生成失败，可稍后重试或申请退款"
          : "报告正在准备，请稍后刷新",
      );
    }
    return {
      ...serializeReport(report),
      content: report.fullContent,
      evidence: report.evidenceIndex,
      limitations: [
        "本报告仅基于所示时间范围内的可用数据",
        "手表数据用于日常健康管理参考，不用于诊断或治疗",
        "如有明显不适，请及时就医",
      ],
    };
  }

  async exportPdf(userId: string, id: string): Promise<Buffer> {
    const report = await this.ownedReport(userId, id);
    if (report.status === PrismaReportStatus.REVOKED) {
      throw new ForbiddenException("该报告对应权益已退款，暂时无法导出");
    }
    if (report.status !== PrismaReportStatus.READY || !report.fullContent) {
      throw new ConflictException("报告准备完成后才能导出");
    }
    const font = reportPdfFont();
    if (!font) {
      throw new ServiceUnavailableException("报告导出暂时无法使用，请稍后再试");
    }
    return createReportPdf({
      id: report.id,
      from: report.windowStart,
      to: report.windowEnd,
      distinctDays: report.distinctDays,
      validRecordCount: report.validRecordCount,
      generatedAt: report.generatedAt,
      content: safeObject(report.fullContent),
      font,
    });
  }

  async queuePaidReport(userId: string, reportId: string): Promise<void> {
    const updated = await this.prisma.healthReport.updateMany({
      where: {
        id: reportId,
        userId,
        status: PrismaReportStatus.AWAITING_PAYMENT,
      },
      data: { status: PrismaReportStatus.QUEUED, failureReason: null },
    });
    if (!updated.count) return;
    await this.enqueue(reportId, userId);
  }

  async retry(userId: string, reportId: string): Promise<HealthReportContract> {
    const report = await this.ownedReport(userId, reportId);
    if (report.status !== PrismaReportStatus.FAILED) {
      throw new ConflictException("当前报告不需要重试");
    }
    await this.prisma.healthReport.update({
      where: { id: reportId },
      data: { status: PrismaReportStatus.QUEUED, failureReason: null },
    });
    await this.enqueue(reportId, userId);
    return this.get(userId, reportId);
  }

  private async ownedReport(userId: string, id: string) {
    const report = await this.prisma.healthReport.findFirst({
      where: { id, userId },
    });
    if (!report) throw new NotFoundException("健康报告不存在");
    return report;
  }

  private async loadEvidenceRecords(userId: string, from: Date, to: Date) {
    const records = await this.prisma.healthRecord.findMany({
      where: {
        userId,
        observedAt: { gte: from, lte: to },
        quality: { not: DataQuality.INVALID },
      },
      orderBy: { observedAt: "asc" },
      take: 20_000,
      include: { ecgArtifact: { select: { id: true } } },
    });
    return records.map(
      (record): EvidenceRecord => ({
        id: record.id,
        metric: record.metric,
        observedAt: record.observedAt,
        timezoneOffsetMinutes: record.timezoneOffsetMinutes,
        values: record.values,
        quality: record.quality,
        sourceModel: record.sourceModel,
        hasEcgArtifact: Boolean(record.ecgArtifact),
      }),
    );
  }

  private async availableCredits(userId: string) {
    const now = new Date();
    const [memberships, standalone] = await Promise.all([
      this.prisma.healthMembership.findMany({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          startsAt: { lte: now },
          expiresAt: { gt: now },
          remainingCredits: { gt: 0 },
        },
        orderBy: { expiresAt: "asc" },
      }),
      this.prisma.reportCreditLedger.aggregate({
        where: { userId, membershipId: null },
        _sum: { delta: true },
      }),
    ]);
    const membershipCredits = memberships.reduce(
      (total, membership) => total + membership.remainingCredits,
      0,
    );
    const standaloneCredits = Math.max(0, standalone._sum.delta ?? 0);
    return {
      total: membershipCredits + standaloneCredits,
      membershipCredits,
      standaloneCredits,
      memberships,
    };
  }

  private async consumeCreditAndQueue(userId: string, reportId: string) {
    const consumed = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.reportCreditLedger.findUnique({
        where: { idempotencyKey: `report-consume:${reportId}` },
      });
      if (existing) return true;
      const now = new Date();
      const membership = await tx.healthMembership.findFirst({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          startsAt: { lte: now },
          expiresAt: { gt: now },
          remainingCredits: { gt: 0 },
        },
        orderBy: { expiresAt: "asc" },
      });
      const standalone = await tx.reportCreditLedger.aggregate({
        where: { userId, membershipId: null },
        _sum: { delta: true },
      });
      const membershipCredits = await tx.healthMembership.aggregate({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          startsAt: { lte: now },
          expiresAt: { gt: now },
        },
        _sum: { remainingCredits: true },
      });
      const currentBalance =
        Math.max(0, standalone._sum.delta ?? 0) +
        (membershipCredits._sum.remainingCredits ?? 0);
      if (membership) {
        const changed = await tx.healthMembership.updateMany({
          where: { id: membership.id, remainingCredits: { gt: 0 } },
          data: { remainingCredits: { decrement: 1 } },
        });
        if (!changed.count) return false;
        await tx.reportCreditLedger.create({
          data: {
            userId,
            type: CreditLedgerType.CONSUME,
            delta: -1,
            balanceAfter: Math.max(0, currentBalance - 1),
            sourceType: "health_membership",
            sourceId: membership.id,
            membershipId: membership.id,
            healthReportId: reportId,
            expiresAt: membership.expiresAt,
            idempotencyKey: `report-consume:${reportId}`,
          },
        });
      } else if ((standalone._sum.delta ?? 0) > 0) {
        await tx.reportCreditLedger.create({
          data: {
            userId,
            type: CreditLedgerType.CONSUME,
            delta: -1,
            balanceAfter: Math.max(0, currentBalance - 1),
            sourceType: "report_credit",
            sourceId: reportId,
            healthReportId: reportId,
            idempotencyKey: `report-consume:${reportId}`,
          },
        });
      } else {
        return false;
      }
      await tx.healthReport.update({
        where: { id: reportId },
        data: { status: PrismaReportStatus.QUEUED },
      });
      await tx.outboxEvent.upsert({
        where: { eventId: `health-report-generate:${reportId}` },
        create: {
          eventId: `health-report-generate:${reportId}`,
          eventType: "health_report_generate",
          aggregateType: "health_report",
          aggregateId: reportId,
          payload: { userId, reportId },
        },
        update: {
          status: OutboxStatus.PENDING,
          nextAttemptAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
      return true;
    });
    return consumed;
  }

  private async enqueue(reportId: string, userId: string): Promise<void> {
    await this.prisma.outboxEvent.upsert({
      where: { eventId: `health-report-generate:${reportId}` },
      create: {
        eventId: `health-report-generate:${reportId}`,
        eventType: "health_report_generate",
        aggregateType: "health_report",
        aggregateId: reportId,
        payload: { userId, reportId },
      },
      update: {
        status: OutboxStatus.PENDING,
        nextAttemptAt: new Date(),
        lockedAt: null,
        lastError: null,
      },
    });
  }
}

function reportPeriod(now = new Date()) {
  return {
    from: new Date(now.valueOf() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1_000),
    to: now,
  };
}

function isoPeriod(period: { from: Date; to: Date }) {
  return { from: period.from.toISOString(), to: period.to.toISOString() };
}

type ReportPdfFont = { path: string; family?: string };

function reportPdfFont(): ReportPdfFont | null {
  const configured = String(process.env.REPORT_PDF_FONT_PATH ?? "").trim();
  const family = String(process.env.REPORT_PDF_FONT_FAMILY ?? "").trim();
  const candidates = [
    configured,
    "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "C:\\Windows\\Fonts\\simhei.ttf",
  ].filter(Boolean);
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return null;
  return family ? { path, family } : { path };
}

async function createReportPdf(input: {
  id: string;
  from: Date;
  to: Date;
  distinctDays: number;
  validRecordCount: number;
  generatedAt: Date | null;
  content: Record<string, unknown>;
  font: ReportPdfFont;
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({
      size: "A4",
      margins: { top: 52, right: 52, bottom: 52, left: 52 },
      info: {
        Title: "Saydian赛电健康管理参考报告",
        Author: "Saydian赛电",
        Subject: "AI生成的健康管理参考",
      },
    });
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    try {
      if (input.font.family) document.font(input.font.path, input.font.family);
      else document.font(input.font.path);
      document.fontSize(22).fillColor("#17202c").text("Saydian赛电健康管理参考报告");
      document.moveDown(0.35);
      document.fontSize(11).fillColor("#a32939").text("AI生成内容 · 仅供日常健康管理参考");
      document.moveDown(0.8);
      document.fontSize(10).fillColor("#5d6670");
      document.text(`数据区间：${dateLabel(input.from)} 至 ${dateLabel(input.to)}`);
      document.text(`数据完整度：${input.distinctDays}个自然日，${input.validRecordCount}条有效记录`);
      document.text(`报告编号：${input.id}`);
      document.text(`生成时间：${input.generatedAt ? input.generatedAt.toISOString() : "未获取"}`);
      document.moveDown(1.1);

      pdfSection(document, "概览", [plainPdfText(input.content.overview, "暂未获取概览")]);
      pdfSection(document, "趋势", pdfTextList(input.content.trends));
      pdfSection(document, "健康管理建议", pdfTextList(input.content.suggestions));
      pdfSection(document, "数据局限", pdfTextList(input.content.limitations));

      document.moveDown(0.8);
      document
        .fontSize(10)
        .fillColor("#a32939")
        .text(
          plainPdfText(
            input.content.safetyNotice,
            "本报告不用于诊断或治疗；如有明显不适，请及时就医。",
          ),
          { lineGap: 4 },
        );
      document.end();
    } catch (error) {
      document.removeAllListeners();
      reject(error);
    }
  });
}

function pdfSection(document: PDFKit.PDFDocument, title: string, items: string[]) {
  document.fontSize(15).fillColor("#17202c").text(title);
  document.moveDown(0.35);
  const rows = items.length ? items : ["未获取"];
  for (const item of rows) {
    document.fontSize(10.5).fillColor("#303942").text(`• ${item}`, {
      indent: 8,
      lineGap: 4,
    });
    document.moveDown(0.25);
  }
  document.moveDown(0.55);
}

function pdfTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const row = item as Record<string, unknown>;
        const metric = plainPdfText(row.metric, "");
        const text = plainPdfText(row.text, "");
        return text ? `${metric ? `${metric}：` : ""}${text}` : "";
      }
      return plainPdfText(item, "");
    })
    .filter(Boolean);
}

function plainPdfText(value: unknown, fallback: string): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
  return text || fallback;
}

function dateLabel(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function evidenceDigest(
  userId: string,
  period: { from: Date; to: Date },
  evidence: HealthEvidence,
) {
  return sha256(
    JSON.stringify({
      userId,
      template: REPORT_TEMPLATE_VERSION,
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
      recordIds: [...evidence.validRecordIds].sort(),
    }),
  );
}

function buildFreePreview(evidence: HealthEvidence): Prisma.InputJsonObject {
  return {
    title: "近30天健康概览",
    summary:
      evidence.metrics.length > 0
        ? `已汇总${evidence.distinctDays}天、${evidence.metrics.length}类有效健康数据。`
        : "暂未获取可用于分析的健康数据。",
    metricCount: evidence.metrics.length,
    distinctDays: evidence.distinctDays,
    validRecordCount: evidence.validRecordIds.length,
    disclaimer: "健康数据和AI分析仅供日常健康管理参考，不用于诊断或治疗。",
  };
}

function serializeReport(report: {
  id: string;
  status: PrismaReportStatus;
  windowStart: Date;
  windowEnd: Date;
  distinctDays: number;
  validRecordCount: number;
  freePreview: unknown;
  aiGenerated: boolean;
  generatedAt: Date | null;
  createdAt: Date;
}): HealthReportContract {
  return {
    id: report.id,
    status: report.status.toLowerCase() as HealthReportContract["status"],
    period: {
      from: report.windowStart.toISOString(),
      to: report.windowEnd.toISOString(),
    },
    dataCompleteness: {
      validRecordCount: report.validRecordCount,
      distinctDays: report.distinctDays,
    },
    freePreview: safeObject(report.freePreview),
    aiGenerated: report.aiGenerated,
    aiLabel: report.aiGenerated ? "AI生成的健康管理参考" : "健康数据概览",
    generatedAt: report.generatedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
  };
}
