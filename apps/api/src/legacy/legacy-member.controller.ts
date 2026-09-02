import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
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
  legacyDailyToCanonical,
} from "./legacy-health-mapper";
import { legacySuccess } from "./legacy-response";
import { LegacyService } from "./legacy.service";

const legacyDailyMetric: Record<string, HealthMetric> = {
  pulsereat: "heart_rate",
  heartrate: "heart_rate",
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
  @UseInterceptors(AnyFilesInterceptor())
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
  @UseInterceptors(AnyFilesInterceptor())
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
    const result = await this.health.ingestBatch(user.id, digestKey(input), {
      records,
    });
    return legacySuccess(result);
  }

  @Post("daily-date")
  async saveDaily(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    const body = safeObject(input);
    const rows = Array.isArray(body.dailyDate) ? body.dailyDate : [];
    const records = legacyDailyToCanonical(rows, `legacy-${randomUUID()}`);
    const result = await this.health.ingestBatch(user.id, digestKey(input), {
      records,
    });
    return legacySuccess(result);
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
    const records = await this.healthRows(user.id, query, metrics, request.requestId);
    return legacySuccess(canonicalToLegacyDaily(records));
  }

  @Post("bodycomposition")
  saveBodyComposition(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: unknown,
  ) {
    return this.saveSpecialMetric(user.id, "body_composition", input);
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
  ) {
    return this.saveSpecialMetric(user.id, "blood_composition", input);
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
    const observedAt = validDate(data.date) ?? new Date();
    const record = {
      id: `legacy-ecg-${randomUUID()}`,
      metric: "ecg" as const,
      observedAt: observedAt.toISOString(),
      timezoneOffsetMinutes: -observedAt.getTimezoneOffset(),
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
    const result = await this.health.ingestBatch(user.id, digestKey(input), {
      records: [record],
    });
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
    return legacySuccess({ setting: JSON.stringify(metrics) });
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
      metrics: Array.isArray(body.setting) ? body.setting : [],
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
      { ...query, selectmember: String(relationship.recipient.compatibilityId) },
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

  @Get("notify/:id")
  async notification(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
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
  ) {
    const body = safeObject(input);
    const data = safeObject(body.data);
    const observedAt = validDate(data.date) ?? new Date();
    const result = await this.health.ingestBatch(userId, digestKey(input), {
      records: [
        {
          id: `legacy-${metric}-${randomUUID()}`,
          metric,
          observedAt: observedAt.toISOString(),
          timezoneOffsetMinutes: -observedAt.getTimezoneOffset(),
          values: scalarValues(data, ["date"]),
          quality: "unknown",
          source: { platform: "mini_program" },
        },
      ],
    });
    return legacySuccess(result);
  }

  private async previewSpecialMetric(
    userId: string,
    metric: HealthMetric,
    query: Record<string, string | undefined>,
    requestId: string,
  ) {
    const records = await this.healthRows(userId, query, [metric], requestId);
    return legacySuccess(
      records.map((record) => ({
        id: record.id,
        date: record.observedAt,
        ...safeObject(record.values),
        ...(record.ecgArtifact ? { ecgArtifact: record.ecgArtifact } : {}),
      })),
    );
  }

  private async healthRows(
    userId: string,
    query: Record<string, string | undefined>,
    metrics: HealthMetric[],
    requestId: string,
  ): Promise<Array<Record<string, any>>> {
    const bounds = dateBounds(query.date ?? query.day);
    const selectMember = query.selectmember?.trim();
    const result: Array<Record<string, any>> = [];
    if (selectMember) {
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
            bounds.from.toISOString(),
            bounds.to.toISOString(),
            requestId,
          );
          result.push(...records);
        } catch (error) {
          if (metrics.length === 1) throw error;
        }
      }
      return result.sort((a, b) =>
        String(b.observedAt).localeCompare(String(a.observedAt)),
      );
    }
    for (const metric of metrics) {
      const page = await this.health.list(userId, metric, 200, bounds.to.toISOString());
      result.push(
        ...page.items.filter(
          (record) => new Date(record.observedAt) >= bounds.from,
        ),
      );
    }
    return result.sort((a, b) =>
      String(b.observedAt).localeCompare(String(a.observedAt)),
    );
  }
}

function digestKey(input: unknown): string {
  return sha256(JSON.stringify(input));
}

function activityRecord(metric: HealthMetric, raw: unknown, unit: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const observedAt = new Date();
  return {
    id: `legacy-${metric}-${randomUUID()}`,
    metric,
    observedAt: observedAt.toISOString(),
    timezoneOffsetMinutes: -observedAt.getTimezoneOffset(),
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

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.valueOf()) ? null : date;
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
