import { Injectable, HttpException } from "@nestjs/common";
import {
  Prisma,
  type MemberHealthAnalysis,
  type HealthMetric,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  businessWritesPaused,
  healthReportWorkerEnabled,
  type HealthScreenDays,
  type HealthScoreRules,
  type HealthScreenResponse,
  type MemberAnalysisResult,
  type HealthAnalysisContent,
  type HealthScreenGroup,
  type ScreenProfileGate,
  type ScreenProfile,
  type HealthScreenMeasurementUpdate,
  type HealthScreenUpdates,
  healthMetricLabel,
  HEALTH_REFERENCE_DEFINITIONS,
  HEALTH_REFERENCE_CONTEXTS,
} from "@saydian/app-contracts";
import {
  healthScreenQwenEndpoint,
  ScreenAccumulator,
  screenPeriod,
  ageAt,
  authorizeScreen,
  analysisConsent,
  availableAnalysisCredits,
  consumeAnalysisCredit,
  lockReportCredits,
  HealthScreenError,
  object,
  hash,
  validateRules,
  draftRules,
  screenEnabled,
  displayRecord,
  recordDay,
  type ScreenActor,
  type ScreenRecord,
  validateReference,
  referenceScreenRecord,
  referencePublic,
  metricGroups,
  validScreenName,
  validScreenBirthday,
  validScreenWeight,
} from "@saydian/health-domain";
import { PrismaService } from "../common/prisma.service";
import { IntegrationSecretsService } from "../common/integration-secrets.service";
const TEMPLATE = "member-health-screen-v4-profile-score";
const json = (value: unknown) => value as Prisma.InputJsonValue;
const uuid = (id: string) => {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id,
    )
  )
    throw new HealthScreenError("invalid_id", "编号格式不正确", 400);
  return id;
};
function parseDays(input: unknown): HealthScreenDays {
  const days = Number(input || 7);
  if (![7, 30, 90].includes(days))
    throw new HealthScreenError("invalid_period", "仅支持7、30或90天", 400);
  return days as HealthScreenDays;
}
export function serializeAnalysis(
  row: MemberHealthAnalysis,
): MemberAnalysisResult {
  return {
    id: row.id,
    status: row.status as MemberAnalysisResult["status"],
    createdAt: row.createdAt.toISOString(),
    generatedAt: row.generatedAt?.toISOString() || null,
    period: row.period as unknown as MemberAnalysisResult["period"],
    inputDigest: row.inputDigest,
    ruleVersion: row.ruleVersion,
    content:
      row.status === "READY"
        ? (row.content as unknown as HealthAnalysisContent)
        : null,
    failureReason:
      row.status === "FAILED" || row.status === "REVOKED"
        ? "分析未完成，次数已按规则退回；请刷新后重试"
        : null,
  };
}
@Injectable()
export class HealthScreenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: IntegrationSecretsService,
  ) {}
  async handle<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HealthScreenError)
        throw new HttpException(
          { errorKey: error.code, message: error.message },
          error.status,
        );
      throw error;
    }
  }
  async entry(actor: ScreenActor) {
    return this.handle(async () => {
      if (actor.type === "ADMIN") {
        const a = await this.prisma.adminUser.findUnique({
          where: { id: actor.id },
        });
        if (
          !a?.active ||
          !(a.roles.length ? a.roles : [a.role]).some((r) =>
            ["SUPER_ADMIN", "HEALTH_AUDITOR"].includes(r),
          )
        )
          return { enabled: false };
      } else if (actor.type === "PARTNER") {
        const p = await this.prisma.brandPartner.findUnique({
          where: { id: actor.id },
          include: { level: true },
        });
        if (!p?.active || !p.level.active || p.level.code !== "distribution-1")
          return { enabled: false };
      }
      return { enabled: await screenEnabled(this.prisma) };
    });
  }
  private profileView(
    access: Awaited<ReturnType<typeof authorizeScreen>>,
    actor: ScreenActor,
  ): ScreenProfileGate {
    const canComplete = access.bypass || actor.type === "MEMBER";
    const nick = access.member.nickname;
    return {
      ...access.gate,
      memberNo: access.member.compatibilityId,
      revision: hash([access.member.id, access.gate.profile]),
      canComplete,
      suggestedName:
        canComplete &&
        !access.gate.profile.name &&
        validScreenName(nick) &&
        !/^(赛电会员|未命名会员|微信用户|会员\d*)$/.test(nick)
          ? nick
          : "",
    };
  }
  async profileGate(id: string, actor: ScreenActor, requestId?: string) {
    return this.handle(() =>
      this.prisma.$transaction(async (tx) => {
        const access = await authorizeScreen(tx, actor, uuid(id), true, false);
        await this.audit(
          tx,
          actor,
          id,
          "MEMBER_HEALTH_SCREEN_PROFILE_READ",
          requestId,
        );
        return this.profileView(access, actor);
      }),
    );
  }
  async completeProfile(
    id: string,
    input: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(() =>
      this.prisma.$transaction(async (tx) => {
        uuid(id);
        if (businessWritesPaused(process.env))
          throw new HealthScreenError("writes_paused", "当前暂停资料录入");
        if (actor.type === "MEMBER" && actor.id !== id)
          throw new HealthScreenError("forbidden", "只能完善自己的资料");
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
        const access = await authorizeScreen(tx, actor, id, true, false);
        if (!access.bypass && actor.type !== "MEMBER")
          throw new HealthScreenError(
            "forbidden",
            "请由会员本人或总管理员修改基本资料",
          );
        const { expectedRevision, ...fields } = object(input);
        const keys = Object.keys(fields);
        const current = access.gate.profile;
        const allKeys = [
          "name",
          "gender",
          "birthday",
          "weightKg",
          "heightCm",
        ] as const;
        if (keys.some((k) => !allKeys.some((key) => key === k)))
          throw new HealthScreenError(
            "invalid_profile",
            "只能修改会员基本资料",
            400,
          );
        const editing = expectedRevision !== undefined;
        if (
          editing &&
          expectedRevision !== this.profileView(access, actor).revision
        )
          throw new HealthScreenError(
            "profile_changed",
            "会员资料已被更新，请重新载入后再修改",
            409,
          );
        const changed = allKeys.filter(
          (k) => Object.hasOwn(fields, k) && fields[k] !== current[k],
        );
        if (
          !editing &&
          changed.some(
            (k) => k === "heightCm" || !access.gate.missing.includes(k),
          )
        )
          throw new HealthScreenError(
            "profile_changed",
            "资料已更新，请重新核对",
            409,
          );
        const values = { ...current, ...fields };
        if (
          !validScreenName(values.name) ||
          !["MALE", "FEMALE"].includes(values.gender) ||
          !validScreenBirthday(values.birthday, access.day) ||
          !validScreenWeight(values.weightKg)
        )
          throw new HealthScreenError(
            "invalid_profile",
            "请填写姓名、性别、有效出生日期和体重（0.1–500 千克）",
            400,
          );
        if (
          changed.includes("heightCm") &&
          values.heightCm !== null &&
          (typeof values.heightCm !== "number" ||
            !Number.isFinite(values.heightCm) ||
            values.heightCm < 50 ||
            values.heightCm > 250 ||
            Math.abs(
              values.heightCm * 100 - Math.round(values.heightCm * 100),
            ) > 1e-7)
        )
          throw new HealthScreenError(
            "invalid_profile",
            "身高可留空，或填写50至250厘米并最多保留两位小数",
            400,
          );
        if (changed.length) {
          if (changed.includes("name"))
            await tx.healthProfile.upsert({
              where: { userId: id },
              create: { userId: id, screenName: values.name.trim() },
              update: { screenName: values.name.trim() },
            });
          const update = {
            ...(changed.includes("gender") ? { gender: values.gender } : {}),
            ...(changed.includes("birthday")
              ? { birthday: new Date(values.birthday + "T00:00:00Z") }
              : {}),
            ...(changed.includes("weightKg")
              ? { weightKg: values.weightKg }
              : {}),
            ...(changed.includes("heightCm")
              ? { heightCm: values.heightCm }
              : {}),
          };
          if (Object.keys(update).length)
            await tx.user.update({ where: { id }, data: update });
          await this.audit(
            tx,
            actor,
            id,
            editing
              ? "MEMBER_HEALTH_SCREEN_PROFILE_UPDATED"
              : "MEMBER_HEALTH_SCREEN_PROFILE_COMPLETED",
            requestId,
            { fields: changed },
          );
        }
        return this.profileView(
          await authorizeScreen(tx, actor, id, false),
          actor,
        );
      }),
    );
  }
  private async audit(
    tx: Prisma.TransactionClient,
    actor: ScreenActor,
    memberId: string,
    action: string,
    requestId?: string,
    extra: Record<string, unknown> = {},
  ) {
    await tx.auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id,
        action,
        entityType: "MEMBER_HEALTH_ANALYSIS",
        entityId: memberId,
        afterJson: json(extra),
        ...(requestId ? { requestId } : {}),
      },
    });
  }
  private where(
    userId: string,
    period: ReturnType<typeof screenPeriod>,
    now: Date,
  ): Prisma.HealthRecordWhereInput {
    return {
      userId,
      OR: [
        {
          aggregationKind: null,
          observedAt: {
            gte: new Date(Date.parse(period.from) - 2 * 86400000),
            lt: new Date(period.to),
            lte: now,
          },
        },
        {
          aggregationKind: "daily_summary",
          aggregationActive: true,
          aggregationLocalDate: {
            gte: period.dates[0]!,
            lte: period.dates.at(-1)!,
          },
          observedAt: { lte: now },
        },
      ],
    };
  }
  private async aggregate(
    tx: Prisma.TransactionClient,
    member: Awaited<ReturnType<typeof authorizeScreen>>["member"],
    days: HealthScreenDays,
    override?: { rules: HealthScoreRules; version: number },
  ) {
    const now = new Date(),
      period = screenPeriod(days, member.healthProfile?.timezone, now);
    const rule =
      override ||
      (await tx.healthScoreRuleVersion.findFirst({
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
      }));
    const accumulator = new ScreenAccumulator(period);
    let cursor: string | undefined;
    for (;;) {
      const rows = await tx.healthRecord.findMany({
        where: this.where(member.id, period, now),
        orderBy: { id: "asc" },
        take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const row of rows) accumulator.add(row);
      if (rows.length < 1000) break;
      cursor = rows.at(-1)!.id;
    }
    const subject = {
      age: ageAt(member.birthday, period),
      gender: member.gender,
    };
    let referenceCursor: string | undefined;
    for (;;) {
      const references = await tx.memberHealthReference.findMany({
        where: {
          userId: member.id,
          voidedAt: null,
          observedAt: {
            gte: new Date(period.from),
            lt: new Date(period.to),
            lte: now,
          },
        },
        orderBy: { id: "asc" },
        take: 1000,
        ...(referenceCursor
          ? { cursor: { id: referenceCursor }, skip: 1 }
          : {}),
      });
      for (const row of references) accumulator.add(referenceScreenRecord(row));
      if (references.length < 1000) break;
      referenceCursor = references.at(-1)!.id;
    }
    const facts = accumulator.finish(
      rule ? validateRules(rule.rules) : null,
      rule?.version || null,
      subject,
    );
    // Version changes invalidate reusable AI snapshots; display fetch time does not.
    facts.dataDigest = hash([facts.dataDigest, TEMPLATE]);
    return { facts, evidenceIndex: accumulator.evidenceIndex, subject };
  }
  private async availability(
    tx: Prisma.TransactionClient,
    userId: string,
    bypass: boolean,
    facts: { coverageDays: number; series: unknown[] },
    covered = false,
  ) {
    const reasons: string[] = [];
    let consent: string | null = null;
    try {
      consent = await analysisConsent(tx, userId, bypass);
    } catch (e) {
      if (e instanceof HealthScreenError) reasons.push(e.message);
      else throw e;
    }
    const credits = await availableAnalysisCredits(tx, userId);
    if (!bypass && !covered && credits < 1)
      reasons.push("没有可用的健康报告次数");
    if (facts.coverageDays < 3 || !facts.series.length)
      reasons.push("至少需要3天可查看的指标记录；待核实数据仅作描述，不作评估");
    if (
      businessWritesPaused(process.env) ||
      !healthReportWorkerEnabled(process.env)
    )
      reasons.push("健康分析任务当前暂停");
    if (/^(true|1)$/i.test(process.env.H5_DEMO_ENABLED || ""))
      reasons.push("演示环境不调用真实 AI 服务");
    const config = await tx.integrationConfig.findUnique({
        where: { key: "ai" },
      }),
      pub = object(config?.publicConfig);
    if (
      config?.state !== "CONFIGURED" ||
      String(pub.provider || process.env.AI_PROVIDER || "disabled") ===
        "disabled"
    )
      reasons.push("AI 服务尚未配置");
    return {
      canGenerate: reasons.length === 0,
      reasons,
      credits,
      consentBypass: bypass,
      creditBypass: bypass,
      consent,
    };
  }
  async load(
    memberId: string,
    daysInput: unknown,
    actor: ScreenActor,
    requestId?: string,
  ): Promise<HealthScreenResponse> {
    return this.handle(async () => {
      uuid(memberId);
      const days = parseDays(daysInput);
      return this.prisma.$transaction(
        async (tx) => {
          const { member, bypass } = await authorizeScreen(
              tx,
              actor,
              memberId,
              true,
            ),
            { facts, subject } = await this.aggregate(tx, member, days);
          let consent: string | null = null;
          try {
            consent = await analysisConsent(tx, memberId, bypass);
          } catch (e) {
            if (!(e instanceof HealthScreenError)) throw e;
          }
          const latest = consent
            ? await tx.memberHealthAnalysis.findFirst({
                where: {
                  userId: memberId,
                  windowDays: days,
                  consentSnapshot: consent,
                  consentBypass: bypass,
                  status: { not: "REVOKED" },
                },
                orderBy: { createdAt: "desc" },
              })
            : null;
          const availability = await this.availability(
            tx,
            memberId,
            bypass,
            facts,
            latest?.inputDigest === facts.dataDigest &&
              ["READY", "GENERATING", "QUEUED"].includes(latest.status),
          );
          await this.audit(
            tx,
            actor,
            memberId,
            "MEMBER_HEALTH_SCREEN_READ",
            requestId,
            { days, recordCount: facts.recordCount },
          );
          const { consent: _consent, ...publicAvailability } = availability;
          return {
            ...facts,
            member: {
              id: member.id,
              memberNo: member.compatibilityId,
              nickname: member.healthProfile!.screenName!,
              weightKg: Number(member.weightKg),
              heightCm: member.heightCm ? Number(member.heightCm) : null,
              gender: member.gender,
              age: subject.age,
            },
            analysis: latest ? serializeAnalysis(latest) : null,
            analysisStale: !!latest && latest.inputDigest !== facts.dataDigest,
            availability: publicAvailability,
            fetchedAt: new Date().toISOString(),
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 45000,
        },
      );
    });
  }
  async updates(
    memberId: string,
    daysInput: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(() =>
      this.prisma.$transaction(async (tx) => {
        uuid(memberId);
        const { member } = await authorizeScreen(tx, actor, memberId, true);
        const days = parseDays(daysInput),
          now = new Date(),
          period = screenPeriod(days, member.healthProfile?.timezone, now);
        const device = await tx.healthRecord.groupBy({
          by: ["metric"],
          where: this.where(memberId, period, now),
          _count: { _all: true },
          _max: { updatedAt: true },
        });
        // Include voided references in the revision so a withdrawal invalidates the display too.
        const referenceWhere = {
          userId: memberId,
          observedAt: {
            gte: new Date(period.from),
            lt: new Date(period.to),
            lte: now,
          },
        };
        const references = await tx.memberHealthReference.groupBy({
          by: ["metric", "method", "context", "unit"],
          where: referenceWhere,
          _count: { _all: true },
          _max: { updatedAt: true },
        });
        const groups = new Map<
          HealthScreenGroup,
          HealthScreenUpdates["groups"][number]
        >();
        for (const row of [...device, ...references]) {
          const group = metricGroups[row.metric];
          if (!group || !row._max.updatedAt) continue;
          const value = groups.get(group) || {
            group,
            count: 0,
            updatedAt: "",
            measurements: [],
          };
          value.count += row._count._all;
          value.updatedAt = [value.updatedAt, row._max.updatedAt.toISOString()]
            .sort()
            .at(-1)!;
          groups.set(group, value);
        }
        const measurement = (
          row: ScreenRecord,
          key: string,
          kind: "device" | "reference",
          label: string,
          withdrawn = false,
        ): HealthScreenMeasurementUpdate => ({
          key,
          kind,
          label,
          metric: row.metric,
          revision: hash([
            row.id,
            row.updatedAt.toISOString(),
            row.values,
            row.unit,
            withdrawn,
          ]),
          measuredAt: row.observedAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          withdrawn,
          values: withdrawn
            ? []
            : displayRecord(row).values.map(
                ({ reason: _reason, ...value }) => value,
              ),
        });
        // Pick by upload/update time, not the period average or most recent
        // observation time: a newly uploaded historical reading must show its own value.
        for (const version of device) {
          const group = metricGroups[version.metric];
          if (!group || !version._max.updatedAt) continue;
          const row = await tx.healthRecord.findFirst({
            where: {
              AND: [
                this.where(memberId, period, now),
                { metric: version.metric, updatedAt: version._max.updatedAt },
              ],
            },
            orderBy: [{ observedAt: "desc" }, { id: "desc" }],
          });
          if (row)
            groups
              .get(group)!
              .measurements!.push(
                measurement(
                  row,
                  "device:" + row.metric,
                  "device",
                  healthMetricLabel(row.metric),
                ),
              );
        }
        for (const version of references) {
          const group = metricGroups[version.metric];
          if (!group || !version._max.updatedAt) continue;
          const row = await tx.memberHealthReference.findFirst({
            where: {
              ...referenceWhere,
              metric: version.metric,
              method: version.method,
              context: version.context,
              unit: version.unit,
              updatedAt: version._max.updatedAt,
            },
            orderBy: [{ observedAt: "desc" }, { id: "desc" }],
          });
          if (!row) continue;
          const def =
            HEALTH_REFERENCE_DEFINITIONS[
              row.metric as keyof typeof HEALTH_REFERENCE_DEFINITIONS
            ];
          const context =
            row.context === "RESTING"
              ? ""
              : HEALTH_REFERENCE_CONTEXTS[row.context] || "";
          groups
            .get(group)!
            .measurements!.push(
              measurement(
                referenceScreenRecord(row),
                [
                  "reference",
                  row.metric,
                  row.method,
                  row.context,
                  row.unit,
                ].join(":"),
                "reference",
                context +
                  (def?.label || healthMetricLabel(row.metric)) +
                  "参考值",
                !!row.voidedAt,
              ),
            );
        }
        await this.audit(
          tx,
          actor,
          memberId,
          "MEMBER_HEALTH_SCREEN_UPDATES_READ",
          requestId,
          { days },
        );
        return { groups: [...groups.values()] };
      }),
    );
  }
  async references(
    memberId: string,
    cursor: string | undefined,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(() =>
      this.prisma.$transaction(async (tx) => {
        uuid(memberId);
        await authorizeScreen(tx, actor, memberId, true);
        if (
          cursor &&
          !(await tx.memberHealthReference.findFirst({
            where: { id: uuid(cursor), userId: memberId },
            select: { id: true },
          }))
        )
          throw new HealthScreenError("invalid_cursor", "分页位置无效", 400);
        const rows = await tx.memberHealthReference.findMany({
          where: { userId: memberId },
          orderBy: [{ observedAt: "desc" }, { id: "desc" }],
          take: 51,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        await this.audit(
          tx,
          actor,
          memberId,
          "MEMBER_HEALTH_REFERENCE_READ",
          requestId,
          { count: Math.min(rows.length, 50) },
        );
        return {
          items: rows.slice(0, 50).map((row) => ({
            ...referencePublic(row),
            canVoid:
              !row.voidedAt &&
              (actor.type !== "MEMBER" ||
                (row.actorType === "MEMBER" && row.actorId === actor.id)),
          })),
          nextCursor: rows.length > 50 ? rows[49]!.id : null,
        };
      }),
    );
  }
  async saveReference(
    memberId: string,
    raw: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(async () => {
      uuid(memberId);
      if (businessWritesPaused(process.env))
        throw new HealthScreenError("writes_paused", "当前暂停资料录入");
      let input: ReturnType<typeof validateReference>;
      try {
        input = validateReference(raw);
      } catch (e) {
        throw new HealthScreenError(
          "invalid_reference",
          (e as Error).message,
          400,
        );
      }
      const { requestKey, ...values } = input;
      const inputDigest = hash([memberId, actor, values]);
      return this.prisma.$transaction(async (tx) => {
        await authorizeScreen(tx, actor, memberId, true);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"health-reference:" + requestKey}, 0))`;
        const existing = await tx.memberHealthReference.findUnique({
          where: { requestKey },
        });
        if (existing) {
          if (existing.inputDigest !== inputDigest)
            throw new HealthScreenError(
              "request_conflict",
              "请求已处理，请重新打开录入窗口",
              409,
            );
          return referencePublic(existing);
        }
        const row = await tx.memberHealthReference.create({
          data: {
            userId: memberId,
            metric: input.metric,
            observedAt: new Date(input.measuredAt),
            unit: input.unit,
            values: json(input.values),
            method: input.method,
            context: input.context,
            actorType: actor.type,
            actorId: actor.id,
            requestKey,
            inputDigest,
          },
        });
        await this.audit(
          tx,
          actor,
          memberId,
          "MEMBER_HEALTH_REFERENCE_CREATE",
          requestId,
          { referenceId: row.id, metric: row.metric, method: row.method },
        );
        return referencePublic(row);
      });
    });
  }
  async voidReference(
    memberId: string,
    id: string,
    raw: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(() =>
      this.prisma.$transaction(async (tx) => {
        uuid(memberId);
        uuid(id);
        if (businessWritesPaused(process.env))
          throw new HealthScreenError("writes_paused", "当前暂停资料修改");
        await authorizeScreen(tx, actor, memberId, true);
        const reason = String(object(raw).reason || "").trim();
        if (reason.length < 5 || reason.length > 200)
          throw new HealthScreenError(
            "reason_required",
            "请填写5至200字的撤销原因",
            400,
          );
        const row = await tx.memberHealthReference.findFirst({
          where: { id, userId: memberId },
        });
        if (!row)
          throw new HealthScreenError(
            "reference_missing",
            "参考记录不存在",
            404,
          );
        if (
          actor.type === "MEMBER" &&
          (row.actorType !== "MEMBER" || row.actorId !== actor.id)
        )
          throw new HealthScreenError(
            "reference_read_only",
            "只能撤销本人录入的参考值",
          );
        if (!row.voidedAt) {
          const changed = await tx.memberHealthReference.updateMany({
            where: { id, voidedAt: null },
            data: {
              voidedAt: new Date(),
              voidedBy: actor.id,
              voidReason: reason,
            },
          });
          if (changed.count)
            await this.audit(
              tx,
              actor,
              memberId,
              "MEMBER_HEALTH_REFERENCE_VOID",
              requestId,
              { referenceId: id, reason },
            );
        }
        return referencePublic(
          await tx.memberHealthReference.findUniqueOrThrow({ where: { id } }),
        );
      }),
    );
  }
  async records(
    memberId: string,
    input: { days?: string; metric?: string; cursor?: string; reason?: string },
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(async () => {
      uuid(memberId);
      const days = parseDays(input.days);
      if (input.cursor) uuid(input.cursor);
      if (
        input.metric &&
        ![
          "HEART_RATE",
          "BLOOD_PRESSURE",
          "HRV",
          "BLOOD_OXYGEN",
          "SLEEP",
          "STEPS",
          "DISTANCE",
          "CALORIES",
          "TEMPERATURE",
          "BLOOD_GLUCOSE",
        ].includes(input.metric)
      )
        throw new HealthScreenError("invalid_metric", "指标无效", 400);
      return this.prisma.$transaction(
        async (tx) => {
          const { member, bypass } = await authorizeScreen(
            tx,
            actor,
            memberId,
            true,
          );
          if (
            actor.type === "ADMIN" &&
            !bypass &&
            (input.reason?.trim().length || 0) < 5
          )
            throw new HealthScreenError(
              "reason_required",
              "请填写至少5个字的测量记录查看原因",
              400,
            );
          if (
            input.cursor &&
            !(await tx.healthRecord.findFirst({
              where: { id: input.cursor, userId: memberId },
              select: { id: true },
            }))
          )
            throw new HealthScreenError(
              "invalid_cursor",
              "分页位置已失效，请重新查询",
              400,
            );
          const now = new Date(),
            period = screenPeriod(days, member.healthProfile?.timezone, now),
            items = [];
          let cursor = input.cursor,
            exhausted = false;
          while (items.length < 51 && !exhausted) {
            const rows = await tx.healthRecord.findMany({
              where: {
                ...this.where(memberId, period, now),
                ...(input.metric
                  ? { metric: input.metric as HealthMetric }
                  : {}),
              },
              orderBy: [{ observedAt: "desc" }, { id: "desc" }],
              take: 200,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            });
            for (const row of rows) {
              if (period.dates.includes(recordDay(row, period)))
                items.push(displayRecord(row));
              if (items.length === 51) break;
            }
            exhausted = rows.length < 200;
            cursor = rows.at(-1)?.id;
          }
          const more = items.length > 50;
          const page = items.slice(0, 50);
          await this.audit(
            tx,
            actor,
            memberId,
            "MEMBER_HEALTH_SCREEN_RECORDS_READ",
            requestId,
            {
              days,
              metric: input.metric || "all",
              count: page.length,
              reason: input.reason?.slice(0, 200) || "伙伴健康数据核对",
            },
          );
          return { items: page, nextCursor: more ? page.at(-1)!.id : null };
        },
        { timeout: 30000 },
      );
    });
  }
  async generate(
    memberId: string,
    input: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(async () => {
      uuid(memberId);
      const body = object(input),
        days = parseDays(body.days);
      uuid(String(body.requestKey || ""));
      if (
        typeof body.inputDigest !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.inputDigest)
      )
        throw new HealthScreenError("invalid_digest", "请先加载会员数据", 400);
      // Validate locally configured credentials before any debit; never probe the provider here.
      const secrets = await this.secrets.resolve("ai", {
        apiKey: "AI_API_KEY",
        baseUrl: "AI_BASE_URL",
        model: "AI_MODEL",
      });
      const config = await this.prisma.integrationConfig.findUnique({
        where: { key: "ai" },
      });
      const pub = object(config?.publicConfig);
      try {
        const u = new URL(String(pub.baseUrl || secrets.baseUrl || ""));
        if (
          !secrets.apiKey ||
          !healthScreenQwenEndpoint(u.href) ||
          !String(pub.model || secrets.model || "").startsWith("qwen")
        )
          throw Error();
      } catch {
        throw new HealthScreenError(
          "ai_unconfigured",
          "AI 服务凭据尚未完整配置",
          409,
        );
      }
      return this.prisma.$transaction(
        async (tx) => {
          await lockReportCredits(tx, memberId);
          const { member, bypass } = await authorizeScreen(
              tx,
              actor,
              memberId,
              true,
            ),
            consent = await analysisConsent(tx, memberId, bypass, true);
          const previous = await tx.memberHealthAnalysis.findUnique({
            where: { requestKey: body.requestKey },
          });
          if (previous) {
            if (
              previous.userId !== memberId ||
              previous.actorId !== actor.id ||
              previous.actorType !== actor.type ||
              previous.inputDigest !== body.inputDigest ||
              previous.windowDays !== days
            )
              throw new HealthScreenError(
                "request_conflict",
                "同一请求编号不能用于不同分析",
                409,
              );
            if (previous.consentSnapshot !== consent)
              throw new HealthScreenError(
                "consent_changed",
                "会员分析授权已变化，请重新发起",
                409,
              );
            await this.audit(
              tx,
              actor,
              memberId,
              "MEMBER_HEALTH_ANALYSIS_REUSED",
              requestId,
              { analysisId: previous.id },
            );
            return serializeAnalysis(previous);
          }
          const { facts, evidenceIndex } = await this.aggregate(
            tx,
            member,
            days,
          );
          if (facts.dataDigest !== body.inputDigest)
            throw new HealthScreenError(
              "data_changed",
              "会员数据或评分规则已更新，请刷新后重新分析",
              409,
            );
          const existing = await tx.memberHealthAnalysis.findFirst({
            where: {
              userId: memberId,
              inputDigest: facts.dataDigest,
              consentSnapshot: consent,
              consentBypass: bypass,
              status: { in: ["QUEUED", "GENERATING", "READY"] },
            },
            orderBy: { createdAt: "desc" },
          });
          const available = await this.availability(
            tx,
            memberId,
            bypass,
            facts,
            !!existing,
          );
          if (!available.canGenerate)
            throw new HealthScreenError(
              "analysis_unavailable",
              available.reasons.join("；"),
              409,
            );
          if (existing) {
            await this.audit(
              tx,
              actor,
              memberId,
              "MEMBER_HEALTH_ANALYSIS_REUSED",
              requestId,
              { analysisId: existing.id },
            );
            return serializeAnalysis(existing);
          }
          const id = randomUUID();
          const result = await tx.memberHealthAnalysis.create({
            data: {
              id,
              userId: memberId,
              actorType: actor.type,
              actorId: actor.id,
              consentBypass: bypass,
              consentSnapshot: consent,
              requestKey: body.requestKey,
              inputDigest: facts.dataDigest,
              windowDays: days,
              period: json(facts.period),
              facts: json(facts),
              evidenceIndex: json(evidenceIndex),
              scoreSnapshot: json(facts.score),
              ruleVersion: facts.score.version,
              templateVersion: TEMPLATE,
            },
          });
          if (!bypass) await consumeAnalysisCredit(tx, memberId, id);
          await tx.outboxEvent.create({
            data: {
              eventId: `member-health-analysis:${id}`,
              eventType: "member_health_analysis_generate",
              aggregateType: "member_health_analysis",
              aggregateId: id,
              payload: { analysisId: id },
            },
          });
          await this.audit(
            tx,
            actor,
            memberId,
            "MEMBER_HEALTH_ANALYSIS_CREATED",
            requestId,
            {
              analysisId: id,
              consentBypass: bypass,
              creditBypass: bypass,
              days,
              ruleVersion: facts.score.version,
            },
          );
          return serializeAnalysis(result);
        },
        { timeout: 60000 },
      );
    });
  }
  async result(
    memberId: string,
    id: string,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(async () => {
      uuid(memberId);
      uuid(id);
      return this.prisma.$transaction(async (tx) => {
        const { bypass } = await authorizeScreen(tx, actor, memberId, true),
          consent = await analysisConsent(tx, memberId, bypass);
        const result = await tx.memberHealthAnalysis.findFirst({
          where: {
            id,
            userId: memberId,
            consentSnapshot: consent,
            consentBypass: bypass,
          },
        });
        if (!result)
          throw new HealthScreenError(
            "not_found",
            "分析结果不存在或授权已变化",
            404,
          );
        await this.audit(
          tx,
          actor,
          memberId,
          "MEMBER_HEALTH_ANALYSIS_READ",
          requestId,
          { analysisId: id },
        );
        return serializeAnalysis(result);
      });
    });
  }
  async rules(actor: ScreenActor) {
    return this.handle(async () => {
      await this.ruleAdmin(actor, false);
      return {
        enabled: await screenEnabled(this.prisma),
        items: await this.prisma.healthScoreRuleVersion.findMany({
          orderBy: { version: "desc" },
          take: 100,
        }),
      };
    });
  }
  private async ruleAdmin(
    actor: ScreenActor,
    write = true,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const admin =
      actor.type === "ADMIN"
        ? await tx.adminUser.findUnique({ where: { id: actor.id } })
        : null;
    const roles = admin
      ? admin.roles.length
        ? admin.roles
        : [admin.role]
      : [];
    if (
      !admin?.active ||
      !roles.some(
        (r) => r === "SUPER_ADMIN" || (!write && r === "HEALTH_AUDITOR"),
      )
    )
      throw new HealthScreenError("forbidden", "没有评分规则管理权限");
  }
  async saveRules(input: unknown, actor: ScreenActor, requestId?: string) {
    return this.handle(async () => {
      const body = object(input);
      const rules = body.rules ? validateRules(body.rules) : draftRules();
      return this.prisma.$transaction(async (tx) => {
        await this.ruleAdmin(actor, true, tx);
        let row;
        if (body.id) {
          uuid(body.id);
          const changed = await tx.healthScoreRuleVersion.updateMany({
            where: { id: body.id, status: "DRAFT" },
            data: { rules: json(rules) },
          });
          if (changed.count !== 1)
            throw new HealthScreenError(
              "immutable_rule",
              "已发布规则不可修改，请复制为新草稿",
              409,
            );
          row = await tx.healthScoreRuleVersion.findUniqueOrThrow({
            where: { id: body.id },
          });
        } else
          row = await tx.healthScoreRuleVersion.create({
            data: { rules: json(rules), createdBy: actor.id },
          });
        await this.audit(
          tx,
          actor,
          row.id,
          "HEALTH_SCORE_RULE_DRAFT_SAVED",
          requestId,
          { version: row.version },
        );
        return row;
      });
    });
  }
  async publish(
    id: string,
    input: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(async () => {
      uuid(id);
      if (object(input).reviewed !== true)
        throw new HealthScreenError(
          "review_required",
          "请确认已审核评分依据与适用范围",
          400,
        );
      return this.prisma.$transaction(async (tx) => {
        await this.ruleAdmin(actor, true, tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('health-score-publish',0))`;
        const row = await tx.healthScoreRuleVersion.findUnique({
          where: { id },
        });
        if (!row || row.status !== "DRAFT")
          throw new HealthScreenError("invalid_state", "只能发布草稿", 409);
        if (object(input).expectedUpdatedAt !== row.updatedAt.toISOString())
          throw new HealthScreenError(
            "rule_changed",
            "草稿已变化，请重新加载并审核",
            409,
          );
        validateRules(row.rules, true);
        await tx.healthScoreRuleVersion.updateMany({
          where: { status: "PUBLISHED" },
          data: { status: "ARCHIVED" },
        });
        const changed = await tx.healthScoreRuleVersion.updateMany({
          where: { id, status: "DRAFT", updatedAt: row.updatedAt },
          data: {
            status: "PUBLISHED",
            publishedAt: new Date(),
            publishedBy: actor.id,
          },
        });
        if (changed.count !== 1)
          throw new HealthScreenError(
            "rule_changed",
            "草稿已被修改，请重新审核",
            409,
          );
        await this.audit(
          tx,
          actor,
          id,
          "HEALTH_SCORE_RULE_PUBLISHED",
          requestId,
          { version: row.version },
        );
        return tx.healthScoreRuleVersion.findUniqueOrThrow({ where: { id } });
      });
    });
  }
  async preview(
    id: string,
    input: unknown,
    actor: ScreenActor,
    requestId?: string,
  ) {
    return this.handle(async () => {
      uuid(id);
      const body = object(input),
        memberId = uuid(String(body.memberId || ""));
      return this.prisma.$transaction(
        async (tx) => {
          await this.ruleAdmin(actor, false, tx);
          const { member } = await authorizeScreen(tx, actor, memberId, true);
          const row = await tx.healthScoreRuleVersion.findUnique({
            where: { id },
          });
          if (!row) throw new HealthScreenError("not_found", "规则不存在", 404);
          const rules = validateRules(row.rules, true),
            result = await this.aggregate(tx, member, parseDays(body.days), {
              rules,
              version: row.version,
            });
          await this.audit(
            tx,
            actor,
            memberId,
            "HEALTH_SCORE_RULE_PREVIEW",
            requestId,
            { version: row.version },
          );
          return { preview: true, score: result.facts.score };
        },
        { timeout: 45000 },
      );
    });
  }
  async settings(input: unknown, actor: ScreenActor, requestId?: string) {
    return this.handle(async () => {
      const enabled = object(input).enabled;
      if (typeof enabled !== "boolean")
        throw new HealthScreenError("invalid_input", "请选择开放状态", 400);
      return this.prisma.$transaction(async (tx) => {
        await this.ruleAdmin(actor, true, tx);
        await tx.appSetting.upsert({
          where: { key: "member_health_screen" },
          create: {
            key: "member_health_screen",
            value: { enabled },
            public: false,
          },
          update: { value: { enabled }, public: false },
        });
        await this.audit(
          tx,
          actor,
          "member_health_screen",
          "MEMBER_HEALTH_SCREEN_SETTING_CHANGED",
          requestId,
          { enabled },
        );
        return { enabled };
      });
    });
  }
}
