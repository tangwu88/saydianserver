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
  distinctDays: number;
  firstObservedAt: string;
  latestObservedAt: string;
  latestValue: number | null;
  minimum: number | null;
  maximum: number | null;
  average: number | null;
  sourceModels: string[];
  measurements: MeasurementEvidence[];
};

export type MeasurementEvidence = {
  key: string;
  unit: string;
  sampleCount: number;
  latest: number;
  minimum: number;
  maximum: number;
  average: number;
  median: number;
  dailyAverages: { date: string; value: number; sampleCount: number }[];
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
  sleep: ["minutes", "durationMinutes", "duration", "hours", "value"],
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
  body_composition: ["weightKg", "bodyFatPercent", "bmi", "value", "BMI", "bodyFatRate"],
  blood_composition: ["uricAcid", "cholesterol", "totalCholesterol", "uricAcidVal", "value"],
};

type MeasurementDefinition = { key: string; aliases: string[]; unit: string; minimum: number; maximum: number };
const measurementDefinitions: Partial<Record<HealthMetric, MeasurementDefinition[]>> = {
  sleep: [
    { key: "durationMinutes", aliases: ["minutes", "durationMinutes", "duration", "hours", "value"], unit: "min", minimum: 0.1, maximum: 1_440 },
    { key: "deepMinutes", aliases: ["deepMinutes"], unit: "min", minimum: 0, maximum: 1_440 },
    { key: "lightMinutes", aliases: ["lightMinutes"], unit: "min", minimum: 0, maximum: 1_440 },
    { key: "remMinutes", aliases: ["remMinutes"], unit: "min", minimum: 0, maximum: 1_440 },
    { key: "awakeMinutes", aliases: ["awakeMinutes"], unit: "min", minimum: 0, maximum: 1_440 },
    { key: "wakeCount", aliases: ["wakeCount"], unit: "count", minimum: 0, maximum: 200 },
  ],
  steps: [{ key: "steps", aliases: ["steps", "value"], unit: "steps", minimum: 1, maximum: 200_000 }],
  distance: [{ key: "meters", aliases: ["meters", "value"], unit: "m", minimum: 0.1, maximum: 300_000 }],
  calories: [{ key: "kcal", aliases: ["kcal", "value"], unit: "kcal", minimum: 0.1, maximum: 30_000 }],
  heart_rate: [{ key: "bpm", aliases: ["bpm", "heartRate", "value"], unit: "bpm", minimum: 20, maximum: 250 }],
  blood_oxygen: [{ key: "percent", aliases: ["percent", "spo2", "value"], unit: "%", minimum: 50, maximum: 100 }],
  blood_pressure: [
    { key: "systolic", aliases: ["systolic", "high", "bloodPressureHigh"], unit: "mmHg", minimum: 40, maximum: 260 },
    { key: "diastolic", aliases: ["diastolic", "low", "bloodPressureLow"], unit: "mmHg", minimum: 20, maximum: 180 },
  ],
  blood_glucose: [{ key: "mmolL", aliases: ["mmolL", "glucose", "value"], unit: "mmol/L", minimum: 1, maximum: 40 }],
  temperature: [{ key: "celsius", aliases: ["celsius", "temperature", "value"], unit: "°C", minimum: 30, maximum: 45 }],
  hrv: [{ key: "ms", aliases: ["ms", "hrv", "value"], unit: "ms", minimum: 1, maximum: 1_000 }],
  ecg: [{ key: "heartRate", aliases: ["heartRate", "bpm", "value"], unit: "bpm", minimum: 20, maximum: 250 }],
  body_composition: [
    { key: "weightKg", aliases: ["weightKg"], unit: "kg", minimum: 1, maximum: 500 },
    { key: "heightCm", aliases: ["heightCm"], unit: "cm", minimum: 50, maximum: 260 },
    { key: "bmi", aliases: ["bmi", "BMI"], unit: "kg/m²", minimum: 5, maximum: 100 },
    { key: "bodyFatPercent", aliases: ["bodyFatPercent", "bodyFatRate"], unit: "%", minimum: 1, maximum: 80 },
    { key: "fatMass", aliases: ["fatMass"], unit: "kg", minimum: 0.1, maximum: 300 },
    { key: "fatFreeMass", aliases: ["fatFreeMass"], unit: "kg", minimum: 0.1, maximum: 300 },
    { key: "bodyWaterRate", aliases: ["bodyWaterRate"], unit: "%", minimum: 1, maximum: 90 },
    { key: "waterMass", aliases: ["waterMass"], unit: "kg", minimum: 0.1, maximum: 300 },
    { key: "proteinRate", aliases: ["proteinRate"], unit: "%", minimum: 0.1, maximum: 60 },
  ],
  blood_composition: [
    { key: "uricAcid", aliases: ["uricAcid", "uricAcidVal"], unit: "µmol/L", minimum: 1, maximum: 2_000 },
    { key: "totalCholesterol", aliases: ["totalCholesterol", "cholesterol"], unit: "mmol/L", minimum: 0.1, maximum: 30 },
    { key: "triglycerides", aliases: ["triglycerides"], unit: "mmol/L", minimum: 0.1, maximum: 50 },
    { key: "highDensityLipoprotein", aliases: ["highDensityLipoprotein"], unit: "mmol/L", minimum: 0.1, maximum: 10 },
    { key: "lowDensityLipoprotein", aliases: ["lowDensityLipoprotein"], unit: "mmol/L", minimum: 0.1, maximum: 20 },
  ],
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
      const metricDays = new Set(group.records.map(record => localDay(record.observedAt, record.timezoneOffsetMinutes)));
      return {
        metric,
        recordIds: group.records.map((record) => record.id),
        recordCount: group.records.length,
        distinctDays: metricDays.size,
        firstObservedAt: group.records[group.records.length - 1]!.observedAt.toISOString(),
        latestObservedAt: latest.observedAt.toISOString(),
        latestValue,
        minimum: group.values.length ? round(Math.min(...group.values)) : null,
        maximum: group.values.length ? round(Math.max(...group.values)) : null,
        average: group.values.length ? round(total / group.values.length) : null,
        sourceModels: [...group.sourceModels].sort(),
        measurements: buildMeasurements(metric, group.records),
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

function buildMeasurements(metric: HealthMetric, records: EvidenceRecord[]): MeasurementEvidence[] {
  return (measurementDefinitions[metric] ?? []).flatMap((definition) => {
    const samples = records.flatMap(record => {
      const value = measurementValue(definition, record.values);
      return value === null ? [] : [{ value, date: localDay(record.observedAt, record.timezoneOffsetMinutes), observedAt: record.observedAt }];
    });
    if (!samples.length) return [];
    samples.sort((left, right) => left.observedAt.valueOf() - right.observedAt.valueOf());
    const values = samples.map(sample => sample.value).sort((left, right) => left - right);
    const byDay = new Map<string, number[]>();
    for (const sample of samples) byDay.set(sample.date, [...(byDay.get(sample.date) ?? []), sample.value]);
    const medianIndex = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[medianIndex]! : (values[medianIndex - 1]! + values[medianIndex]!) / 2;
    return [{
      key: definition.key,
      unit: definition.unit,
      sampleCount: values.length,
      latest: round(samples[samples.length - 1]!.value),
      minimum: round(values[0]!),
      maximum: round(values[values.length - 1]!),
      average: round(values.reduce((sum, value) => sum + value, 0) / values.length),
      median: round(median),
      dailyAverages: [...byDay.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-31).map(([date, dayValues]) => ({
        date,
        value: round(dayValues.reduce((sum, value) => sum + value, 0) / dayValues.length),
        sampleCount: dayValues.length,
      })),
    }];
  });
}

function measurementValue(definition: MeasurementDefinition, input: unknown): number | null {
  const values = asObject(input);
  for (const alias of definition.aliases) {
    const value = firstNumber(values, [alias]);
    if (value === null) continue;
    const normalized = definition.key === "durationMinutes" && alias === "hours" ? value * 60 : value;
    if (inRange(normalized, definition.minimum, definition.maximum)) return normalized;
  }
  return null;
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
