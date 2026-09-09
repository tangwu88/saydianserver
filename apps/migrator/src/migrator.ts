import {
  DataQuality,
  HealthMetric,
  Prisma,
  PrismaClient,
  UserStatus,
} from "@prisma/client";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { createHash, createHmac } from "node:crypto";
import type { HealthSourceMap, MigrationMap, TableColumnMap } from "./config";

type LegacyRow = RowDataPacket & Record<string, unknown>;

export class LegacyMigrator {
  constructor(
    private readonly source: Connection,
    private readonly target: PrismaClient,
    private readonly map: MigrationMap,
  ) {}

  private get sourceSystem() { return this.map.sourceSystem ?? "legacy_app"; }
  private mappingKey(entityType: string, legacyId: string) {
    return { sourceSystem_entityType_legacyId: { sourceSystem: this.sourceSystem, entityType, legacyId } };
  }

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

  async migrate(resumeRunId?: string): Promise<Record<string, unknown>> {
    if (process.env.MIGRATION_TARGET_WRITES_FROZEN !== "true") throw new Error("Migration requires an explicitly frozen target");
    if (!this.map.member.status || this.map.member.activeStatusValue === undefined) throw new Error("Member migration requires reviewed status semantics; missing status must not reactivate accounts");
    if (resumeRunId && !this.map.sourceSnapshotId) throw new Error("Resume requires the same immutable sourceSnapshotId");
    const run = resumeRunId ? await this.target.migrationRun.findUniqueOrThrow({ where: { id: resumeRunId } }) : await this.target.migrationRun.create({
      data: {
        sourceLabel: this.map.sourceLabel,
        sourceDigest: this.map.sourceSnapshotId ?? null,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    if (run.sourceLabel !== this.map.sourceLabel || (resumeRunId && run.sourceDigest !== this.map.sourceSnapshotId)) throw new Error("Migration source snapshot does not match the resumed run");
    if (resumeRunId) await this.target.migrationRun.update({ where: { id: run.id }, data: { status: "RUNNING", completedAt: null } });
    const report: {
      users: MigrationCounters;
      health: Record<string, MigrationCounters>;
    } = {
      users: counters(),
      health: {},
    };
    try {
      let cursor: string | number = await this.resumeCursor(run.id, this.map.member.table, this.map.member.idType);
      while (true) {
        const rows = await this.readMemberChunk(this.map.member, cursor, 500);
        if (rows.length === 0) break;
        for (const row of rows) {
          const legacyId = String(row[this.map.member.id]);
          cursor =
            this.map.member.idType === "string"
              ? legacyId
              : Number(legacyId) || cursor;
          const outcome = await this.target.$transaction(async (tx) => {
            const worker = new LegacyMigrator(this.source, tx as PrismaClient, this.map);
            const result = await worker.migrateMember(run.id, row, this.map.member);
            await worker.checkpoint(run.id, this.map.member.table, String(cursor));
            return result;
          });
          report.users[outcome] += 1;
        }
      }
      for (const source of this.map.healthSources) {
        const sourceReport = counters();
        report.health[source.table] = sourceReport;
        let cursor: string | number = await this.resumeCursor(run.id, source.table, source.idType);
        while (true) {
          const rows = await this.readChunk(source.table, source.id, cursor, 500);
          if (rows.length === 0) break;
          for (const row of rows) {
            const legacyId = String(row[source.id]);
            cursor =
              source.idType === "string"
                ? legacyId
                : Number(legacyId) || cursor;
            const outcome = await this.target.$transaction(async (tx) => {
              const worker = new LegacyMigrator(this.source, tx as PrismaClient, this.map);
              const result = await worker.migrateHealthRecord(run.id, row, source);
              await worker.checkpoint(run.id, source.table, String(cursor));
              return result;
            });
            sourceReport[outcome] += 1;
          }
        }
      }
      await this.importVerifiedSessions(run.id);
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

  private async resumeCursor(runId: string, table: string, idType?: string): Promise<string | number> {
    const checkpoint = await this.target.migrationCheckpoint.findUnique({ where: { runId_sourceTable: { runId, sourceTable: table } } });
    return idType === "string" ? checkpoint?.cursor ?? "" : Number(checkpoint?.cursor ?? 0);
  }

  private checkpoint(runId: string, sourceTable: string, cursor: string) {
    return this.target.migrationCheckpoint.upsert({
      where: { runId_sourceTable: { runId, sourceTable } },
      create: { runId, sourceSystem: this.sourceSystem, sourceTable, cursor, rowCount: 1 },
      update: { cursor, rowCount: { increment: 1 } },
    });
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
    const unresolvedConflicts = await this.target.migrationConflict.count({ where: { runId: run.id, resolvedAt: null } });
    const matched = unresolvedConflicts === 0 &&
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
      unresolvedConflicts,
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
      where: this.mappingKey("user", legacyId),
    });
    const sourceHash = rowDigest(row);
    if (mapped?.sourceHash === sourceHash) {
      await this.target.legacyIdMap.update({ where: { id: mapped.id }, data: { runId } });
      return "skipped";
    }
    if (map.deletedAt && row[map.deletedAt]) {
      await this.recordConflict(runId, "user", legacyId, "source_deleted_requires_review", { sourceTable: map.table });
      if (mapped) await this.target.legacyIdMap.update({ where: { id: mapped.id }, data: { sourceDeletedAt: safeDate(row[map.deletedAt]) ?? new Date() } });
      return "conflicts";
    }
    const mobile = nullableText(row[map.mobile]);
    const unionId = map.unionId ? nullableText(row[map.unionId]) : null;
    const candidates = await this.target.user.findMany({
      where: {
        ...(mapped ? { id: { not: mapped.targetId } } : {}),
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
    if (nullableText(row[map.passwordHash]) && !passwordHash) {
      await this.recordConflict(runId, "password", legacyId, "source_password_algorithm_unsupported", { sourceTable: map.table });
    }
    const memberData = {
        legacyMemberId: this.sourceSystem === "legacy_app" ? legacyId : null,
        mobile,
        wechatUnionId: unionId,
        passwordHash,
        status: map.status && String(row[map.status]) !== map.activeStatusValue ? UserStatus.DISABLED : UserStatus.ACTIVE,
        nickname: nullableText(row[map.nickname]) || `用户${mobile?.slice(-4) ?? legacyId}`,
        avatarUrl: map.avatar ? nullableText(row[map.avatar]) : null,
        gender: legacyGender(map.gender ? row[map.gender] : null),
        birthday: map.birthday ? safeDate(row[map.birthday]) : null,
        heightCm: map.height ? safeDecimal(row[map.height], 50, 250) : null,
        weightKg: map.weight ? safeDecimal(row[map.weight], 10, 500) : null,
        ...(map.createdAt && safeDate(row[map.createdAt])
          ? { createdAt: safeDate(row[map.createdAt])! }
          : {}),
      };
    const target = mapped
      ? await this.target.user.update({ where: { id: mapped.targetId }, data: memberData })
      : await this.target.user.create({ data: memberData });
    await this.target.legacyIdMap.upsert({
      where: this.mappingKey("user", legacyId),
      create: {
        sourceSystem: this.sourceSystem,
        entityType: "user",
        legacyId,
        targetId: target.id,
        sourceTable: map.table,
        runId,
        sourceHash,
        sourceUpdatedAt: map.updatedAt ? safeDate(row[map.updatedAt]) : null,
      },
      update: { runId, sourceHash, sourceUpdatedAt: map.updatedAt ? safeDate(row[map.updatedAt]) : null, sourceDeletedAt: null },
    });
    if (target.status !== UserStatus.ACTIVE) await this.target.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (map.pointBalance) await this.importPointBalance(runId, legacyId, target.id, row[map.pointBalance], map.pointBalanceUnit);
    await this.target.migrationConflict.updateMany({ where: { runId, entityType: "user", legacyId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "source_row_imported" } });
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
      where: this.mappingKey("health_record", legacyId),
    });
    const sourceHash = rowDigest(row);
    if (existing?.sourceHash === sourceHash) {
      await this.target.legacyIdMap.update({ where: { id: existing.id }, data: { runId } });
      return "skipped";
    }
    const memberLegacyId = String(row[map.memberId] ?? "").trim();
    const userMap = await this.target.legacyIdMap.findUnique({
      where: this.mappingKey("user", memberLegacyId),
    });
    const metric = normalizedMetric(row[map.metric]);
    const observedAt = safeDate(row[map.observedAt]);
    const values = safeJsonObject(row[map.valuesJson]);
    const invalidReason = map.deletedAt && row[map.deletedAt]
      ? "source_deleted_requires_review"
      : !userMap
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
    const recordData = {
        userId: userMap.targetId,
        clientRecordId: `legacy:${map.table}:${sourceLegacyId}`,
        metric,
        observedAt,
        timezoneOffsetMinutes: boundedTimezone,
        values: values as Prisma.InputJsonValue,
        quality: DataQuality.UNKNOWN,
        sourcePlatform: this.sourceSystem,
      };
    const record = existing
      ? await this.target.healthRecord.update({ where: { id: existing.targetId }, data: recordData })
      : await this.target.healthRecord.create({ data: recordData });
    await this.target.legacyIdMap.upsert({
      where: this.mappingKey("health_record", legacyId),
      create: {
        sourceSystem: this.sourceSystem,
        entityType: "health_record",
        legacyId,
        targetId: record.id,
        sourceTable: map.table,
        runId,
        sourceHash,
        sourceUpdatedAt: map.updatedAt ? safeDate(row[map.updatedAt]) : null,
      },
      update: { runId, sourceHash, sourceUpdatedAt: map.updatedAt ? safeDate(row[map.updatedAt]) : null },
    });
    await this.target.migrationConflict.updateMany({ where: { runId, entityType: "health_record", legacyId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "source_row_imported" } });
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
      where: { sourceSystem: this.sourceSystem, entityType, sourceTable: table },
    });
    const conflicts = await this.target.migrationConflict.count({
      where: { runId, entityType, resolvedAt: null, legacyId: { startsWith: entityType === "health_record" ? `${table}:` : "" } },
    });
    const notSeen = await this.target.legacyIdMap.count({
      where: { sourceSystem: this.sourceSystem, entityType, sourceTable: table, OR: [{ runId: { not: runId } }, { runId: null }] },
    });
    const source = (sourceRows[0] ?? {}) as Record<string, unknown>;
    return {
      sourceTable: table,
      source,
      targetMapped,
      conflicts,
      missingOrDeletedSinceSnapshot: notSeen,
      matched: Number(source.count ?? 0) === targetMapped && conflicts === 0 && notSeen === 0,
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
      update: { reason, snapshot: snapshot as Prisma.InputJsonValue, resolvedAt: null, resolution: null },
    });
  }

  private async importPointBalance(runId: string, legacyId: string, userId: string, value: unknown, unit?: string) {
    const cents = sourceMoneyCents(value, unit);
    if (cents === null) {
      await this.recordConflict(runId, "point_balance", legacyId, "source_balance_or_unit_unknown", { sourceTable: this.map.member.table });
      return;
    }
    const previous = await this.target.commercePointAccount.findUnique({ where: { userId } });
    if (previous?.balanceCents === cents) return;
    const deltaCents = cents - (previous?.balanceCents ?? 0);
    await this.target.commercePointAccount.upsert({ where: { userId }, create: { userId, balanceCents: cents }, update: { balanceCents: cents, version: { increment: 1 } } });
    await this.target.commercePointLedger.create({ data: { userId, deltaCents, type: "MIGRATION_BALANCE", idempotencyKey: `migration-point:${runId}:${legacyId}:${cents}` } });
    await this.target.migrationConflict.updateMany({ where: { runId, entityType: "point_balance", legacyId, resolvedAt: null }, data: { resolvedAt: new Date(), resolution: "source_amount_verified_and_imported" } });
  }

  private async importVerifiedSessions(runId: string) {
    const map = this.map.sessions;
    if (!map) return;
    const key = process.env.LEGACY_SESSION_HASH_KEY?.trim() ?? "";
    if (process.env.MIGRATION_ALLOW_VERIFIED_SESSION_IMPORT !== "true" || key.length < 32 || this.sourceSystem !== "legacy_app") {
      throw new Error("Verified-session import requires explicit authorization, the reviewed legacy_app mapping and a secure digest key");
    }
    const importStartedAt = new Date();
    let cursor: string | number = "";
    while (true) {
      const rows = await this.readChunk(map.table, map.id, cursor, 500);
      if (!rows.length) break;
      for (const row of rows) {
        cursor = String(row[map.id]);
        const sourceSessionId = String(row[map.id]);
        const token = String(row[map.token] ?? "");
        const expiresAt = map.expiryFormat === "unix_seconds" ? new Date(Number(row[map.expiresAt]) * 1000) : safeDate(row[map.expiresAt]);
        const user = await this.target.legacyIdMap.findUnique({ where: this.mappingKey("user", String(row[map.memberId])) });
        if (!user || token.length < 16 || !expiresAt || !Number.isFinite(expiresAt.valueOf())) {
          await this.recordConflict(runId, "legacy_session", sourceSessionId, "source_session_unverifiable", { sourceTable: map.table });
          continue;
        }
        const tokenDigest = createHmac("sha256", key).update(`legacy_app\0${token}`).digest("hex");
        const existing = await this.target.legacySessionCredential.findUnique({ where: { sourceSystem_tokenDigest: { sourceSystem: this.sourceSystem, tokenDigest } } });
        if (existing && existing.userId !== user.targetId) {
          await this.recordConflict(runId, "legacy_session", sourceSessionId, "source_token_has_conflicting_member_mapping", { sourceTable: map.table });
          continue;
        }
        const data = { userId: user.targetId, sourceSessionId, sourceVerifiedAt: new Date(), verificationEvidence: map.verificationEvidence, expiresAt, revokedAt: map.revokedAt ? safeDate(row[map.revokedAt]) : null };
        await this.target.legacySessionCredential.upsert({ where: { sourceSystem_tokenDigest: { sourceSystem: this.sourceSystem, tokenDigest } }, create: { sourceSystem: this.sourceSystem, tokenDigest, ...data }, update: data });
      }
    }
    // Logout by deleting/replacing the source session must not leave an older
    // imported token valid until the bridge deadline.
    await this.target.legacySessionCredential.updateMany({
      where: { sourceSystem: this.sourceSystem, sourceVerifiedAt: { lt: importStartedAt }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export function rowDigest(row: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))))).digest("hex");
}

export function sourceMoneyCents(value: unknown, unit?: string): number | null {
  const source = String(value ?? "").trim();
  if (!source || !["cents", "yuan"].includes(unit ?? "") || !/^\d+(?:\.\d{1,2})?$/.test(source)) return null;
  const [whole, fraction = ""] = source.split(".");
  if (unit === "cents" && fraction) return null;
  const cents = unit === "yuan" ? Number(whole) * 100 + Number(fraction.padEnd(2, "0")) : Number(whole);
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : null;
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

export function compatiblePasswordHash(value: unknown): string | null {
  const hash = nullableText(value);
  return hash && /^\$2[aby]\$(?:0[4-9]|1[0-6])\$[./A-Za-z0-9]{53}$/.test(hash) ? hash : null;
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
