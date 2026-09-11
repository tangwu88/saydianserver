import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ReportStatus } from "@prisma/client";
import { cutoverFlag, healthReportWorkerEnabled } from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { safeObject, sha256 } from "../common/crypto";
import { isGlobalRealm } from "../common/deployment-realm";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
import { HealthReportsService, serializeReport } from "../reports/health-reports.service";

type AdminActor = { id: string; role: string; roles?: string[] };
type BlockReason = { code: string; message: string };

@Injectable()
export class AdminHealthReportsService {
  constructor(private readonly prisma: PrismaService, private readonly reports: HealthReportsService, private readonly secrets: IntegrationSecretsService) {}

  async availability(memberId: string, current: AdminActor, db: Prisma.TransactionClient = this.prisma, alreadyCovered = false, resolvedCredentials?: Record<string, string> | null) {
    authorize(current); uuid(memberId);
    const bypassMemberConsent = canBypassMemberConsent(current);
    const bypassReportCredit = canBypassMemberConsent(current);
    const member = await db.user.findUnique({ where: { id: memberId }, select: { status: true } });
    if (!member) throw new NotFoundException("会员不存在");
    const [eligibility, integration, latest] = await Promise.all([
      this.reports.eligibility(memberId, db),
      db.integrationConfig.findUnique({ where: { key: "ai" } }),
      db.healthReport.findFirst({ where: { userId: memberId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, createdAt: true } }),
    ]);
    const reasons: BlockReason[] = [];
    if (member.status !== "ACTIVE") reasons.push({ code: "member_inactive", message: "会员账号当前不可用" });
    if (!eligibility.eligible) reasons.push({ code: "insufficient_data", message: eligibility.missing.join("；") });
    if (eligibility.consentRequired && !bypassMemberConsent) reasons.push({ code: "consent_required", message: "会员尚未同意当前健康分析说明，请由会员在 App 内阅读并同意" });
    if (!alreadyCovered && !bypassReportCredit && eligibility.availableCredits < 1) reasons.push({ code: "credits_required", message: "没有可用的健康报告次数" });
    const config = safeObject(integration?.publicConfig);
    const provider = String(config.provider ?? process.env.AI_PROVIDER ?? "disabled").trim();
    const demo = cutoverFlag(process.env.H5_DEMO_ENABLED);
    if (demo) reasons.push({ code: "demo_disabled", message: "演示环境禁止调用真实 AI 服务" });
    if (!healthReportWorkerEnabled(process.env)) reasons.push({ code: "worker_paused", message: "报告处理任务已暂停，请联系管理员核验运行配置" });
    if (integration?.state !== "CONFIGURED" || !provider || provider.toLowerCase() === "disabled") {
      reasons.push({ code: "ai_unconfigured", message: "AI 服务尚未配置" });
    } else if (!demo) {
      try {
        // Resolution only decrypts local configuration; this endpoint never
        // probes a provider and never returns credentials or private URLs.
        const secrets = resolvedCredentials === undefined ? await this.resolveAiCredentials() : resolvedCredentials;
        if (!secrets) throw new Error("unavailable");
        const baseUrl = String(config.baseUrl ?? secrets.baseUrl ?? "").trim();
        const endpoint = new URL(baseUrl);
        if (!secrets.apiKey?.trim() || endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("unavailable");
      } catch {
        reasons.push({ code: "ai_credentials_unavailable", message: "AI 服务凭据尚未完整配置或无法读取" });
      }
    }
    return {
      canGenerate: reasons.length === 0, reasons,
      period: eligibility.period, validRecordCount: eligibility.validRecordCount,
      distinctDays: eligibility.distinctDays, minimumDistinctDays: eligibility.minimumDistinctDays,
      consentRequired: eligibility.consentRequired && !bypassMemberConsent,
      memberConsentBypass: bypassMemberConsent,
      reportCreditBypass: bypassReportCredit,
      availableCredits: eligibility.availableCredits,
      latestReport: latest ? { id: latest.id, status: latest.status.toLowerCase(), createdAt: latest.createdAt.toISOString() } : null,
    };
  }

  async create(input: unknown, current: AdminActor, requestId?: string) {
    authorize(current);
    const body = safeObject(input);
    const memberId = uuid(body.memberId);
    const key = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (key.length < 8 || key.length > 160) throw new BadRequestException("请提供8至160字符的请求标识");
    if (Object.keys(body).some(field => !["memberId", "idempotencyKey"].includes(field))) throw new BadRequestException("报告请求包含不支持的字段");
    // Resolve before taking the member transaction lock. The secret service
    // uses the root Prisma pool; nested acquisition could exhaust the pool
    // while other requests hold connections waiting for this member's lock.
    const revision = await this.aiConfigurationRevision(this.prisma);
    const credentials = await this.resolveAiCredentials();
    const bypassMemberConsent = canBypassMemberConsent(current);
    const bypassReportCredit = canBypassMemberConsent(current);
    return this.reports.createForAdmin(memberId, {
      idempotencyKey: key, actorId: current.id, bypassMemberConsent, bypassReportCredit, ...(requestId ? { requestId } : {}),
      validate: async (tx, alreadyCovered) => {
        if (revision !== await this.aiConfigurationRevision(tx)) throw new ConflictException({ errorKey: "health_report_unavailable", message: "AI 服务配置已变更，请刷新后重试" });
        const result = await this.availability(memberId, current, tx, alreadyCovered, credentials);
        if (!result.canGenerate) throw new ConflictException({ errorKey: "health_report_unavailable", message: result.reasons.map(reason => reason.message).join("；") });
      },
    });
  }

  private async resolveAiCredentials() {
    try { return await this.secrets.resolve("ai", { apiKey: "AI_API_KEY", baseUrl: "AI_BASE_URL", model: "AI_MODEL" }); }
    catch { return null; }
  }

  private async aiConfigurationRevision(db: Prisma.TransactionClient) {
    const [config, secret] = await Promise.all([
      db.integrationConfig.findUnique({ where: { key: "ai" }, select: { updatedAt: true } }),
      db.integrationSecret.findUnique({ where: { integrationKey: "ai" }, select: { updatedAt: true } }),
    ]);
    return JSON.stringify([config?.updatedAt?.toISOString() ?? null, secret?.updatedAt?.toISOString() ?? null]);
  }

  async detail(id: string, current: AdminActor, requestId?: string) {
    authorize(current); uuid(id);
    return this.prisma.$transaction(async tx => {
      const report = await tx.healthReport.findUnique({
        where: { id },
        include: { user: { select: { compatibilityId: true, nickname: true } } },
      });
      if (!report) throw new NotFoundException("健康报告不存在");
      const ready = report.status === ReportStatus.READY && Boolean(report.fullContent);
      // A report contains sensitive derived health data. Audit persistence is
      // mandatory and must finish before even its preview is returned.
      await tx.auditLog.create({ data: { actorType: "ADMIN", actorId: current.id, action: "HEALTH_REPORT_READ", entityType: "HEALTH_REPORT", entityId: id, requestId: requestId ?? null, afterJson: { memberId: report.userId, status: report.status, fullContent: ready } } });
      return {
        ...serializeReport(report), memberId: report.userId,
        member: { memberNo: String(report.user.compatibilityId), nickname: report.user.nickname },
        updatedAt: report.updatedAt.toISOString(),
        ...(report.status === ReportStatus.FAILED ? { failureReason: "健康报告生成失败，请联系管理员检查任务记录" } : {}),
        ...(ready ? { content: report.fullContent, limitations: ["本报告仅基于所示时间范围内的可用数据", "手表数据用于日常健康管理参考，不用于诊断或治疗", "如有明显不适，请及时就医"] } : {}),
      };
    });
  }

  async update(id: string, input: unknown, current: AdminActor, requestId?: string) {
    authorizeSuperAdmin(current); uuid(id);
    const body = safeObject(input);
    if (Object.keys(body).some(field => !["content", "expectedUpdatedAt"].includes(field))) {
      throw new BadRequestException("报告修改包含不支持的字段");
    }
    const expectedUpdatedAt = requiredDate(body.expectedUpdatedAt, "报告更新时间");
    return this.prisma.$transaction(async tx => {
      const report = await tx.healthReport.findUnique({
        where: { id },
        include: { user: { select: { compatibilityId: true, nickname: true } } },
      });
      if (!report) throw new NotFoundException("健康报告不存在");
      if (report.status !== ReportStatus.READY || !report.fullContent) {
        throw new ConflictException("只有已生成的健康报告可以编辑");
      }
      if (report.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException("报告已更新，请重新打开后再编辑");
      }
      const content = editableReportContent(body.content, report.fullContent);
      const previousContent = safeObject(report.fullContent);
      const changedSections = ["overview", "trends", "suggestions", "limitations"].filter(
        key => JSON.stringify(previousContent[key]) !== JSON.stringify(content[key]),
      );
      const changed = await tx.healthReport.updateMany({
        where: { id, status: ReportStatus.READY, updatedAt: report.updatedAt },
        data: { fullContent: content as Prisma.InputJsonValue },
      });
      if (!changed.count) throw new ConflictException("报告已更新，请重新打开后再编辑");
      const saved = await tx.healthReport.findUniqueOrThrow({
        where: { id },
        include: { user: { select: { compatibilityId: true, nickname: true } } },
      });
      await tx.auditLog.create({
        data: {
          actorType: "ADMIN",
          actorId: current.id,
          action: "HEALTH_REPORT_UPDATE",
          entityType: "HEALTH_REPORT",
          entityId: id,
          requestId: requestId ?? null,
          beforeJson: { memberId: report.userId, contentHash: sha256(JSON.stringify(report.fullContent)) },
          afterJson: { memberId: report.userId, contentHash: sha256(JSON.stringify(content)), changedSections },
        },
      });
      return {
        ...serializeReport(saved),
        memberId: saved.userId,
        member: { memberNo: String(saved.user.compatibilityId), nickname: saved.user.nickname },
        updatedAt: saved.updatedAt.toISOString(),
        content: saved.fullContent,
        limitations: ["本报告仅基于所示时间范围内的可用数据", "手表数据用于日常健康管理参考，不用于诊断或治疗", "如有明显不适，请及时就医"],
      };
    });
  }
}

function canBypassMemberConsent(current: AdminActor): boolean {
  const roles = current.roles?.length ? current.roles : [current.role];
  return roles.includes("SUPER_ADMIN");
}

function authorize(current: AdminActor) {
  if (!isGlobalRealm()) throw new NotFoundException("此功能仅供国际版后台使用");
  const roles = current?.roles?.length ? current.roles : [current?.role];
  if (!current?.id || !roles.some(role => role === "SUPER_ADMIN" || role === "HEALTH_AUDITOR")) throw new ForbiddenException("当前账号无权分析健康数据");
}

function authorizeSuperAdmin(current: AdminActor) {
  authorize(current);
  const roles = current.roles?.length ? current.roles : [current.role];
  if (!roles.includes("SUPER_ADMIN")) throw new ForbiddenException("只有超级管理员可以编辑健康报告");
}

function editableReportContent(value: unknown, existingValue: unknown): Prisma.InputJsonObject {
  const input = safeObject(value);
  if (Object.keys(input).some(field => !["overview", "trends", "suggestions", "limitations"].includes(field))) {
    throw new BadRequestException("报告正文包含不支持的字段");
  }
  const existing = safeObject(existingValue);
  const overview = requiredText(input.overview, "健康概览", 2_000);
  const currentTrends = Array.isArray(existing.trends) ? existing.trends.map(item => safeObject(item)) : [];
  const submittedTrends = Array.isArray(input.trends) ? input.trends.map(item => safeObject(item)) : [];
  if (!currentTrends.length || submittedTrends.length !== currentTrends.length) {
    throw new BadRequestException("健康趋势项目必须与原报告一致");
  }
  const trends = submittedTrends.map((item, index) => {
    const current = currentTrends[index]!;
    const metric = requiredText(item.metric, "健康指标", 80);
    if (metric !== String(current.metric ?? "")) throw new BadRequestException("健康指标不能修改或调换顺序");
    const evidenceRecordIds = Array.isArray(current.evidenceRecordIds)
      ? current.evidenceRecordIds.map(value => String(value)).filter(Boolean).slice(0, 20_000)
      : [];
    if (!evidenceRecordIds.length) throw new BadRequestException("原报告趋势缺少数据依据，不能人工编辑");
    return { metric, text: requiredText(item.text, "趋势说明", 500), evidenceRecordIds };
  });
  const suggestions = textList(input.suggestions, "健康建议", 20, 500, false);
  const limitations = textList(input.limitations, "数据局限", 20, 500, true);
  const combined = [overview, ...trends.map(item => item.text), ...suggestions, ...limitations].join(" ");
  if (/确诊|处方|治愈|100%准确|医疗级|替代医生/.test(combined)) {
    throw new BadRequestException("报告内容超出日常健康管理范围，请删除诊断、治疗或绝对准确性表述");
  }
  return {
    aiLabel: "AI生成并经管理员复核的健康管理参考",
    overview,
    trends,
    suggestions,
    limitations,
    safetyNotice: "本报告不用于诊断或治疗；如有明显不适，请及时就医。",
  };
}

function requiredDate(value: unknown, label: string): Date {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${label}格式不正确`);
  return date;
}

function requiredText(value: unknown, label: string, maximumLength: number): string {
  const text = String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  if (text.length > maximumLength) throw new BadRequestException(`${label}不能超过${maximumLength}字`);
  return text;
}

function textList(value: unknown, label: string, maximumItems: number, maximumLength: number, required: boolean): string[] {
  if (!Array.isArray(value)) throw new BadRequestException(`${label}格式不正确`);
  if (value.length > maximumItems) throw new BadRequestException(`${label}最多${maximumItems}项`);
  const items = value.map((item, index) => requiredText(item, `${label}第${index + 1}项`, maximumLength));
  if (required && !items.length) throw new BadRequestException(`${label}至少保留1项`);
  return items;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new BadRequestException("会员或报告编号不正确");
  return value;
}
