import type { HealthMetric } from "@saydian/app-contracts";

export type HealthDisplayRow = Record<string, unknown>;
export type HealthReading = { label: string; text: string };

const metricLabels: Record<HealthMetric, string> = {
  sleep: "睡眠", steps: "步数", distance: "活动距离", calories: "活动热量",
  heart_rate: "心率", blood_oxygen: "血氧饱和度", blood_pressure: "血压", blood_glucose: "血糖",
  temperature: "体温", hrv: "心率变异性（HRV）", ecg: "心电数据",
  body_composition: "身体成分", blood_composition: "血液成分",
};

// Unit-bearing keys are defined by the record contract and existing canonical/legacy mappers.
// Other values use only the submitted unit; no medical thresholds or unit conversions are applied.
const fields: Record<string, { label: string; unit?: string }> = {
  systolic: { label: "收缩压（高压）" }, high: { label: "收缩压（高压）" }, bloodPressureHigh: { label: "收缩压（高压）" },
  diastolic: { label: "舒张压（低压）" }, low: { label: "舒张压（低压）" }, bloodPressureLow: { label: "舒张压（低压）" },
  bpm: { label: "心率", unit: "bpm" }, heartRate: { label: "心率" },
  percent: { label: "血氧饱和度", unit: "%" }, spo2: { label: "血氧饱和度" },
  mmolL: { label: "血糖", unit: "mmol/L" }, glucose: { label: "血糖" },
  celsius: { label: "温度", unit: "°C" }, temperature: { label: "温度" },
  ms: { label: "心率变异性", unit: "ms" }, hrv: { label: "心率变异性" },
  minutes: { label: "睡眠时长", unit: "分钟" }, durationMinutes: { label: "睡眠时长", unit: "分钟" },
  deepMinutes: { label: "深睡时长", unit: "分钟" }, lightMinutes: { label: "浅睡时长", unit: "分钟" },
  remMinutes: { label: "快速眼动睡眠时长", unit: "分钟" }, awakeMinutes: { label: "清醒时长", unit: "分钟" },
  duration: { label: "时长" }, hours: { label: "睡眠时长", unit: "小时" }, wakeCount: { label: "醒来次数", unit: "次" },
  steps: { label: "步数", unit: "步" }, meters: { label: "距离", unit: "m" }, kcal: { label: "热量", unit: "kcal" },
  weightKg: { label: "体重", unit: "kg" }, heightCm: { label: "身高", unit: "cm" },
  bmi: { label: "身体质量指数（BMI）", unit: "无量纲" }, BMI: { label: "身体质量指数（BMI）", unit: "无量纲" },
  bodyFatPercent: { label: "体脂率", unit: "%" }, bodyFatRate: { label: "体脂率" },
  fatMass: { label: "脂肪量" }, fatFreeMass: { label: "去脂体重" }, bodyWaterRate: { label: "身体水分比例" },
  waterMass: { label: "水分量" }, proteinRate: { label: "蛋白质比例" },
  uricAcid: { label: "尿酸" }, uricAcidVal: { label: "尿酸" }, cholesterol: { label: "总胆固醇" },
  totalCholesterol: { label: "总胆固醇" }, triglycerides: { label: "甘油三酯" },
  highDensityLipoprotein: { label: "高密度脂蛋白" }, lowDensityLipoprotein: { label: "低密度脂蛋白" },
};

const metricFields: Record<HealthMetric, string[]> = {
  blood_pressure: ["systolic", "high", "bloodPressureHigh", "diastolic", "low", "bloodPressureLow"],
  heart_rate: ["bpm", "heartRate"], blood_oxygen: ["percent", "spo2"], blood_glucose: ["mmolL", "glucose"],
  temperature: ["celsius", "temperature"], hrv: ["ms", "hrv"], steps: ["steps"], distance: ["meters"], calories: ["kcal"],
  sleep: ["minutes", "durationMinutes", "duration", "hours", "deepMinutes", "lightMinutes", "remMinutes", "awakeMinutes", "wakeCount"],
  body_composition: ["weightKg", "heightCm", "bmi", "BMI", "bodyFatPercent", "bodyFatRate", "fatMass", "fatFreeMass", "bodyWaterRate", "waterMass", "proteinRate"],
  blood_composition: ["uricAcid", "uricAcidVal", "cholesterol", "totalCholesterol", "triglycerides", "highDensityLipoprotein", "lowDensityLipoprotein"],
  ecg: [],
};

function recordObject(value: unknown): HealthDisplayRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as HealthDisplayRow : {};
}

function provided(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

export function healthMetricLabel(metric: unknown): string {
  return metricLabels[String(metric ?? "").toLowerCase() as HealthMetric] ?? "其他健康记录";
}

export function healthScalar(value: unknown): string {
  if (!provided(value) || (typeof value === "number" && !Number.isFinite(value))) return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  return typeof value === "number" || typeof value === "string" ? String(value) : "详见原始数据";
}

export function healthTime(value: unknown, offsetInput: unknown = undefined): string {
  if (!provided(value)) return "未提供";
  const text = String(value);
  const parts = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):?(\d{2}))$/i.exec(text);
  if (!parts) return "时间格式未识别（原值见详情）";
  const year = Number(parts[1]); const month = Number(parts[2]); const day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!daysInMonth || day < 1 || day > daysInMonth || Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59
    || (parts[7] !== undefined && (Number(parts[7]) > 23 || Number(parts[8]) > 59))) return "时间格式未识别（原值见详情）";
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return "时间格式未识别（原值见详情）";
  const knownOffset = typeof offsetInput === "number" && Number.isInteger(offsetInput) && Math.abs(offsetInput) <= 840;
  const offset = knownOffset ? offsetInput : 0;
  const shifted = new Date(timestamp + offset * 60_000);
  if (!Number.isFinite(shifted.valueOf())) return "时间格式未识别（原值见详情）";
  const local = shifted.toISOString().replace(/\.\d{3}Z$/, "").replace("T", " ");
  const zone = `UTC${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  return `${local} ${zone}${knownOffset ? "" : "（原始时区未提供）"}`;
}

function reading(label: string, value: unknown, unit: unknown): HealthReading {
  const scalar = healthScalar(value);
  if (scalar === "未提供" || typeof value === "boolean") return { label, text: scalar };
  if (typeof value === "string" && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value)))) {
    return { label, text: "非有效数值（原值见详情）" };
  }
  return { label, text: `${scalar}${provided(unit) ? ` ${String(unit)}` : "（单位未提供）"}` };
}

export function healthReadings(row: HealthDisplayRow): HealthReading[] {
  const metric = String(row.metric ?? "").toLowerCase();
  const values = recordObject(row.values);
  if (metric === "ecg") {
    const artifact = recordObject(row.ecgArtifact);
    const hasMetadata = typeof artifact.sampleCount === "number" && artifact.sampleCount > 0
      && typeof artifact.sampleRateHz === "number" && artifact.sampleRateHz > 0;
    const status = row.hasEcgArtifact === true || hasMetadata ? "已提供波形资料"
      : row.hasEcgArtifact === false || row.ecgArtifact === null ? "未附带波形资料" : "波形可用情况未提供";
    return [{ label: "心电资料", text: status }];
  }
  const keys = Object.keys(values);
  if (metric === "blood_pressure") {
    keys.sort((left, right) => {
      const priority = (key: string) => ["systolic", "high", "bloodPressureHigh"].includes(key) ? 0 : ["diastolic", "low", "bloodPressureLow"].includes(key) ? 1 : 2;
      return priority(left) - priority(right);
    });
  }
  const readings = keys.flatMap(key => {
    const definition = key === "value" ? { label: healthMetricLabel(metric) }
      : metricFields[metric as HealthMetric]?.includes(key) ? fields[key] : undefined;
    if (!definition) return [];
    // Multi-value records can mix durations and counts: an explicit key unit takes priority.
    return [reading(definition.label, values[key], definition.unit ?? row.unit)];
  });
  return readings.length ? readings : [{ label: "测量值", text: keys.length ? "已保留原始数据，请展开查看" : "未提供" }];
}

export function healthSource(row: HealthDisplayRow): string {
  const source = recordObject(row.source);
  const platform = row.sourcePlatform ?? source.platform;
  const origin = row.sourceOrigin ?? source.origin;
  const measurement = row.sourceMeasurementSource ?? source.measurementSource;
  const platformLabels: Record<string, string> = { android: "安卓", ios: "iOS", harmony: "鸿蒙", mini_program: "小程序", migration: "数据导入" };
  const originLabels: Record<string, string> = { watch_history: "手表历史记录", app_measurement: "App 测量", remote_member: "关爱数据", manual_entry: "手动录入", imported: "导入记录", unknown: "采集来源未说明" };
  const measurementLabels: Record<string, string> = { wearable: "可穿戴设备", manual: "手动录入", imported: "导入记录" };
  const parts = [originLabels[String(origin)], measurementLabels[String(measurement)], platformLabels[String(platform)], healthScalar(row.sourceModel ?? source.model)];
  const visible = [...new Set(parts.filter((part): part is string => !!part && part !== "未提供" && part !== "详见原始数据"))];
  return visible.length ? visible.join(" · ") : [origin, measurement, platform].some(provided) ? "来源待识别（见原始数据）" : "未提供";
}

export function healthRawJson(row: HealthDisplayRow): string {
  return JSON.stringify(row, null, 2);
}
