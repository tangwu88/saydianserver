import { BadRequestException } from "@nestjs/common";

const metrics = ["steps", "sleep", "heart_rate", "blood_oxygen", "hrv", "stress", "body_temperature"];
const states = ["not_received", "partial", "complete", "no_data", "failed"];
const counters = ["requests", "packets", "wireRows", "decodedRows", "mappedRecords", "filteredRecords"] as const;
export type SyncReadEvidence = {
  metrics: Array<{metric: string; state: string; mappingObserved: boolean} & Record<typeof counters[number], number>>;
  clock: {format: string; submission: string; verification: "not_observed"};
  monitoring?: {heartRate?: boolean; bloodOxygen?: boolean};
};
function obj(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new BadRequestException("读取摘要字段无效");
  return value as Record<string,unknown>;
}
function choice(value: unknown, allowed: readonly string[]): string {
  if (typeof value !== "string" || !allowed.includes(value)) throw new BadRequestException("读取摘要状态无效");
  return value;
}
export function parseSyncReadEvidence(input: unknown): SyncReadEvidence {
  const b = obj(input,["metrics","clock","monitoring"]);
  if (!Array.isArray(b.metrics) || b.metrics.length > metrics.length) throw new BadRequestException("读取摘要指标无效");
  const seen = new Set<string>();
  const rows = b.metrics.map(value => {
    const r = obj(value,["metric","state","mappingObserved",...counters]);
    const metric = choice(r.metric,metrics);
    if (seen.has(metric)) throw new BadRequestException("读取摘要指标重复");
    seen.add(metric);
    if (typeof r.mappingObserved !== "boolean") throw new BadRequestException("解码观察状态无效");
    const row = {metric,state:choice(r.state,states),mappingObserved:r.mappingObserved} as SyncReadEvidence["metrics"][number];
    for (const key of counters) {
      const n = r[key];
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1_000_000) throw new BadRequestException("读取摘要数量无效");
      row[key] = n;
    }
    return row;
  });
  const c = obj(b.clock,["format","submission","verification"]);
  const result: SyncReadEvidence = {metrics:rows,clock:{
    format:choice(c.format,["not_confirmed","confirmed"]),
    submission:choice(c.submission,["not_requested","pending","attempted","expired"]),
    verification:choice(c.verification,["not_observed"]) as "not_observed",
  }};
  if (b.monitoring !== undefined) {
    const m = obj(b.monitoring,["heartRate","bloodOxygen"]);
    result.monitoring = {};
    for (const key of ["heartRate","bloodOxygen"] as const) if (m[key] !== undefined) {
      if (typeof m[key] !== "boolean") throw new BadRequestException("监测状态无效");
      result.monitoring[key] = m[key] as boolean;
    }
  }
  return result;
}
