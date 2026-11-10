/** 新增独立目录，不修改旧版 readOnlyHealth 的五项白名单。 */
export const sayRingU19HealthSettingKey = "say_ring_u19_health";
export const u19HealthCeiling = ["blood_pressure", "heart_rate", "blood_oxygen"] as const;
export function sayRingU19HealthOrClosed(raw?: unknown) {
  const closed = { schemaVersion: 1, validForSeconds: 300, readMetrics: [] as string[], manualMetrics: [] as string[] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return closed;
  const value = raw as Record<string, unknown>;
  const valid = (entries: unknown): entries is string[] => Array.isArray(entries) &&
    entries.every(item => typeof item === "string" && (u19HealthCeiling as readonly string[]).includes(item)) && new Set(entries).size === entries.length;
  if (value.schemaVersion !== 1 || !valid(value.readMetrics) || !valid(value.manualMetrics) ||
    !value.manualMetrics.every(item => (value.readMetrics as string[]).includes(item))) return closed;
  return { ...closed, readMetrics: [...value.readMetrics], manualMetrics: [...value.manualMetrics] };
}
