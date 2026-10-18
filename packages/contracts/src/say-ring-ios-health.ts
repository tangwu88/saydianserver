export const sayRingIosHealthSettingKey = "say_ring_ios_health_display";
export const sayRingReadOnlyMetricKeys = [
  "heart_rate", "hrv", "blood_oxygen", "body_temperature", "stress",
] as const;
export type SayRingReadOnlyMetric = (typeof sayRingReadOnlyMetricKeys)[number];
export interface SayRingIosHealthDisplay {
  schemaVersion: 1;
  metrics: Record<SayRingReadOnlyMetric, boolean>;
}

export function parseSayRingIosHealthDisplay(input: unknown): SayRingIosHealthDisplay {
  const value = input as Partial<SayRingIosHealthDisplay> | null;
  if (!value || Array.isArray(value) || value.schemaVersion !== 1 ||
      Object.keys(value).some(key => !["schemaVersion", "metrics"].includes(key)))
    throw new Error("只读健康配置版本或字段无效");
  const metrics = value.metrics;
  if (!metrics || Array.isArray(metrics) || typeof metrics !== "object" ||
      Object.keys(metrics).some(key => !sayRingReadOnlyMetricKeys.includes(key as SayRingReadOnlyMetric)) ||
      sayRingReadOnlyMetricKeys.some(key => typeof metrics[key] !== "boolean"))
    throw new Error("五项只读指标必须分别设置为开启或关闭，不允许其他功能");
  return { schemaVersion: 1, metrics: Object.fromEntries(sayRingReadOnlyMetricKeys.map(key => [key, metrics[key]])) as SayRingIosHealthDisplay["metrics"] };
}

export function sayRingIosHealthDisplayOrClosed(input?: unknown): SayRingIosHealthDisplay {
  try { return parseSayRingIosHealthDisplay(input); } catch {
    return { schemaVersion: 1, metrics: { heart_rate: false, hrv: false, blood_oxygen: false, body_temperature: false, stress: false } };
  }
}
