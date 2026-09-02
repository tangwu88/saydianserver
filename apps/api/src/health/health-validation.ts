import {
  healthMetrics,
  isHealthMetric,
  type HealthRecordInputContract,
  type HealthRecordRejectionContract,
} from "@saydian/app-contracts";
import { safeObject } from "../common/crypto";

const allowedPlatforms = new Set([
  "android",
  "ios",
  "mini_program",
  "migration",
]);

export type HealthValidationResult =
  | { valid: true; record: HealthRecordInputContract }
  | { valid: false; rejection: HealthRecordRejectionContract };

export function validateHealthRecord(value: unknown): HealthValidationResult {
  const raw = safeObject(value);
  const id = String(raw.id ?? "").trim();
  if (!id || id.length > 160) return rejected(id, "invalid_id", "记录编号不正确");
  const metric = String(raw.metric ?? "").trim();
  if (!isHealthMetric(metric)) {
    return rejected(id, "unsupported_metric", "当前健康指标不受支持");
  }
  const observedAt = new Date(String(raw.observedAt ?? ""));
  if (Number.isNaN(observedAt.valueOf())) {
    return rejected(id, "invalid_time", "测量时间不正确");
  }
  if (observedAt.valueOf() > Date.now() + 10 * 60_000) {
    return rejected(id, "future_time", "测量时间超出允许范围");
  }
  const timezoneOffsetMinutes = Number(raw.timezoneOffsetMinutes);
  if (
    !Number.isInteger(timezoneOffsetMinutes) ||
    timezoneOffsetMinutes < -840 ||
    timezoneOffsetMinutes > 840
  ) {
    return rejected(id, "invalid_timezone", "时区信息不正确");
  }
  const values = safeObject(raw.values);
  if (Object.keys(values).length === 0) {
    return rejected(id, "empty_values", "健康记录没有可保存的数据");
  }
  if (
    Object.values(values).some(
      (item) =>
        !(
          item === null ||
          typeof item === "string" ||
          typeof item === "boolean" ||
          (typeof item === "number" && Number.isFinite(item))
        ),
    )
  ) {
    return rejected(id, "invalid_values", "健康记录包含无效数据");
  }
  const sourceRaw = safeObject(raw.source);
  const platform = String(sourceRaw.platform ?? "");
  if (!allowedPlatforms.has(platform)) {
    return rejected(id, "invalid_source", "健康记录来源不正确");
  }
  const quality = String(raw.quality ?? "unknown");
  if (!["unknown", "valid", "suspect", "invalid"].includes(quality)) {
    return rejected(id, "invalid_quality", "数据质量标识不正确");
  }
  const source: HealthRecordInputContract["source"] = {
    platform: platform as HealthRecordInputContract["source"]["platform"],
    ...(sourceRaw.deviceId ? { deviceId: String(sourceRaw.deviceId) } : {}),
    ...(sourceRaw.model ? { model: String(sourceRaw.model) } : {}),
    ...(sourceRaw.firmware ? { firmware: String(sourceRaw.firmware) } : {}),
  };
  const ecgRaw = safeObject(raw.ecgArtifact);
  const ecgArtifact =
    metric === "ecg" && Object.keys(ecgRaw).length > 0
      ? {
          sampleRateHz: Number(ecgRaw.sampleRateHz),
          sampleCount: Number(ecgRaw.sampleCount),
          sha256: String(ecgRaw.sha256 ?? ""),
          uploadObjectKey: String(ecgRaw.uploadObjectKey ?? ""),
        }
      : undefined;
  if (
    ecgArtifact &&
    (!Number.isInteger(ecgArtifact.sampleRateHz) ||
      ecgArtifact.sampleRateHz <= 0 ||
      !Number.isInteger(ecgArtifact.sampleCount) ||
      ecgArtifact.sampleCount <= 0 ||
      !/^[a-f0-9]{64}$/i.test(ecgArtifact.sha256) ||
      !ecgArtifact.uploadObjectKey)
  ) {
    return rejected(id, "invalid_ecg_artifact", "心电数据文件信息不完整");
  }
  return {
    valid: true,
    record: {
      id,
      metric,
      observedAt: observedAt.toISOString(),
      timezoneOffsetMinutes,
      values: values as HealthRecordInputContract["values"],
      ...(raw.unit ? { unit: String(raw.unit) } : {}),
      quality: quality as NonNullable<HealthRecordInputContract["quality"]>,
      source,
      ...(ecgArtifact ? { ecgArtifact } : {}),
    },
  };
}

function rejected(
  id: string,
  code: string,
  message: string,
): HealthValidationResult {
  return { valid: false, rejection: { id, code, message } };
}

export function canonicalMetricValues(): readonly string[] {
  return healthMetrics;
}
