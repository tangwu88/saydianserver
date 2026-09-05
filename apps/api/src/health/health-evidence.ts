import type { HealthMetric } from "@saydian/app-contracts";

export type EvidenceRecord = {
  id: string;
  metric: string;
  observedAt: Date;
  timezoneOffsetMinutes: number;
  values: unknown;
  quality: string;
  sourceModel?: string | null;
  hasEcgArtifact?: boolean;
};

export type MetricEvidence = {
  metric: HealthMetric;
  recordIds: string[];
  recordCount: number;
  latestObservedAt: string;
  latestValue: number | null;
  minimum: number | null;
  maximum: number | null;
  average: number | null;
  sourceModels: string[];
};

export type HealthEvidence = {
  validRecordIds: string[];
  invalidRecordIds: string[];
  distinctDays: number;
  metrics: MetricEvidence[];
};

const metricNames: Record<string, HealthMetric> = {
  SLEEP: "sleep",
  STEPS: "steps",
  DISTANCE: "distance",
  CALORIES: "calories",
  HEART_RATE: "heart_rate",
  BLOOD_OXYGEN: "blood_oxygen",
  BLOOD_PRESSURE: "blood_pressure",
  BLOOD_GLUCOSE: "blood_glucose",
  TEMPERATURE: "temperature",
  HRV: "hrv",
  ECG: "ecg",
  BODY_COMPOSITION: "body_composition",
  BLOOD_COMPOSITION: "blood_composition",
};

const candidates: Record<HealthMetric, string[]> = {
  sleep: ["minutes", "durationMinutes", "duration", "hours"],
  steps: ["steps", "value"],
  distance: ["meters", "value"],
  calories: ["kcal", "value"],
  heart_rate: ["bpm", "heartRate", "value"],
  blood_oxygen: ["percent", "spo2", "value"],
  blood_pressure: ["systolic", "high", "bloodPressureHigh"],
  blood_glucose: ["mmolL", "glucose", "value"],
  temperature: ["celsius", "temperature", "value"],
  hrv: ["ms", "hrv", "value"],
  ecg: ["heartRate", "bpm", "value"],
  body_composition: ["weightKg", "bodyFatPercent", "bmi", "value"],
  blood_composition: ["uricAcid", "cholesterol", "value"],
};

export function buildHealthEvidence(records: EvidenceRecord[]): HealthEvidence {
  const validRecordIds: string[] = [];
  const invalidRecordIds: string[] = [];
  const days = new Set<string>();
  const grouped = new Map<
    HealthMetric,
    { records: EvidenceRecord[]; values: number[]; sourceModels: Set<string> }
  >();

  for (const record of records) {
    const metric = metricNames[record.metric];
    if (!metric || !isUsableRecord(record, metric)) {
      invalidRecordIds.push(record.id);
      continue;
    }
    validRecordIds.push(record.id);
    days.add(localDay(record.observedAt, record.timezoneOffsetMinutes));
    const group = grouped.get(metric) ?? {
      records: [],
      values: [],
      sourceModels: new Set<string>(),
    };
    group.records.push(record);
    const value = representativeValue(metric, record.values);
    if (value !== null) group.values.push(value);
    if (record.sourceModel?.trim()) group.sourceModels.add(record.sourceModel.trim());
    grouped.set(metric, group);
  }

  const metrics = [...grouped.entries()]
    .map(([metric, group]): MetricEvidence => {
      group.records.sort((left, right) => right.observedAt.valueOf() - left.observedAt.valueOf());
      const latest = group.records[0]!;
      const latestValue = representativeValue(metric, latest.values);
      const total = group.values.reduce((sum, value) => sum + value, 0);
      return {
        metric,
        recordIds: group.records.map((record) => record.id),
        recordCount: group.records.length,
        latestObservedAt: latest.observedAt.toISOString(),
        latestValue,
        minimum: group.values.length ? round(Math.min(...group.values)) : null,
        maximum: group.values.length ? round(Math.max(...group.values)) : null,
        average: group.values.length ? round(total / group.values.length) : null,
        sourceModels: [...group.sourceModels].sort(),
      };
    })
    .sort((left, right) => left.metric.localeCompare(right.metric));

  return {
    validRecordIds,
    invalidRecordIds,
    distinctDays: days.size,
    metrics,
  };
}

export function isUsableRecord(record: EvidenceRecord, metric: HealthMetric): boolean {
  if (record.quality === "INVALID") return false;
  if (metric === "ecg" && record.hasEcgArtifact) return true;
  const values = asObject(record.values);
  if (metric === "blood_pressure") {
    const systolic = firstNumber(values, ["systolic", "high", "bloodPressureHigh"]);
    const diastolic = firstNumber(values, ["diastolic", "low", "bloodPressureLow"]);
    return inRange(systolic, 40, 260) && inRange(diastolic, 20, 180) && systolic! > diastolic!;
  }
  const value = representativeValue(metric, values);
  if (value === null) return false;
  const ranges: Record<HealthMetric, [number, number]> = {
    sleep: [0.1, 1440],
    steps: [1, 200_000],
    distance: [0.1, 300_000],
    calories: [0.1, 30_000],
    heart_rate: [20, 250],
    blood_oxygen: [50, 100],
    blood_pressure: [40, 260],
    blood_glucose: [1, 40],
    temperature: [30, 45],
    hrv: [1, 1_000],
    ecg: [20, 250],
    body_composition: [0.1, 500],
    blood_composition: [0.1, 10_000],
  };
  return inRange(value, ...ranges[metric]);
}

export function representativeValue(metric: HealthMetric, input: unknown): number | null {
  const values = asObject(input);
  const value = firstNumber(values, candidates[metric]);
  if (value === null) return null;
  if (metric === "sleep" && "hours" in values && !(
    "minutes" in values || "durationMinutes" in values || "duration" in values
  )) {
    return value * 60;
  }
  return value;
}

function localDay(observedAt: Date, timezoneOffsetMinutes: number): string {
  return new Date(observedAt.valueOf() + timezoneOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
}

function firstNumber(values: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = values[key];
    if (raw === null || raw === undefined || typeof raw === "boolean" || String(raw).trim() === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function inRange(value: number | null, minimum: number, maximum: number): boolean {
  return value !== null && value >= minimum && value <= maximum;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
