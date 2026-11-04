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
  "harmony",
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
  const origin = sourceRaw.origin;
  const measurementSource = sourceRaw.measurementSource;
  const rawVersion = sourceRaw.rawVersion;
  if ((origin != null && (typeof origin !== "string" || !["watch_history", "app_measurement", "remote_member", "manual_entry", "imported", "unknown"].includes(origin)))
    || (measurementSource != null && (typeof measurementSource !== "string" || !["wearable", "manual", "imported"].includes(measurementSource)))
    || (rawVersion != null && (typeof rawVersion !== "number" || !Number.isSafeInteger(rawVersion) || rawVersion < 1 || rawVersion > 2147483647))) {
    return rejected(id, "invalid_source", "健康记录来源信息不正确");
  }
  const quality = String(raw.quality ?? "unknown");
  if (!["unknown", "valid", "suspect", "invalid"].includes(quality)) {
    return rejected(id, "invalid_quality", "数据质量标识不正确");
  }
  const aggregationRaw = safeObject(raw.aggregation);
  const hasAggregation = raw.aggregation != null;
  const aggregationKind = String(aggregationRaw.kind ?? "");
  const aggregationLocalDate = String(aggregationRaw.localDate ?? "");
  const parsedAggregationDate = /^\d{4}-\d{2}-\d{2}$/.test(aggregationLocalDate)
    ? new Date(`${aggregationLocalDate}T00:00:00.000Z`)
    : null;
  if (
    hasAggregation &&
    (aggregationKind !== "daily_summary" ||
      !parsedAggregationDate ||
      Number.isNaN(parsedAggregationDate.valueOf()) ||
      parsedAggregationDate.toISOString().slice(0, 10) !== aggregationLocalDate ||
      typeof sourceRaw.deviceId !== "string" ||
      !sourceRaw.deviceId.trim())
  ) {
    return rejected(
      id,
      "invalid_aggregation",
      "日汇总记录需要有效的本地日期和设备编号",
    );
  }
  // 可选溯源扩展：只保留白名单，不从当前绑定猜填旧来源或质量。
  const metadata: Partial<HealthRecordInputContract["source"]> = {};
  for (const key of ["vendor", "deviceCategory", "sourceApp"] as const) {
    const value=sourceRaw[key];
    if(value != null) {
      if(typeof value!=="string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value))return rejected(id,"invalid_source","来源标识不正确");
      metadata[key]=value;
    }
  }
  if(sourceRaw.provenance!=null){
    const p=safeObject(sourceRaw.provenance);
    const strings:Record<string,readonly string[]>={timeBasis:["sdk","slot","unknown"],temperatureKind:["skin","estimated_body","unknown"],algorithm:["sdnn","rmssd","unknown"],captureMode:["history","manual"]};
    const keys=[...Object.keys(strings),"contactVerified","intervalSeconds","validCount","rejectedCount","sdkQuality"];
    if(Object.keys(p).some(k=>!keys.includes(k)))return rejected(id,"invalid_source","未支持的采样字段");
    for(const[k,v]of Object.entries(p)){
      if(strings[k]?!strings[k].includes(String(v)):k==="contactVerified"?typeof v!=="boolean":typeof v!=="number"||!Number.isFinite(v)||v<0||v>86400)return rejected(id,"invalid_source","采样信息不正确");
    }
    metadata.provenance=p as Record<string,string|number|boolean>;
  }
  if(sourceRaw.sleepWindows!=null){
    const windows=sourceRaw.sleepWindows;
    if(metric!=="sleep"||!Array.isArray(windows)||windows.length>32)return rejected(id,"invalid_source","睡眠时间窗不正确");
    const normalized=[];
    for(const rawWindow of windows){
      const w=safeObject(rawWindow),start=new Date(String(w.startAt)),end=new Date(String(w.endAt));
      if(!["night","nap"].includes(String(w.kind))||!/^\d{4}-\d{2}-\d{2}$/.test(String(w.date))||!Number.isFinite(+start)||!Number.isFinite(+end)||+end<=+start||+end-+start>86400000||+end>Date.now()+600000)return rejected(id,"invalid_source","睡眠时间窗不正确");
      normalized.push({startAt:start.toISOString(),endAt:end.toISOString(),kind:String(w.kind),date:String(w.date)});
    }
    metadata.sleepWindows=normalized;
  }
  const source: HealthRecordInputContract["source"] = {
    ...metadata,
    platform: platform as HealthRecordInputContract["source"]["platform"],
    ...(sourceRaw.deviceId ? { deviceId: String(sourceRaw.deviceId) } : {}),
    ...(sourceRaw.model ? { model: String(sourceRaw.model) } : {}),
    ...(sourceRaw.firmware ? { firmware: String(sourceRaw.firmware) } : {}),
    ...(origin != null ? { origin: origin as NonNullable<HealthRecordInputContract["source"]["origin"]> } : {}),
    ...(measurementSource != null ? { measurementSource: measurementSource as NonNullable<HealthRecordInputContract["source"]["measurementSource"]> } : {}),
    ...(rawVersion != null ? { rawVersion: rawVersion as number } : {}),
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
      ...(hasAggregation
        ? {
            aggregation: {
              kind: "daily_summary" as const,
              localDate: aggregationLocalDate,
            },
          }
        : {}),
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
