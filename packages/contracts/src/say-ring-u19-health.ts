/** U19 独立授权：不扩展旧版戒指 readOnlyHealth 的指标表。 */
export const sayRingU19HealthSettingKey = "say_ring_u19_health";
export const u19HealthCeiling = ["blood_pressure", "heart_rate", "blood_oxygen"] as const;
export type U19HealthMetric = (typeof u19HealthCeiling)[number];
export interface SayRingU19Health {
  schemaVersion: 1;
  validForSeconds: 300;
  readMetrics: U19HealthMetric[];
  manualMetrics: U19HealthMetric[];
}
export function parseSayRingU19Health(raw: unknown): SayRingU19Health {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("U19 配置格式无效");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !["schemaVersion", "validForSeconds", "readMetrics", "manualMetrics"].includes(key)) ||
      value.schemaVersion !== 1 || (value.validForSeconds !== undefined && value.validForSeconds !== 300))
    throw new Error("U19 配置版本或有效期无效");
  const valid = (entries: unknown): entries is U19HealthMetric[] => Array.isArray(entries) &&
    entries.every(item => typeof item === "string" && (u19HealthCeiling as readonly string[]).includes(item)) &&
    new Set(entries).size === entries.length;
  if (!valid(value.readMetrics) || !valid(value.manualMetrics) ||
      !value.manualMetrics.every(item => (value.readMetrics as string[]).includes(item)))
    throw new Error("U19 手动测量必须属于已开放的读取指标");
  return { schemaVersion: 1, validForSeconds: 300,
    readMetrics: u19HealthCeiling.filter(key => (value.readMetrics as string[]).includes(key)),
    manualMetrics: u19HealthCeiling.filter(key => (value.manualMetrics as string[]).includes(key)) };
}
export function sayRingU19HealthOrClosed(raw?: unknown): SayRingU19Health {
  try { return parseSayRingU19Health(raw); }
  catch { return { schemaVersion: 1, validForSeconds: 300, readMetrics: [], manualMetrics: [] }; }
}
