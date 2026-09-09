import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DataQuality,
  HealthMetric as PrismaHealthMetric,
  NotificationType,
  Prisma,
} from "@prisma/client";
import type {
  HealthBatchResultContract,
  HealthMetric,
  HealthRecordInputContract,
} from "@saydian/app-contracts";
import { PrismaService } from "../common/prisma.service";
import { isUuid, safeObject, sha256 } from "../common/crypto";
import { validateHealthRecord } from "./health-validation";

const metricMap: Record<HealthMetric, PrismaHealthMetric> = {
  sleep: PrismaHealthMetric.SLEEP,
  steps: PrismaHealthMetric.STEPS,
  distance: PrismaHealthMetric.DISTANCE,
  calories: PrismaHealthMetric.CALORIES,
  heart_rate: PrismaHealthMetric.HEART_RATE,
  blood_oxygen: PrismaHealthMetric.BLOOD_OXYGEN,
  blood_pressure: PrismaHealthMetric.BLOOD_PRESSURE,
  blood_glucose: PrismaHealthMetric.BLOOD_GLUCOSE,
  temperature: PrismaHealthMetric.TEMPERATURE,
  hrv: PrismaHealthMetric.HRV,
  ecg: PrismaHealthMetric.ECG,
  body_composition: PrismaHealthMetric.BODY_COMPOSITION,
  blood_composition: PrismaHealthMetric.BLOOD_COMPOSITION,
};

const metricReverse = Object.fromEntries(
  Object.entries(metricMap).map(([key, value]) => [value, key]),
) as Record<PrismaHealthMetric, HealthMetric>;

const qualityMap = {
  unknown: DataQuality.UNKNOWN,
  valid: DataQuality.VALID,
  suspect: DataQuality.SUSPECT,
  invalid: DataQuality.INVALID,
} as const;

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async ingestBatch(
    userId: string,
    idempotencyKey: string,
    input: unknown,
    legacyRequest?: { scope: string; fingerprint: unknown },
  ): Promise<HealthBatchResultContract> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) {
      throw new BadRequestException("Idempotency-Key 不正确");
    }
    const body = safeObject(input);
    const rawRecords = Array.isArray(body.records) ? body.records : [];
    if (rawRecords.length === 0) {
      throw new BadRequestException("没有需要同步的健康记录");
    }
    if (rawRecords.length > 200) {
      throw new BadRequestException("每次最多同步200条健康记录");
    }
    const scope = legacyRequest?.scope ?? "health_batch_v2";
    const requestHash = sha256(JSON.stringify(legacyRequest ? legacyRequest.fingerprint : body));
    // Serialize all ingestion scopes for this member. The records, warning outbox
    // and idempotency response must commit together; a failed commit is retryable.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"health-ingest:" + userId}, 0))`;
      const existing = await tx.idempotencyRecord.findUnique({
        where: { userId_scope_key: { userId, scope, key: idempotencyKey } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictException("同一幂等键不能用于不同的同步内容");
        }
        return existing.responseBody as unknown as HealthBatchResultContract;
      }
      const acceptedIds: string[] = [];
      const rejected: HealthBatchResultContract["rejected"] = [];
      let lastRecord: HealthRecordInputContract | undefined;
      for (const raw of rawRecords) {
        const result = validateHealthRecord(raw);
        if (!result.valid) {
          rejected.push(result.rejection);
          continue;
        }
        try {
          await this.saveRecord(tx, userId, result.record);
          acceptedIds.push(result.record.id);
          lastRecord = result.record;
        } catch (error) {
          // These checks run before any write for the record. SQL/storage failures
          // must abort the transaction, never become a false accepted duplicate.
          if (!(error instanceof BadRequestException || error instanceof ConflictException)) throw error;
          rejected.push({
            id: result.record.id,
            code: error instanceof ConflictException ? "record_conflict" : "invalid_artifact",
            message: error.message,
          });
        }
      }
      const response: HealthBatchResultContract = {
        acceptedIds,
        rejected,
        nextCursor: lastRecord
          ? Buffer.from(`${lastRecord.observedAt}|${lastRecord.id}`).toString("base64url")
          : typeof body.cursor === "string" ? body.cursor : null,
      };
      await tx.idempotencyRecord.create({
        data: {
          userId, scope, key: idempotencyKey, requestHash, responseCode: 200,
          responseBody: response as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      return response;
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  async list(
    userId: string,
    metricInput?: string,
    limitInput = 50,
    beforeInput?: string,
  ) {
    const metric = metricInput ? metricMap[metricInput as HealthMetric] : undefined;
    if (metricInput && !metric) throw new BadRequestException("健康指标不正确");
    if (!Number.isInteger(Number(limitInput)) || Number(limitInput) < 1) {
      throw new BadRequestException("分页数量必须为正整数");
    }
    const limit = Math.min(Number(limitInput), 200);
    const before = healthPageFilter(beforeInput);
    const records = await this.prisma.healthRecord.findMany({
      where: {
        userId,
        ...(metric ? { metric } : {}),
        ...before,
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { ecgArtifact: true },
    });
    return {
      items: records.map((record) => ({
        id: record.clientRecordId,
        metric: metricReverse[record.metric],
        observedAt: record.observedAt.toISOString(),
        timezoneOffsetMinutes: record.timezoneOffsetMinutes,
        values: record.values,
        unit: record.unit,
        quality: record.quality.toLowerCase(),
        source: {
          platform: record.sourcePlatform,
          model: record.sourceModel,
          firmware: record.sourceFirmware,
        },
        ecgArtifact: record.ecgArtifact
          ? {
              sampleRateHz: record.ecgArtifact.sampleRateHz,
              sampleCount: record.ecgArtifact.sampleCount,
              sha256: record.ecgArtifact.sha256,
            }
          : null,
      })),
      nextCursor:
        records.length === limit
          ? healthPageCursor(records[records.length - 1]!)
          : null,
    };
  }

  async saveWarningRules(userId: string, input: unknown) {
    const body = safeObject(input);
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (rules.length > 20) throw new BadRequestException("预警设置数量过多");
    // Validate the entire request before the first write. Persist the complete
    // batch atomically so a later invalid rule or storage error cannot partially
    // change the member's thresholds while returning an error.
    const normalized = rules.map((item) => {
      const rule = safeObject(item);
      const metric = metricMap[String(rule.metric) as HealthMetric];
      if (!metric) throw new BadRequestException("预警指标不正确");
      const low = rule.lowThreshold == null ? null : Number(rule.lowThreshold);
      const high = rule.highThreshold == null ? null : Number(rule.highThreshold);
      const secondaryHigh =
        rule.secondaryHighThreshold == null
          ? null
          : Number(rule.secondaryHighThreshold);
      if (
        (low != null && !Number.isFinite(low)) ||
        (high != null && !Number.isFinite(high)) ||
        (secondaryHigh != null && !Number.isFinite(secondaryHigh))
      ) {
        throw new BadRequestException("预警阈值不正确");
      }
      if (low != null && high != null && low >= high) {
        throw new BadRequestException("最低值必须小于最高值");
      }
      return {
        metric,
        enabled: rule.enabled !== false,
        lowThreshold: low,
        highThreshold: high,
        secondaryHighThreshold:
          metric === PrismaHealthMetric.BLOOD_PRESSURE ? secondaryHigh : null,
        shareWithCare: rule.shareWithCare === true,
      };
    });
    return this.prisma.$transaction(async (tx) => {
      for (const { metric, ...data } of normalized) {
        await tx.healthWarningRule.upsert({
          where: { userId_metric: { userId, metric } },
          create: { userId, metric, ...data },
          update: data,
        });
      }
      return tx.healthWarningRule.findMany({ where: { userId } });
    });
  }

  async legacyRecords(userId: string, metrics: HealthMetric[], from?: Date, to?: Date, page?: number) {
    const records = await this.prisma.healthRecord.findMany({
      where: { userId, metric: { in: metrics.map((metric) => metricMap[metric]) },
        ...((from || to) ? { observedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      orderBy: [{ observedAt: "desc" }, { id: "desc" }],
      skip: page ? (page - 1) * 30 : 0,
      take: page ? 30 : 20_001,
      include: { ecgArtifact: true },
    });
    if (records.length > 20_000) throw new BadRequestException("记录较多，请缩小查询时间范围");
    return records.map((record) => ({
      id: record.clientRecordId,
      metric: metricReverse[record.metric],
      observedAt: record.observedAt.toISOString(),
      timezoneOffsetMinutes: record.timezoneOffsetMinutes,
      values: record.values, unit: record.unit, quality: record.quality.toLowerCase(),
      ecgArtifact: record.ecgArtifact ? {
        sampleRateHz: record.ecgArtifact.sampleRateHz,
        sampleCount: record.ecgArtifact.sampleCount,
        sha256: record.ecgArtifact.sha256,
      } : null,
    }));
  }

  async legacyDetail(userId: string, metric: HealthMetric, identifier: string) {
    const record = await this.prisma.healthRecord.findFirst({
      where: { userId, metric: metricMap[metric], OR: [...(isUuid(identifier) ? [{ id: identifier }] : []), { clientRecordId: identifier }] },
    });
    if (!record) throw new NotFoundException("健康记录不存在");
    return { id: record.clientRecordId, date: record.observedAt.toISOString(), ...safeObject(record.values) };
  }

  async warningRules(userId: string) {
    const rules = await this.prisma.healthWarningRule.findMany({ where: { userId } });
    return rules.map((rule) => ({
      metric: metricReverse[rule.metric],
      enabled: rule.enabled,
      lowThreshold: rule.lowThreshold?.toNumber() ?? null,
      highThreshold: rule.highThreshold?.toNumber() ?? null,
      secondaryHighThreshold:
        rule.secondaryHighThreshold?.toNumber() ?? null,
      shareWithCare: rule.shareWithCare,
    }));
  }

  async warnings(userId: string, limitInput = 50) {
    const limit = Math.min(Math.max(Number(limitInput) || 50, 1), 200);
    const events = await this.prisma.healthWarningEvent.findMany({
      where: { userId },
      orderBy: { observedAt: "desc" },
      take: limit,
    });
    return {
      items: events.map((event) => ({
        eventId: event.eventId,
        metric: metricReverse[event.metric],
        observedAt: event.observedAt.toISOString(),
        source: event.source,
        rule: event.ruleSnapshot,
        values: event.valueSnapshot,
      })),
    };
  }

  private async saveRecord(
    tx: Prisma.TransactionClient,
    userId: string,
    record: HealthRecordInputContract,
  ): Promise<void> {
    const deviceBinding = record.source.deviceId
      ? await tx.deviceBinding.findUnique({
          where: { hardwareKey: sha256(`${userId}:${record.source.deviceId}`) },
        })
      : null;
    const data = {
      userId,
      clientRecordId: record.id,
      metric: metricMap[record.metric],
      observedAt: new Date(record.observedAt),
      timezoneOffsetMinutes: record.timezoneOffsetMinutes,
      values: record.values as Prisma.InputJsonValue,
      unit: record.unit ?? null,
      quality: qualityMap[record.quality ?? "unknown"],
      sourcePlatform: record.source.platform,
      sourceModel: record.source.model ?? null,
      sourceFirmware: record.source.firmware ?? null,
      deviceBindingId: deviceBinding?.id ?? null,
      sourceDeviceKey: record.source.deviceId ? sha256(`${userId}:${record.source.deviceId}`) : null,
    };
    const existing = await tx.healthRecord.findUnique({
      where: { userId_clientRecordId: { userId, clientRecordId: record.id } },
      include: { ecgArtifact: true },
    });
    if (existing) {
      const sameFields = Object.entries(data).every(([key, value]) =>
        // Binding may legitimately be created after the first upload. The scoped
        // fingerprint is the durable identity, not the optional binding row.
        (key === "deviceBindingId" && data.sourceDeviceKey !== null)
        || stableHealthValue(existing[key as keyof typeof existing]) === stableHealthValue(value),
      );
      const artifact = existing.ecgArtifact;
      const sameArtifact = record.ecgArtifact
        ? artifact?.objectKey === record.ecgArtifact.uploadObjectKey
          && artifact.sha256.toLowerCase() === record.ecgArtifact.sha256.toLowerCase()
          && artifact.sampleRateHz === record.ecgArtifact.sampleRateHz
          && artifact.sampleCount === record.ecgArtifact.sampleCount
        : !artifact;
      if (!sameFields || !sameArtifact) {
        throw new ConflictException("记录编号已存在且内容不同，请使用新的记录编号");
      }
      return;
    }
    const file = record.ecgArtifact
      ? await tx.fileObject.findUnique({ where: { objectKey: record.ecgArtifact.uploadObjectKey } })
      : null;
    if (record.ecgArtifact) {
      if (!file || file.ownerUserId !== userId || file.status !== "ACTIVE"
        || file.sha256.toLowerCase() !== record.ecgArtifact.sha256.toLowerCase()) {
        throw new BadRequestException("心电数据文件尚未完成上传验证");
      }
      if (await tx.ecgArtifact.findUnique({ where: { objectKey: file.objectKey } })) {
        throw new ConflictException("心电文件已关联其他记录，不能重复关联");
      }
    }
    const created = await tx.healthRecord.create({ data });
    if (record.ecgArtifact && file) {
      await tx.ecgArtifact.create({
        data: {
          healthRecordId: created.id, objectKey: file.objectKey, sha256: file.sha256,
          sampleRateHz: record.ecgArtifact.sampleRateHz, sampleCount: record.ecgArtifact.sampleCount,
          byteSize: file.byteSize, compression: "gzip",
        },
      });
    }
    await this.createWarningIfNeeded(tx, userId, record);
  }

  private async createWarningIfNeeded(
    tx: Prisma.TransactionClient,
    userId: string,
    record: HealthRecordInputContract,
  ): Promise<void> {
    const metric = metricMap[record.metric];
    const rule = await tx.healthWarningRule.findUnique({
      where: { userId_metric: { userId, metric } },
    });
    if (!rule?.enabled || record.quality === "invalid") return;
    const direction = healthWarningDirection(
      record.metric,
      record.values,
      rule.lowThreshold?.toNumber() ?? null,
      rule.highThreshold?.toNumber() ?? null,
      rule.secondaryHighThreshold?.toNumber() ?? null,
    );
    if (!direction) return;
    const eventId = `health-warning-${sha256(
      `${userId}:${record.id}:${record.metric}:${direction}`,
    ).slice(0, 32)}`;
    const title = `${healthMetricLabel(record.metric)}提醒`;
    const body = `你设置的${healthMetricLabel(record.metric)}提醒已触发，请打开 App 查看记录`;
    const warning = await tx.healthWarningEvent.upsert({
      where: { eventId },
      create: {
        userId,
        eventId,
        metric,
        observedAt: new Date(record.observedAt),
        ruleSnapshot: {
          lowThreshold: rule.lowThreshold?.toNumber() ?? null,
          highThreshold: rule.highThreshold?.toNumber() ?? null,
          secondaryHighThreshold:
            rule.secondaryHighThreshold?.toNumber() ?? null,
          direction,
        },
        valueSnapshot: record.values as Prisma.InputJsonValue,
        source: "user_threshold",
      },
      update: {},
    });
    const notification = await tx.notification.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: {
        userId,
        eventId,
        type: NotificationType.HEALTH_WARNING,
        title,
        body,
        deepLink: `/health/warnings/${warning.id}`,
        metadata: { warningId: warning.id, metric: record.metric },
      },
      update: { readAt: null },
    });
    await tx.outboxEvent.upsert({
      where: { eventId },
      create: {
        eventId,
        eventType: "health_warning",
        aggregateType: "health_warning",
        aggregateId: warning.id,
        payload: {
          notificationId: notification.id,
          userId,
          eventId,
          type: "health_warning",
          deepLink: `/health/warnings/${warning.id}`,
        },
      },
      update: {},
    });
  }
}

function stableHealthValue(value: unknown): string | undefined {
  const canonical = (item: unknown): unknown => {
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]));
    }
    return item;
  };
  return JSON.stringify(canonical(value));
}

export function healthPageCursor(record: { id: string; observedAt: Date }): string {
  return Buffer.from(JSON.stringify({ v: 1, observedAt: record.observedAt.toISOString(), id: record.id })).toString("base64url");
}

export function healthPageFilter(input?: string): Prisma.HealthRecordWhereInput {
  if (!input) return {};
  // Continue to accept historical ISO before dates; new responses carry both
  // ordering keys so records with identical observedAt cannot disappear.
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(input)) {
    const observedAt = new Date(input);
    if (Number.isFinite(observedAt.valueOf())) return { observedAt: { lt: observedAt } };
  }
  try {
    const cursor = JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
    const observedAt = new Date(cursor.observedAt);
    if (cursor.v === 1 && isUuid(cursor.id) && typeof cursor.observedAt === "string"
      && Number.isFinite(observedAt.valueOf())) {
      return { OR: [
        { observedAt: { lt: observedAt } },
        { observedAt, id: { lt: cursor.id } },
      ] };
    }
  } catch { /* A malformed cursor is a client error, not a database query. */ }
  throw new BadRequestException("分页游标不正确");
}

export function healthWarningValue(
  metric: HealthMetric,
  values: Record<string, number | string | boolean | null>,
): number | null {
  const candidates: Partial<Record<HealthMetric, string[]>> = {
    heart_rate: ["bpm", "value", "heartRate"],
    blood_oxygen: ["percent", "spo2", "value"],
    blood_pressure: ["systolic", "high", "bloodPressureHigh"],
    blood_glucose: ["mmolL", "value", "glucose"],
    temperature: ["celsius", "value", "temperature"],
    hrv: ["ms", "value", "hrv"],
    steps: ["value", "steps"],
    distance: ["value", "meters"],
    calories: ["value", "kcal"],
  };
  for (const key of candidates[metric] ?? []) {
    const raw = values[key];
    if (raw == null || typeof raw === "boolean" || String(raw).trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function warningDirection(
  value: number,
  low: number | null,
  high: number | null,
): "low" | "high" | null {
  if (low !== null && value < low) return "low";
  if (high !== null && value > high) return "high";
  return null;
}

export function healthWarningDirection(
  metric: HealthMetric,
  values: Record<string, number | string | boolean | null>,
  low: number | null,
  high: number | null,
  secondaryHigh: number | null,
): "low" | "high" | null {
  const value = healthWarningValue(metric, values);
  if (value === null) return null;
  const primaryDirection = warningDirection(value, low, high);
  if (primaryDirection) return primaryDirection;
  if (metric !== "blood_pressure" || secondaryHigh === null) return null;
  const diastolic = Number(
    values.diastolic ?? values.low ?? values.bloodPressureLow,
  );
  return Number.isFinite(diastolic) && diastolic > secondaryHigh
    ? "high"
    : null;
}

function healthMetricLabel(metric: HealthMetric): string {
  const labels: Record<HealthMetric, string> = {
    sleep: "睡眠",
    steps: "步数",
    distance: "距离",
    calories: "热量",
    heart_rate: "心率",
    blood_oxygen: "血氧",
    blood_pressure: "血压",
    blood_glucose: "血糖",
    temperature: "体温",
    hrv: "HRV",
    ecg: "ECG",
    body_composition: "身体成分",
    blood_composition: "血液成分",
  };
  return labels[metric];
}
