import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  ForbiddenException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { NoFilesInterceptor } from "@nestjs/platform-express";
import type { HealthMetric } from "@saydian/app-contracts";
import { randomUUID } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { CareService } from "../care/care.service";
import { safeObject, sha256 } from "../common/crypto";
import { RawResponse } from "../common/raw-response.decorator";
import {
  CurrentUser,
  type AuthenticatedUser,
  type RequestWithContext,
} from "../common/request-context";
import { UserAuthGuard } from "../common/user-auth.guard";
import { HealthService } from "../health/health.service";
import { MembersService } from "../members/members.service";
import { NotificationsService } from "../notifications/notifications.service";
import { SupportService } from "../support/support.service";
import {
  canonicalToLegacyDaily,
  canonicalToLegacyComposition,
  legacyDailyToCanonical,
  legacyCompositionToCanonical,
  parseLegacyDate,
} from "./legacy-health-mapper";
import { legacySuccess } from "./legacy-response";
import { LegacyService } from "./legacy.service";
import { legacyCareMetrics, legacyCareNames } from "./legacy-care-mapper";
import { canonicalToLegacyWarnings, legacyWarningsToCanonical } from "./legacy-warning-mapper";

const legacyDailyMetric: Record<string, HealthMetric> = {
  pulsereat: "heart_rate",
  heartrate: "heart_rate",
  heartreat: "heart_rate",
  bloodpressure: "blood_pressure",
  bloodglucose: "blood_glucose",
  bloodoxygen: "blood_oxygen",
  bodytemperature: "temperature",
  hrv: "hrv",
  sleep: "sleep",
};

const allDailyMetrics: HealthMetric[] = [
  "sleep",
  "heart_rate",
  "blood_oxygen",
  "blood_pressure",
  "blood_glucose",
  "temperature",
  "hrv",
];

@Controller("api/v1/member")
@UseGuards(UserAuthGuard)
@RawResponse()
@UseInterceptors(NoFilesInterceptor({ limits: { fields: 40, fieldSize: 2 * 1024 * 1024 } }))
export class LegacyMemberController {
  constructor(
    private readonly auth: AuthService,
    private readonly members: MembersService,
    private readonly health: HealthService,
    private readonly care: CareService,
    private readonly notifications: NotificationsService,
    private readonly support: SupportService,
    private readonly legacy: LegacyService,
  ) {}

  @Get("member/my")
  async member(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(await this.legacy.member(user.id));
  }

  @Post("member/save")
  async saveMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const profile = await this.members.saveProfile(user.id, input);
    return legacySuccess(
      await this.legacy.member(profile.id),
      "资料已保存",
    );
  }

  @Get("member-mubiao/preview")
  async goals(@CurrentUser() user: AuthenticatedUser) {
    const goals = await this.members.goals(user.id);
    return legacySuccess({
      steps: goals.steps,
      juli: goals.distanceMeters,
      reliang: goals.caloriesKcal,
    });
  }

  @Post("member-mubiao")
  async saveGoals(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const goals = await this.members.saveGoals(user.id, {
      steps: body.steps,
      distanceMeters: body.juli,
      caloriesKcal: body.reliang,
    });
    return legacySuccess(goals, "目标已保存");
  }

  @Post("health-records/batch")
  async healthBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Req() request: RequestWithContext,
  ) {
    const key = request.header("idempotency-key")?.trim() || digestKey(input);
    return legacySuccess(await this.health.ingestBatch(user.id, key, input));
  }

  @Get("health-warning/preview")
  async warningSettings(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(canonicalToLegacyWarnings(await this.health.warningRules(user.id)));
  }

  @Post("health-warning")
  async saveWarningSettings(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const current = await this.health.warningRules(user.id);
    await this.health.saveWarningRules(user.id, legacyWarningsToCanonical(input, current));
    return this.warningSettings(user);
  }

  @Post("feedback")
  async feedback(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const body = safeObject(input);
    return legacySuccess(await this.support.createFeedback(user.id, {
      category: body.type ?? body.category,
      content: body.content,
      contact: body.contact,
      attachments: body.attachments,
    }), "反馈已提交");
  }

  @Post("jrjk")
  async saveActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const records = [
      activityRecord("steps", body.steps_num, "count"),
      activityRecord("calories", body.reliang_num, "kcal"),
      activityRecord("distance", body.juli_num, "meter"),
    ].filter((record) => record !== null);
    if (records.length === 0) return legacySuccess({ accepted: 0 });
    const result = await this.health.ingestBatch(user.id, digestKey({ route: "jrjk", day: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10), input }), {
      records,
    }, { scope: "legacy_jrjk", fingerprint: input });
    if (result.rejected.length) throw new BadRequestException("活动记录未保存，请重试");
    return legacySuccess(result);
  }

  @Post("daily-date")
  async saveDaily(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const rows = Array.isArray(body.dailyDate) ? body.dailyDate : [];
    if (!rows.length || rows.length > 2000) throw new BadRequestException("每次请同步1至2000条日记录");
    if (rows.some((row) => !parseLegacyDate(safeObject(row).date))) throw new BadRequestException("健康记录时间不正确");
    const records = legacyDailyToCanonical(rows, "legacy-daily");
    if (!records.length) throw new BadRequestException("没有可保存的健康记录");
    const acceptedIds: string[] = [];
    const rejected: Array<{ id: string; code: string; message: string }> = [];
    let nextCursor: string | null = null;
    for (let offset = 0; offset < records.length; offset += 200) {
      const chunk = records.slice(offset, offset + 200);
      const result = await this.health.ingestBatch(user.id, digestKey({ route: "daily-date", records: chunk }), { records: chunk });
      acceptedIds.push(...result.acceptedIds);
      rejected.push(...result.rejected);
      nextCursor = result.nextCursor ?? nextCursor;
    }
    // Old clients treat business code 200 as complete success and cannot retry a partial response.
    if (rejected.length) throw new BadRequestException("部分健康记录未保存，请检查记录后重试");
    return legacySuccess({ acceptedIds, rejected, nextCursor });
  }

  @Get("daily-date/preview")
  async dailyPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
    @Req() request: RequestWithContext,
  ) {
    const requested = String(query.type ?? "").toLowerCase();
    const metrics = requested
      ? [legacyDailyMetric[requested]].filter(
          (metric): metric is HealthMetric => Boolean(metric),
        )
      : allDailyMetrics;
    if (!metrics.length) throw new BadRequestException("健康指标不正确");
    const records = await this.healthRows(user.id, query, metrics, request.requestId);
    return legacySuccess(canonicalToLegacyDaily(records));
  }

  @Get("daily-date")
  async dailyHistory(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithContext) {
    const requested = String(query.type ?? "").toLowerCase();
    const metrics = requested ? [legacyDailyMetric[requested]].filter((metric): metric is HealthMetric => Boolean(metric)) : allDailyMetrics;
    if (!metrics.length) throw new BadRequestException("健康指标不正确");
    return legacySuccess(canonicalToLegacyDaily(await this.healthRows(user.id, query, metrics, request.requestId, true)));
  }

  @Get("bloodcomposition")
  async bloodHistory(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string | undefined>, @Req() request: RequestWithContext) {
    return this.previewSpecialMetric(user.id, "blood_composition", query, request.requestId, true);
  }

  @Post("bodycomposition")
  saveBodyComposition(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.saveSpecialMetric(user.id, "body_composition", input, idempotencyKey);
  }

  @Get("bodycomposition/preview")
  previewBodyComposition(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
    @Req() request: RequestWithContext,
  ) {
    return this.previewSpecialMetric(
      user.id,
      "body_composition",
      query,
      request.requestId,
    );
  }

  @Post("bloodcomposition")
  saveBloodComposition(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.saveSpecialMetric(user.id, "blood_composition", input, idempotencyKey);
  }

  @Get("bloodcomposition/preview")
  previewBloodComposition(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
    @Req() request: RequestWithContext,
  ) {
    return this.previewSpecialMetric(
      user.id,
      "blood_composition",
      query,
      request.requestId,
    );
  }

  @Post("e-c-g")
  async saveEcg(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const data = safeObject(body.data);
    const artifact = await this.support.storeLegacyEcgSamples(
      user.id,
      body.totalArray,
    );
    const observedAt = parseLegacyDate(data.date) ?? new Date();
    const record = {
      id: `legacy-ecg-${randomUUID()}`,
      metric: "ecg" as const,
      observedAt: observedAt.toISOString(),
      timezoneOffsetMinutes: 480,
      values: scalarValues(data, ["date"]),
      quality: "unknown" as const,
      source: { platform: "mini_program" as const },
      ecgArtifact: {
        sampleRateHz: finiteInteger(data.sampleFrequency, 1, 5000) ?? 250,
        sampleCount: artifact.sampleCount,
        sha256: artifact.sha256,
        uploadObjectKey: artifact.uploadObjectKey,
      },
    };
    const result = await this.health.ingestBatch(user.id, digestKey({ route: "ecg", input }), {
      records: [record],
    }, { scope: "legacy_ecg", fingerprint: input });
    if (result.rejected.length) throw new BadRequestException("心电记录未保存，请重试");
    return legacySuccess(result);
  }

  @Get("e-c-g/preview")
  previewEcg(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
    @Req() request: RequestWithContext,
  ) {
    return this.previewSpecialMetric(user.id, "ecg", query, request.requestId);
  }

  @Get("bodycomposition/:id")
  async bodyDetail(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    const detail = await this.health.legacyDetail(user.id, "body_composition", id);
    return legacySuccess({ ...detail, ...canonicalToLegacyComposition("body_composition", detail) });
  }

  @Get("care")
  async careInvitations(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(await this.legacy.careRows(user.id, false));
  }

  @Get("care/my")
  async careMembers(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(await this.legacy.careRows(user.id, true));
  }

  @Post("care")
  async addCare(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const relationship = await this.care.invite(
      user.id,
      String(safeObject(input).mobile ?? ""),
    );
    return legacySuccess(relationship, "邀请已发送");
  }

  @Post("care/save")
  async respondCare(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const relationship = await this.legacy.relationshipByCompatibilityId(body.id);
    const accepted = Number(body.examine_status) === 1;
    const updated = await this.care.respond(user.id, relationship.id, accepted);
    return legacySuccess(updated, accepted ? "已接受邀请" : "已拒绝邀请");
  }

  @Get("care-setting/preview")
  async careSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Query("to_member_id") memberId: string,
  ) {
    const relationship = await this.legacy.relationshipForSettings(user.id, memberId);
    const metrics = relationship.permissions
      .filter((permission) => permission.enabled)
      .map((permission) => permission.metric.toLowerCase());
    return legacySuccess({ setting: JSON.stringify(legacyCareNames(metrics)) });
  }

  @Post("care-setting")
  async saveCareSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const relationship = await this.legacy.relationshipForSettings(
      user.id,
      body.to_member_id,
    );
    const updated = await this.care.savePermissions(user.id, relationship.id, {
      metrics: legacyCareMetrics(body.setting),
    });
    return legacySuccess(updated, "共享设置已保存");
  }

  @Get("care/preview")
  async carePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string | undefined>,
    @Req() request: RequestWithContext,
  ) {
    const relationship = await this.legacy.relationshipByCompatibilityId(query.id);
    const rows = await this.healthRows(
      user.id,
      { ...query, selectmember: String(this.legacy.memberContract(relationship.recipient).id) },
      ["steps", "distance", "calories", ...allDailyMetrics],
      request.requestId,
    );
    const daily = canonicalToLegacyDaily(rows);
    const latest = (metric: HealthMetric) =>
      rows.find((row) => row.metric === metric)?.values?.value ?? null;
    return legacySuccess({
      daily,
      jrjk: {
        steps_num: latest("steps"),
        juli_num: latest("distance"),
        reliang_num: latest("calories"),
      },
    });
  }

  @Get("notify")
  async notificationList(
    @CurrentUser() user: AuthenticatedUser,
    @Query("page") page?: string,
  ) {
    return legacySuccess(await this.legacy.notifications(user.id, Number(page ?? 1)));
  }

  @Get("notify/unread-count")
  async unread(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.notifications.unreadCount(user.id);
    return legacySuccess({ unread_count: result.count });
  }

  @Get("notify/statistics")
  async notificationStatistics(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(await this.legacy.notificationStatistics(user.id));
  }

  @Get("notify/:id")
  async notification(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    const notificationId = await this.legacy.notificationId(user.id, id);
    await this.notifications.markRead(user.id, notificationId);
    return legacySuccess(await this.legacy.notification(user.id, id));
  }

  @Post("notify/:id/read")
  async readNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") identifier: string,
  ) {
    const id = await this.legacy.notificationId(user.id, identifier);
    return legacySuccess(await this.notifications.markRead(user.id, id));
  }

  @Post("push-devices")
  async pushDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return legacySuccess(await this.notifications.registerInstallation(user.id, input));
  }

  @Delete("push-devices/:installationId")
  async removePushDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param("installationId") installationId: string,
  ) {
    return legacySuccess(
      await this.notifications.unregisterInstallation(user.id, installationId),
    );
  }

  @Post("account/delete")
  async deleteAccount(@CurrentUser() user: AuthenticatedUser) {
    return legacySuccess(
      await this.auth.requestAccountDeletion(user.id),
      "注销申请已提交",
    );
  }

  private async saveSpecialMetric(
    userId: string,
    metric: "body_composition" | "blood_composition",
    input: unknown,
    idempotencyKey?: string,
  ) {
    const body = safeObject(input);
    const data = safeObject(body.data);
    const parsedDate = parseLegacyDate(data.date);
    if (data.date && !parsedDate) throw new BadRequestException("健康记录时间不正确");
    const observedAt = parsedDate ?? new Date();
    // Old composition uploads omit a measurement time and ID. Without an explicit
    // key those cannot safely be deduplicated against a later equal measurement.
    const key = idempotencyKey?.trim() || (parsedDate ? digestKey({ metric, input }) : randomUUID());
    const result = await this.health.ingestBatch(userId, key, {
      records: [
        {
          id: `legacy-${metric}-${sha256(key).slice(0, 32)}`,
          metric,
          observedAt: observedAt.toISOString(),
          timezoneOffsetMinutes: 480,
          values: legacyCompositionToCanonical(metric, scalarValues(data, ["date"])),
          quality: "unknown",
          source: { platform: "mini_program" },
        },
      ],
    }, { scope: `legacy_${metric}`, fingerprint: input });
    if (result.rejected.length) throw new BadRequestException("健康记录未保存，请重试");
    return legacySuccess(result);
  }

  private async previewSpecialMetric(
    userId: string,
    metric: HealthMetric,
    query: Record<string, string | undefined>,
    requestId: string,
    paginated = false,
  ) {
    const records = await this.healthRows(userId, query, [metric], requestId, paginated);
    return legacySuccess(
      records.map((record) => ({
        id: record.id,
        date: record.observedAt,
        ...(metric === "body_composition" || metric === "blood_composition"
          ? canonicalToLegacyComposition(metric, record.values)
          : safeObject(record.values)),
        ...(record.ecgArtifact ? { ecgArtifact: record.ecgArtifact } : {}),
      })),
    );
  }

  private async healthRows(
    userId: string,
    query: Record<string, string | undefined>,
    metrics: HealthMetric[],
    requestId: string,
    paginated = false,
  ): Promise<Array<Record<string, any>>> {
    const bounds = paginated && !query.date && !query.day ? undefined : dateBounds(query.date ?? query.day);
    const page = paginated ? Math.max(1, Math.floor(Number(query.page) || 1)) : undefined;
    const selectMember = (query.selectmember ?? query.selectMemberId)?.trim();
    const result: Array<Record<string, any>> = [];
    if (selectMember && selectMember !== "0") {
      const { relationship } = await this.legacy.viewerRelationship(
        userId,
        selectMember,
      );
      for (const metric of metrics) {
        try {
          const records = await this.care.preview(
            userId,
            relationship.id,
            metric,
            bounds?.from.toISOString(),
            bounds?.to.toISOString(),
            requestId,
            page,
          );
          result.push(...records);
        } catch (error) {
          if (!(error instanceof ForbiddenException) || metrics.length === 1) throw error;
        }
      }
      return result.sort((a, b) =>
        String(b.observedAt).localeCompare(String(a.observedAt)),
      );
    }
    result.push(...await this.health.legacyRecords(userId, metrics, bounds?.from, bounds?.to, page));
    return result.sort((a, b) =>
      String(b.observedAt).localeCompare(String(a.observedAt)),
    );
  }
}

function digestKey(input: unknown): string {
  return sha256(JSON.stringify(input));
}

function activityRecord(metric: HealthMetric, raw: unknown, unit: string) {
  if (raw === null || raw === undefined || typeof raw === "boolean" || String(raw).trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const observedAt = new Date();
  return {
    id: `legacy-${metric}-${randomUUID()}`,
    metric,
    observedAt: observedAt.toISOString(),
    timezoneOffsetMinutes: 480,
    values: { value },
    unit,
    quality: "unknown" as const,
    source: { platform: "mini_program" as const },
  };
}

function scalarValues(
  value: Record<string, unknown>,
  excluded: string[] = [],
): Record<string, number | string | boolean | null> {
  const result: Record<string, number | string | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (excluded.includes(key) || item === undefined) continue;
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      result[key] = item;
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
  }
  return result;
}

function finiteInteger(value: unknown, min: number, max: number): number | null {
  const result = Number(value);
  return Number.isInteger(result) && result >= min && result <= max ? result : null;
}

function dateBounds(value?: string): { from: Date; to: Date } {
  const now = new Date();
  if (!value) return { from: new Date(now.valueOf() - 7 * 86400_000), to: now };
  const epoch = Number(value);
  if (Number.isFinite(epoch) && epoch > 1_000_000_000) {
    const from = new Date(epoch * (epoch > 1_000_000_000_000 ? 1 : 1000));
    return { from, to: new Date(from.valueOf() + 86400_000) };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const from = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) -
        8 * 3600_000,
    );
    return { from, to: new Date(from.valueOf() + 86400_000) };
  }
  return { from: new Date(now.valueOf() - 7 * 86400_000), to: now };
}
