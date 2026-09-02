import {
  DataQuality,
  HealthMetric,
  Prisma,
  PrismaClient,
  UserStatus,
} from "@prisma/client";
import type { Connection, RowDataPacket } from "mysql2/promise";
import type { HealthSourceMap, MigrationMap, TableColumnMap } from "./config";

type LegacyRow = RowDataPacket & Record<string, unknown>;

export class LegacyMigrator {
  constructor(
    private readonly source: Connection,
    private readonly target: PrismaClient,
    private readonly map: MigrationMap,
  ) {}

  async inspect(): Promise<Record<string, unknown>> {
    const [tables] = await this.source.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS name, TABLE_ROWS AS estimatedRows FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
    );
    const [columns] = await this.source.query<RowDataPacket[]>(
      "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
    );
    return {
      sourceLabel: this.map.sourceLabel,
      tables,
      columns,
      inspectedAt: new Date().toISOString(),
      note: "只读取结构与估算行数，不读取密码、Token 或健康内容",
    };
  }

  async migrate(): Promise<Record<string, unknown>> {
    const run = await this.target.migrationRun.create({
      data: {
        sourceLabel: this.map.sourceLabel,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    const report: {
      users: MigrationCounters;
      health: Record<string, MigrationCounters>;
    } = {
      users: counters(),
      health: {},
    };
    try {
      let cursor: string | number =
        this.map.member.idType === "string" ? "" : 0;
      while (true) {
        const rows = await this.readMemberChunk(this.map.member, cursor, 500);
        if (rows.length === 0) break;
        for (const row of rows) {
          const legacyId = String(row[this.map.member.id]);
          cursor =
            this.map.member.idType === "string"
              ? legacyId
              : Number(legacyId) || cursor;
          const outcome = await this.migrateMember(run.id, row, this.map.member);
          report.users[outcome] += 1;
        }
      }
      for (const source of this.map.healthSources) {
        const sourceReport = counters();
        report.health[source.table] = sourceReport;
        let cursor: string | number = source.idType === "string" ? "" : 0;
        while (true) {
          const rows = await this.readChunk(source.table, source.id, cursor, 500);
          if (rows.length === 0) break;
          for (const row of rows) {
            const legacyId = String(row[source.id]);
            cursor =
              source.idType === "string"
                ? legacyId
                : Number(legacyId) || cursor;
            const outcome = await this.migrateHealthRecord(run.id, row, source);
            sourceReport[outcome] += 1;
          }
        }
      }
      await this.target.migrationRun.update({
        where: { id: run.id },
        data: {
          status: "VERIFYING",
          report: report as unknown as Prisma.InputJsonValue,
        },
      });
      return { runId: run.id, ...report };
    } catch (error) {
      await this.target.migrationRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          report: {
            ...report,
            error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
          },
        },
      });
      throw error;
    }
  }

  async verify(runId?: string): Promise<Record<string, unknown>> {
    const run = runId
      ? await this.target.migrationRun.findUniqueOrThrow({ where: { id: runId } })
      : await this.target.migrationRun.findFirstOrThrow({
          where: { sourceLabel: this.map.sourceLabel },
          orderBy: { createdAt: "desc" },
        });
    const userVerification = await this.verifyMappedTable(
      run.id,
      "user",
      this.map.member.table,
      this.map.member.id,
    );
    const healthVerification = await Promise.all(
      this.map.healthSources.map((source) =>
        this.verifyMappedTable(
          run.id,
          "health_record",
          source.table,
          source.id,
        ),
      ),
    );
    const matched =
      userVerification.matched &&
      healthVerification.every((item) => item.matched);
    const report = {
      runId: run.id,
      users: userVerification,
      health: Object.fromEntries(
        healthVerification.map((item) => [item.sourceTable, item]),
      ),
      verifiedAt: new Date().toISOString(),
      matched,
    };
    await this.target.migrationRun.update({
      where: { id: run.id },
      data: {
        status: report.matched ? "COMPLETED" : "FAILED",
        completedAt: new Date(),
        report: report as unknown as Prisma.InputJsonValue,
      },
    });
    return report;
  }

  private async readMemberChunk(
    map: TableColumnMap,
    cursor: string | number,
    limit: number,
  ): Promise<LegacyRow[]> {
    const [rows] = await this.source.query<LegacyRow[]>(
      `SELECT * FROM \`${map.table}\` WHERE \`${map.id}\` > ? ORDER BY \`${map.id}\` ASC LIMIT ?`,
      [cursor, limit],
    );
    return rows;
  }

  private async readChunk(
    table: string,
    idColumn: string,
    cursor: string | number,
    limit: number,
  ): Promise<LegacyRow[]> {
    const [rows] = await this.source.query<LegacyRow[]>(
      `SELECT * FROM \`${table}\` WHERE \`${idColumn}\` > ? ORDER BY \`${idColumn}\` ASC LIMIT ?`,
      [cursor, limit],
    );
    return rows;
  }

  private async migrateMember(
    runId: string,
    row: LegacyRow,
    map: TableColumnMap,
  ): Promise<"migrated" | "skipped" | "conflicts"> {
    const legacyId = String(row[map.id]);
    const mapped = await this.target.legacyIdMap.findUnique({
      where: { entityType_legacyId: { entityType: "user", legacyId } },
    });
    if (mapped) return "skipped";
    const mobile = nullableText(row[map.mobile]);
    const unionId = map.unionId ? nullableText(row[map.unionId]) : null;
    const candidates = await this.target.user.findMany({
      where: {
        OR: [
          ...(mobile ? [{ mobile }] : []),
          ...(unionId ? [{ wechatUnionId: unionId }] : []),
        ],
      },
      select: { id: true },
      take: 2,
    });
    if (candidates.length > 0) {
      await this.target.migrationConflict.upsert({
        where: {
          runId_entityType_legacyId: {
            runId,
            entityType: "user",
            legacyId,
          },
        },
        create: {
          runId,
          entityType: "user",
          legacyId,
          reason: "mobile_or_unionid_matches_existing_user_manual_review_required",
          snapshot: {
            mobileSuffix: mobile?.slice(-4) ?? null,
            hasUnionId: Boolean(unionId),
            candidateCount: candidates.length,
          },
        },
        update: {},
      });
      return "conflicts";
    }
    const passwordHash = compatiblePasswordHash(row[map.passwordHash]);
    const target = await this.target.user.create({
      data: {
        legacyMemberId: legacyId,
        mobile,
        wechatUnionId: unionId,
        passwordHash,
        status: UserStatus.ACTIVE,
        nickname: nullableText(row[map.nickname]) || `用户${mobile?.slice(-4) ?? legacyId}`,
        avatarUrl: map.avatar ? nullableText(row[map.avatar]) : null,
        gender: legacyGender(map.gender ? row[map.gender] : null),
        birthday: map.birthday ? safeDate(row[map.birthday]) : null,
        heightCm: map.height ? safeDecimal(row[map.height], 50, 250) : null,
        weightKg: map.weight ? safeDecimal(row[map.weight], 10, 500) : null,
        ...(map.createdAt && safeDate(row[map.createdAt])
          ? { createdAt: safeDate(row[map.createdAt])! }
          : {}),
      },
    });
    await this.target.legacyIdMap.create({
      data: {
        entityType: "user",
        legacyId,
        targetId: target.id,
        sourceTable: map.table,
        runId,
      },
    });
    return "migrated";
  }

  private async migrateHealthRecord(
    runId: string,
    row: LegacyRow,
    map: HealthSourceMap,
  ): Promise<MigrationOutcome> {
    const sourceLegacyId = String(row[map.id]);
    const legacyId = `${map.table}:${sourceLegacyId}`;
    const existing = await this.target.legacyIdMap.findUnique({
      where: {
        entityType_legacyId: { entityType: "health_record", legacyId },
      },
    });
    if (existing) return "skipped";
    const memberLegacyId = String(row[map.memberId] ?? "").trim();
    const userMap = await this.target.legacyIdMap.findUnique({
      where: {
        entityType_legacyId: {
          entityType: "user",
          legacyId: memberLegacyId,
        },
      },
    });
    const metric = normalizedMetric(row[map.metric]);
    const observedAt = safeDate(row[map.observedAt]);
    const values = safeJsonObject(row[map.valuesJson]);
    const invalidReason = !userMap
      ? "member_mapping_missing"
      : !metric
        ? "health_metric_unknown"
        : !observedAt
          ? "observed_time_invalid"
          : !values
            ? "health_values_invalid"
            : metric === HealthMetric.ECG && hasInlineWaveform(values)
              ? "ecg_waveform_requires_object_storage_migration"
              : null;
    if (invalidReason || !userMap || !metric || !observedAt || !values) {
      await this.recordConflict(runId, "health_record", legacyId, invalidReason ?? "invalid", {
        sourceTable: map.table,
        sourceLegacyId,
        memberLegacyId,
        rawMetric: String(row[map.metric] ?? ""),
      });
      return "conflicts";
    }
    const timezoneOffset = map.timezoneOffsetMinutes
      ? Number(row[map.timezoneOffsetMinutes])
      : 480;
    const boundedTimezone = Number.isInteger(timezoneOffset) && Math.abs(timezoneOffset) <= 840
      ? timezoneOffset
      : 480;
    const record = await this.target.healthRecord.create({
      data: {
        userId: userMap.targetId,
        clientRecordId: `legacy:${map.table}:${sourceLegacyId}`,
        metric,
        observedAt,
        timezoneOffsetMinutes: boundedTimezone,
        values: values as Prisma.InputJsonValue,
        quality: DataQuality.UNKNOWN,
        sourcePlatform: "migration",
      },
    });
    await this.target.legacyIdMap.create({
      data: {
        entityType: "health_record",
        legacyId,
        targetId: record.id,
        sourceTable: map.table,
        runId,
      },
    });
    return "migrated";
  }

  private async verifyMappedTable(
    runId: string,
    entityType: string,
    table: string,
    idColumn: string,
  ) {
    const [sourceRows] = await this.source.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count, MIN(\`${idColumn}\`) AS firstId, MAX(\`${idColumn}\`) AS lastId FROM \`${table}\``,
    );
    const targetMapped = await this.target.legacyIdMap.count({
      where: { entityType, sourceTable: table },
    });
    const conflicts = await this.target.migrationConflict.count({
      where: { runId, entityType, legacyId: { startsWith: entityType === "health_record" ? `${table}:` : "" } },
    });
    const source = (sourceRows[0] ?? {}) as Record<string, unknown>;
    return {
      sourceTable: table,
      source,
      targetMapped,
      conflicts,
      matched: Number(source.count ?? 0) === targetMapped + conflicts,
    };
  }

  private async recordConflict(
    runId: string,
    entityType: string,
    legacyId: string,
    reason: string,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    await this.target.migrationConflict.upsert({
      where: { runId_entityType_legacyId: { runId, entityType, legacyId } },
      create: {
        runId,
        entityType,
        legacyId,
        reason,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
      update: { reason, snapshot: snapshot as Prisma.InputJsonValue },
    });
  }
}

type MigrationOutcome = "migrated" | "skipped" | "conflicts";
type MigrationCounters = Record<MigrationOutcome, number>;

function counters(): MigrationCounters {
  return { migrated: 0, skipped: 0, conflicts: 0 };
}

function nullableText(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result ? result : null;
}

function compatiblePasswordHash(value: unknown): string | null {
  const hash = nullableText(value);
  return hash && /^\$2[aby]\$\d{2}\$/.test(hash) ? hash : null;
}

function legacyGender(value: unknown): "MALE" | "FEMALE" | "UNSPECIFIED" {
  const normalized = String(value ?? "").toLowerCase();
  if (["1", "male", "m"].includes(normalized)) return "MALE";
  if (["2", "female", "f"].includes(normalized)) return "FEMALE";
  return "UNSPECIFIED";
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;
  const result = new Date(String(value));
  return Number.isNaN(result.valueOf()) ? null : result;
}

function safeDecimal(value: unknown, min: number, max: number): Prisma.Decimal | null {
  const result = Number(value);
  return Number.isFinite(result) && result >= min && result <= max
    ? new Prisma.Decimal(result)
    : null;
}

function normalizedMetric(value: unknown): HealthMetric | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliases: Record<string, HealthMetric> = {
    sleep: HealthMetric.SLEEP,
    steps: HealthMetric.STEPS,
    step: HealthMetric.STEPS,
    distance: HealthMetric.DISTANCE,
    calories: HealthMetric.CALORIES,
    calorie: HealthMetric.CALORIES,
    heart_rate: HealthMetric.HEART_RATE,
    heartrate: HealthMetric.HEART_RATE,
    heartreat: HealthMetric.HEART_RATE,
    blood_oxygen: HealthMetric.BLOOD_OXYGEN,
    spo2: HealthMetric.BLOOD_OXYGEN,
    blood_pressure: HealthMetric.BLOOD_PRESSURE,
    bloodpressure: HealthMetric.BLOOD_PRESSURE,
    blood_glucose: HealthMetric.BLOOD_GLUCOSE,
    glucose: HealthMetric.BLOOD_GLUCOSE,
    temperature: HealthMetric.TEMPERATURE,
    body_temperature: HealthMetric.TEMPERATURE,
    hrv: HealthMetric.HRV,
    ecg: HealthMetric.ECG,
    e_c_g: HealthMetric.ECG,
    body_composition: HealthMetric.BODY_COMPOSITION,
    blood_composition: HealthMetric.BLOOD_COMPOSITION,
  };
  return aliases[normalized] ?? null;
}

function safeJsonObject(value: unknown): Record<string, unknown> | null {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return null;
  return decoded as Record<string, unknown>;
}

function hasInlineWaveform(values: Record<string, unknown>): boolean {
  return ["samples", "waveform", "ecgData", "data"].some(
    (key) => Array.isArray(values[key]) && (values[key] as unknown[]).length > 0,
  );
}
