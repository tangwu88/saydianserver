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
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        userId_scope_key: {
          userId,
          scope,
          key: idempotencyKey,
        },
      },
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
        await this.saveRecord(userId, result.record);
        acceptedIds.push(result.record.id);
        lastRecord = result.record;
      } catch (error) {
        if (isUniqueConstraint(error)) {
          acceptedIds.push(result.record.id);
          lastRecord = result.record;
          continue;
        }
        rejected.push({
          id: result.record.id,
          code: "storage_failed",
          message: "健康记录暂时无法保存，请稍后重试",
        });
      }
    }
    const nextCursor = lastRecord
      ? Buffer.from(`${lastRecord.observedAt}|${lastRecord.id}`).toString("base64url")
      : typeof body.cursor === "string"
        ? body.cursor
        : null;
    const response: HealthBatchResultContract = {
      acceptedIds,
      rejected,
      nextCursor,
    };
    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          userId,
          scope,
          key: idempotencyKey,
          requestHash,
          responseCode: 200,
          responseBody: response as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
    }
    return response;
  }

  async list(
    userId: string,
    metricInput?: string,
    limitInput = 50,
    beforeInput?: string,
  ) {
    const metric = metricInput ? metricMap[metricInput as HealthMetric] : undefined;
    if (metricInput && !metric) throw new BadRequestException("健康指标不正确");
    const limit = Math.min(Math.max(Number(limitInput) || 50, 1), 200);
    const before = beforeInput ? new Date(beforeInput) : undefined;
    if (before && Number.isNaN(before.valueOf())) {
      throw new BadRequestException("游标时间不正确");
    }
    const records = await this.prisma.healthRecord.findMany({
      where: {
        userId,
        ...(metric ? { metric } : {}),
        ...(before ? { observedAt: { lt: before } } : {}),
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
          ? records[records.length - 1]?.observedAt.toISOString() ?? null
          : null,
    };
  }

  async saveWarningRules(userId: string, input: unknown) {
    const body = safeObject(input);
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (rules.length > 20) throw new BadRequestException("预警设置数量过多");
    for (const item of rules) {
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
      await this.prisma.healthWarningRule.upsert({
        where: { userId_metric: { userId, metric } },
        create: {
          userId,
          metric,
          enabled: rule.enabled !== false,
          lowThreshold: low,
          highThreshold: high,
          secondaryHighThreshold:
            metric === PrismaHealthMetric.BLOOD_PRESSURE ? secondaryHigh : null,
          shareWithCare: rule.shareWithCare === true,
        },
        update: {
          enabled: rule.enabled !== false,
          lowThreshold: low,
          highThreshold: high,
          secondaryHighThreshold:
            metric === PrismaHealthMetric.BLOOD_PRESSURE ? secondaryHigh : null,
          shareWithCare: rule.shareWithCare === true,
        },
      });
    }
    return this.prisma.healthWarningRule.findMany({ where: { userId } });
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
    userId: string,
    record: HealthRecordInputContract,
  ): Promise<void> {
    const deviceBinding = record.source.deviceId
      ? await this.prisma.deviceBinding.findUnique({
          where: { hardwareKey: sha256(`${userId}:${record.source.deviceId}`) },
        })
      : null;
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.healthRecord.create({
        data: {
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
        },
      });
      if (record.ecgArtifact) {
        const file = await tx.fileObject.findUnique({
          where: { objectKey: record.ecgArtifact.uploadObjectKey },
        });
        if (
          !file ||
          file.ownerUserId !== userId ||
          file.sha256.toLowerCase() !== record.ecgArtifact.sha256.toLowerCase()
        ) {
          throw new BadRequestException("心电数据文件尚未完成上传验证");
        }
        await tx.ecgArtifact.create({
          data: {
            healthRecordId: created.id,
            objectKey: file.objectKey,
            sha256: file.sha256,
            sampleRateHz: record.ecgArtifact.sampleRateHz,
            sampleCount: record.ecgArtifact.sampleCount,
            byteSize: file.byteSize,
            compression: "gzip",
          },
        });
      }
      await this.createWarningIfNeeded(tx, userId, record);
    });
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

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
