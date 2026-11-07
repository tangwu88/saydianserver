import {
  SCREEN_SCORE_METRICS,
  HEALTH_REFERENCE_DEFINITIONS,
} from "@saydian/app-contracts";
import { createHash } from "node:crypto";
import type {
  HealthScreenDays,
  HealthScreenPeriod,
  HealthScreenFacts,
  HealthScreenSeries,
  HealthScreenGroup,
  HealthScoreRules,
  HealthScoreResult,
  HealthScreenRecord,
} from "@saydian/app-contracts";
import {
  referenceContexts,
  referenceMethods,
  metricGroups,
} from "./references";

export type ScreenRecord = {
  id: string;
  metric: string;
  observedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  values: unknown;
  quality: string;
  unit: string | null;
  sourceOrigin: string | null;
  sourceModel: string | null;
  sourceMetadata: unknown;
  aggregationKind: string | null;
  aggregationActive: boolean;
  aggregationLocalDate: string | null;
  sourceDeviceKey?: string | null;
  // Set only when reading MemberHealthReference; never obtained from upload metadata.
  reference?: { method: string; context: string };
};
export type Subject = { age: number | null; gender: string };
export const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
const round = (v: number) => Math.round(v * 100) / 100;
export const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
// An aggregation formats thousands of records in the same zone; reuse its ICU formatter.
let dateFormatter: { zone: string; value: Intl.DateTimeFormat } | undefined;
export function localDate(date: Date, timezone: string): string {
  if (dateFormatter?.zone !== timezone) {
    dateFormatter = {
      zone: timezone,
      value: new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
    };
  }
  const p = dateFormatter.value.formatToParts(date);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}`;
}
function shiftDate(day: string, amount: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
function startOfDay(day: string, zone: string) {
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 5; i++) {
    const p = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const get = (t: string) => p.find((x) => x.type === t)!.value;
    const rendered = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    const delta = target - rendered;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}
export function screenPeriod(
  days: HealthScreenDays,
  timezone: string | null | undefined,
  now = new Date(),
): HealthScreenPeriod {
  let zone = timezone || "Asia/Shanghai";
  try {
    localDate(now, zone);
  } catch {
    zone = "Asia/Shanghai";
  }
  const today = localDate(now, zone),
    dates = Array.from({ length: days }, (_, i) =>
      shiftDate(today, i - days + 1),
    );
  return {
    days,
    timezone: zone,
    dates,
    from: startOfDay(dates[0]!, zone),
    to: startOfDay(shiftDate(today, 1), zone),
  };
}
export function ageAt(
  birthday: Date | null,
  period: HealthScreenPeriod,
): number | null {
  if (!birthday) return null;
  const born = birthday.toISOString().slice(0, 10),
    today = period.dates.at(-1)!;
  const age =
    Number(today.slice(0, 4)) -
    Number(born.slice(0, 4)) -
    (today.slice(5) < born.slice(5) ? 1 : 0);
  return age >= 0 && age <= 130 ? age : null;
}

type Value = {
  key: string;
  metric: string;
  label: string;
  group: HealthScreenGroup;
  unit: string;
  semantics: string;
  value: number;
  reason: string | null;
  origin: string;
  referenceKey?: string | undefined;
  referenceMethod?: string;
};
const origins = [
  "watch_history",
  "app_measurement",
  "remote_member",
  "manual_entry",
  "imported",
];
export const exclusionLabels: Record<string, string> = {
  quality_unknown: "数据质量待核实",
  quality_suspect: "可疑记录",
  quality_invalid: "无效记录",
  source_unknown: "测量来源待核实",
  unit_unknown: "单位待核实",
  definition_unknown: "指标定义待核实",
  glucose_unverified: "血糖测量来源未验证",
  invalid_value: "数值不完整或超出数据格式范围",
  time_unknown: "测量时间依据待核实",
};
export function recordValues(
  record: ScreenRecord,
  includeInvalid = false,
): Value[] {
  if (record.reference) {
    const v = object(record.values),
      { method, context } = record.reference;
    const def =
      HEALTH_REFERENCE_DEFINITIONS[
        record.metric as keyof typeof HEALTH_REFERENCE_DEFINITIONS
      ];
    if (!def) return [];
    const parts = Object.entries(def.fields).filter(
      ([key]) => typeof v[key] === "number" && Number.isFinite(v[key]),
    );
    return parts.map(([key, label]) => ({
      referenceKey: SCREEN_SCORE_METRICS.find(
        (m) =>
          m.reference?.metric === record.metric &&
          m.reference.field === key &&
          m.reference.context === context &&
          m.reference.methods.includes(method) &&
          m.units.includes(record.unit || ""),
      )?.key,
      referenceMethod: method,
      key: `reference_${record.metric.toLowerCase()}_${key}_${method.toLowerCase()}_${context.toLowerCase()}_${hash(record.unit).slice(0, 6)}`,
      metric: record.metric,
      label: `${label} · 手动参考 · ${referenceContexts[context]} · ${referenceMethods[method]}`,
      group: metricGroups[record.metric]!,
      unit: record.unit!,
      semantics: "sample",
      value: v[key!] as number,
      reason: null,
      origin: "manual_entry",
    }));
  }
  const v = object(record.values),
    meta = object(record.sourceMetadata),
    origin = record.sourceOrigin || "unknown";
  let reason: string | null =
    record.quality !== "VALID"
      ? `quality_${record.quality.toLowerCase()}`
      : !origins.includes(origin) || !record.sourceModel
        ? "source_unknown"
        : !["sdk", "slot"].includes(String(meta.timeBasis)) &&
            origin !== "manual_entry"
          ? "time_unknown"
          : null;
  const unit = (record.unit || "").trim().toLowerCase();
  const get = (keys: string[]) => {
    for (const key of keys) {
      if (typeof v[key] === "number" && Number.isFinite(v[key]))
        return v[key] as number;
    }
    return null;
  };
  const result: Value[] = [];
  const add = (
    key: string,
    label: string,
    group: HealthScreenGroup,
    outUnit: string,
    value: number | null,
    min: number,
    max: number,
    semantics = "sample",
    extra: string | null = null,
  ) => {
    if (value === null) return;
    const invalid = value < min || value > max;
    if (invalid && !includeInvalid) return;
    const unknownUnit = extra === "unit_unknown";
    result.push({
      key: unknownUnit ? `${key}_unit_${hash(unit).slice(0, 6)}` : key,
      metric: record.metric,
      label: unknownUnit ? label + " · 单位待核实" : label,
      group,
      unit: unknownUnit ? record.unit || "未知单位" : outUnit,
      value,
      semantics,
      reason: invalid ? "invalid_value" : extra || reason,
      origin,
    });
  };
  const unitReason = (ok: boolean) => (ok ? null : "unit_unknown");
  switch (record.metric) {
    case "HEART_RATE":
      add(
        "heart_rate",
        "心率",
        "cardiovascular",
        "次/分",
        get(["bpm", "heartRate", "value"]),
        1,
        350,
        "sample",
        unitReason(
          ["bpm", "次/分"].includes(unit) ||
            (!unit && typeof v.bpm === "number"),
        ),
      );
      break;
    case "BLOOD_PRESSURE": {
      const u = unitReason(unit === "mmhg");
      add(
        "systolic",
        "收缩压",
        "cardiovascular",
        "mmHg",
        get(["systolic", "high", "bloodPressureHigh"]),
        1,
        400,
        "sample",
        u,
      );
      add(
        "diastolic",
        "舒张压",
        "cardiovascular",
        "mmHg",
        get(["diastolic", "low", "bloodPressureLow"]),
        1,
        300,
        "sample",
        u,
      );
      break;
    }
    case "BLOOD_OXYGEN":
      add(
        "blood_oxygen",
        "血氧",
        "oxygen",
        "%",
        get(["percent", "spo2", "value"]),
        1,
        100,
        "sample",
        unitReason(
          ["%", "percent"].includes(unit) ||
            (!unit && typeof v.percent === "number"),
        ),
      );
      break;
    case "HRV": {
      const algorithm = ["sdnn", "rmssd"].includes(meta.algorithm)
        ? String(meta.algorithm)
        : "unknown";
      add(
        `hrv_${algorithm}`,
        `HRV · ${algorithm === "unknown" ? "定义待核实" : algorithm.toUpperCase()}`,
        "cardiovascular",
        "ms",
        get(["ms", "hrv", "value"]),
        0,
        2000,
        "sample",
        unit !== "ms" && (unit || typeof v.ms !== "number")
          ? "unit_unknown"
          : algorithm === "unknown"
            ? "definition_unknown"
            : null,
      );
      break;
    }
    case "TEMPERATURE": {
      const kind =
        meta.temperatureKind === "skin"
          ? "skin"
          : meta.temperatureKind === "estimated_body"
            ? "estimated_body"
            : "unknown";
      const c = get(["celsius", "temperature", "value"]),
        known =
          ["°c", "c", "celsius"].includes(unit) ||
          (!unit && typeof v.celsius === "number");
      add(
        `temperature_${kind}${known ? "" : "_unknown_unit"}`,
        kind === "skin"
          ? "皮温"
          : kind === "estimated_body"
            ? "估算体温"
            : "温度 · 定义待核实",
        "temperature",
        known ? "°C" : record.unit || "单位待核实",
        c,
        -20,
        70,
        "sample",
        !known
          ? "unit_unknown"
          : kind === "unknown"
            ? "definition_unknown"
            : null,
      );
      break;
    }
    case "BLOOD_GLUCOSE": {
      const known = unit === "mmol/l" || (!unit && typeof v.mmolL === "number");
      add(
        known ? "blood_glucose" : "blood_glucose_unknown_unit",
        "血糖 · 来源待核实",
        "metabolic",
        known ? "mmol/L" : record.unit || "单位待核实",
        get(["mmolL", "glucose", "value"]),
        0,
        1000,
        "sample",
        known ? "glucose_unverified" : "unit_unknown",
      );
      break;
    }
    case "STEPS":
    case "DISTANCE":
    case "CALORIES": {
      const daily =
        record.aggregationKind === "daily_summary" && record.aggregationActive;
      const defined = daily || meta.valueKind === "daily_total";
      const base = record.metric.toLowerCase(),
        suffix = defined ? "" : "_samples";
      let value = get(
        record.metric === "STEPS"
          ? ["steps", "value"]
          : record.metric === "DISTANCE"
            ? ["meters", "distance", "value"]
            : ["kcal", "calories", "value"],
      );
      const validUnit =
        record.metric === "STEPS"
          ? ["steps", "步", "count"].includes(unit) ||
            (!unit && typeof v.steps === "number")
          : record.metric === "DISTANCE"
            ? ["m", "meters", "km"].includes(unit) ||
              (!unit && typeof v.meters === "number")
            : ["kcal"].includes(unit) || (!unit && typeof v.kcal === "number");
      if (
        record.metric === "DISTANCE" &&
        unit === "km" &&
        typeof v.meters !== "number" &&
        value !== null
      )
        value *= 1000;
      add(
        base + suffix,
        (
          { STEPS: "步数", DISTANCE: "距离", CALORIES: "活动热量" } as Record<
            string,
            string
          >
        )[record.metric]! + (defined ? "" : " · 采样值"),
        "activity",
        record.metric === "STEPS"
          ? "步"
          : record.metric === "DISTANCE"
            ? "m"
            : "kcal",
        value,
        0,
        1e7,
        defined ? "daily_total" : "sample",
        !validUnit ? "unit_unknown" : !defined ? "definition_unknown" : null,
      );
      break;
    }
    case "SLEEP": {
      const minutes = get(["durationMinutes", "minutes"]),
        hours = get(["hours"]);
      const known =
        minutes !== null
          ? !unit || ["min", "minutes"].includes(unit)
          : hours !== null
            ? !unit || ["h", "hours"].includes(unit)
            : ["min", "minutes", "h", "hours"].includes(unit);
      let value =
        minutes ?? (hours === null ? get(["duration", "value"]) : hours * 60);
      if (
        minutes === null &&
        hours === null &&
        ["h", "hours"].includes(unit) &&
        value !== null
      )
        value *= 60;
      const complete =
        (record.aggregationKind === "daily_summary" &&
          record.aggregationActive) ||
        meta.sleepScope === "night";
      add(
        complete ? "sleep_minutes" : "sleep_samples",
        complete ? "每晚睡眠时长" : "睡眠片段时长",
        "sleep",
        "分钟",
        value,
        0,
        1440,
        complete ? "night" : "sample",
        !known ? "unit_unknown" : !complete ? "definition_unknown" : null,
      );
      break;
    }
  }
  return result;
}
export function recordDay(r: ScreenRecord, period: HealthScreenPeriod): string {
  if (r.aggregationKind === "daily_summary" && r.aggregationLocalDate)
    return r.aggregationLocalDate;
  const values = object(r.values),
    meta = object(r.sourceMetadata);
  // Full-night records belong to wake-up day, never upload day. Unknown fragments remain samples.
  if (
    r.metric === "SLEEP" &&
    meta.sleepScope === "night" &&
    typeof values.endAt === "string" &&
    Number.isFinite(Date.parse(values.endAt))
  )
    return localDate(new Date(values.endAt), period.timezone);
  return localDate(r.observedAt, period.timezone);
}
export function displayRecord(r: ScreenRecord): HealthScreenRecord {
  return {
    id: r.id,
    metric: r.metric,
    measuredAt: r.observedAt.toISOString(),
    uploadedAt: r.createdAt.toISOString(),
    quality: r.quality,
    source: r.sourceOrigin || "unknown",
    sourceModel: r.sourceModel,
    unavailableReason: recordValues(r, true).length
      ? null
      : "指标值缺失或格式暂不支持",
    values: recordValues(r, true).map((v) => ({
      key: v.key,
      label: v.label,
      value: v.value,
      unit: v.unit,
      reason: v.reason ? exclusionLabels[v.reason] || "待核实" : null,
    })),
  };
}
type Sample = {
  recordId: string;
  value: number;
  date: string;
  at: string;
  origin: string;
  reason: string | null;
};
export class ScreenAccumulator {
  private seen = new Set<string>();
  private samples = new Map<string, { def: Value; values: Sample[] }>();
  private allDays = new Set<string>();
  private eligible = new Set<string>();
  private quality: Record<string, number> = {};
  private last: string | null = null;
  private updated: string | null = null;
  private digest = createHash("sha256");
  private count = 0;
  private unusable = 0;
  readonly evidenceIndex: Record<string, string[]> = {};
  constructor(readonly period: HealthScreenPeriod) {}
  add(r: ScreenRecord) {
    const day = recordDay(r, this.period);
    if (
      this.seen.has(r.id) ||
      !this.period.dates.includes(day) ||
      (r.aggregationKind === "daily_summary" && !r.aggregationActive)
    )
      return;
    this.seen.add(r.id);
    this.count++;
    this.allDays.add(day);
    this.quality[r.quality] = (this.quality[r.quality] || 0) + 1;
    const at = r.observedAt.toISOString(),
      updated = r.updatedAt.toISOString();
    if (!this.last || at > this.last) this.last = at;
    if (!this.updated || updated > this.updated) this.updated = updated;
    this.digest.update(
      JSON.stringify([
        r.id,
        updated,
        r.values,
        r.unit,
        r.quality,
        r.sourceOrigin,
        r.sourceModel,
        r.sourceMetadata,
        r.aggregationLocalDate,
        r.reference,
      ]),
    );
    const values = recordValues(r);
    if (!values.length) this.unusable++;
    for (const v of values) {
      const stream = this.samples.get(v.key) || { def: v, values: [] };
      stream.values.push({
        recordId: r.id,
        value: v.value,
        date: day,
        at,
        origin: v.origin,
        reason: v.reason,
      });
      this.samples.set(v.key, stream);
      if (!v.reason && !r.reference) this.eligible.add(r.id);
      (this.evidenceIndex[v.key] ??= []).push(r.id);
    }
  }
  finish(
    rules: HealthScoreRules | null,
    version: number | null,
    subject: Subject,
  ): HealthScreenFacts {
    const byKey = new Map(rules?.items.map((r) => [r.key, r]));
    const series = [...this.samples.entries()]
      .map(([key, { def, values }]): HealthScreenSeries => {
        const reference = key.startsWith("reference_");
        const refRule = def.referenceKey
          ? byKey.get(def.referenceKey)
          : undefined;
        const referenceEligible =
          !!refRule &&
          refRule.referenceUnit === def.unit &&
          refRule.allowedOrigins.includes(def.referenceMethod || "");
        if (referenceEligible)
          values.forEach((v) => {
            if (!v.reason) this.eligible.add(v.recordId);
          });
        const byDay = (eligibleOnly: boolean) =>
          this.period.dates.map((date) => {
            const list = values.filter(
              (v) =>
                v.date === date &&
                (!eligibleOnly ||
                  ((!reference || referenceEligible) && !v.reason)),
            );
            // Multiple daily device summaries cannot be added together. Use the latest reported daily total.
            const chosen =
              def.semantics === "daily_total" || def.semantics === "night"
                ? list.sort((a, b) => a.at.localeCompare(b.at)).slice(-1)
                : list;
            return {
              count: list.length,
              value: chosen.length
                ? round(chosen.reduce((s, v) => s + v.value, 0) / chosen.length)
                : null,
            };
          });
        const all = byDay(false),
          valid = byDay(true),
          last = [...values].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!;
        const average = (points: { value: number | null }[]) => {
          const vals = points.flatMap((p) =>
            p.value === null ? [] : [p.value],
          );
          return vals.length
            ? round(vals.reduce((s, v) => s + v, 0) / vals.length)
            : null;
        };
        const exclusions: Record<string, number> = {};
        values.forEach((v) => {
          if (v.reason) {
            const label = exclusionLabels[v.reason] || v.reason;
            exclusions[label] = (exclusions[label] || 0) + 1;
          }
        });
        return {
          key,
          kind: key.startsWith("reference_") ? "reference" : "device",
          metric: def.metric,
          label: def.label,
          group: def.group,
          unit: def.unit,
          semantics: def.semantics,
          count: values.length,
          eligibleCount:
            reference && !referenceEligible
              ? 0
              : values.filter((v) => !v.reason).length,
          coverageDays: all.filter((p) => p.count).length,
          eligibleDays: valid.filter((p) => p.count).length,
          latest: last.value,
          latestAt: last.at,
          average: average(all),
          eligibleAverage: average(valid),
          sources: [...new Set(values.map((v) => v.origin))],
          exclusions,
          points: this.period.dates.map((date, i) => ({
            date,
            value: all[i]!.value,
            eligibleValue: valid[i]!.value,
            count: all[i]!.count,
            eligibleCount: valid[i]!.count,
          })),
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    const score = this.score(rules, version, subject);
    return {
      period: this.period,
      recordCount: this.count,
      unusableRecordCount: this.unusable,
      eligibleRecordCount: this.eligible.size,
      coverageDays: this.allDays.size,
      lastMeasuredAt: this.last,
      dataUpdatedAt: this.updated,
      qualityCounts: this.quality,
      series,
      score,
      dataDigest: hash([
        this.period,
        this.digest.digest("hex"),
        version,
        rules,
        subject,
      ]),
    };
  }
  private score(
    rules: HealthScoreRules | null,
    version: number | null,
    subject: Subject,
  ): HealthScoreResult {
    if (!rules)
      return {
        version: null,
        title: null,
        total: null,
        reason: "评分规则待发布",
        items: [],
      };
    const items = rules.items.map((rule) => {
      const stream = this.samples.get(rule.key);
      const values = rule.referenceUnit
        ? [...this.samples.values()]
            .filter(
              ({ def }) =>
                def.referenceKey === rule.key &&
                def.unit === rule.referenceUnit &&
                rule.allowedOrigins.includes(def.referenceMethod || ""),
            )
            .flatMap((s) => s.values.filter((v) => !v.reason))
        : stream?.values.filter(
            (v) => !v.reason && rule.allowedOrigins.includes(v.origin),
          ) || [];
      const byDay = new Map<string, Sample[]>();
      values.forEach((v) =>
        byDay.set(v.date, [...(byDay.get(v.date) || []), v]),
      );
      const daily = [...byDay.values()].map((list) =>
        stream?.def.semantics === "daily_total" ||
        stream?.def.semantics === "night"
          ? [...list].sort((a, b) => a.at.localeCompare(b.at)).at(-1)!.value
          : list.reduce((s, v) => s + v.value, 0) / list.length,
      );
      const value = daily.length
        ? round(daily.reduce((s, v) => s + v, 0) / daily.length)
        : null;
      let reason: string | null = null;
      if (
        (rule.minAge !== null || rule.maxAge !== null) &&
        subject.age === null
      )
        reason = "缺少年龄资料";
      else if (
        (rule.minAge !== null && subject.age! < rule.minAge) ||
        (rule.maxAge !== null && subject.age! > rule.maxAge) ||
        (rule.gender !== "ANY" && rule.gender !== subject.gender)
      )
        reason = "不在此规则适用范围";
      else if (values.length < rule.minSamples || byDay.size < rule.minDays)
        reason = `需要至少${rule.minDays}天、${rule.minSamples}条符合来源要求的记录`;
      const band =
        value === null
          ? undefined
          : rule.bands.find(
              (b) =>
                (b.min === null || value >= b.min) &&
                (b.max === null || value < b.max),
            );
      if (!reason && !band) reason = "当前值未匹配已发布评分区间";
      return {
        key: rule.key,
        label: rule.label,
        score: reason ? null : band!.score,
        value,
        reason,
        basis: rule.basis,
        referenceUrl: rule.referenceUrl,
        count: values.length,
        days: byDay.size,
        weight: rule.weight,
      };
    });
    // No silent weight redistribution. Every weighted component must be evaluable.
    const missing = items.some(
        (item, i) =>
          (rules.items[i]!.required || item.weight > 0) && item.score === null,
      ),
      weight = items.reduce((s, i) => s + i.weight, 0);
    return {
      version,
      title: rules.title,
      total:
        missing || weight <= 0
          ? null
          : round(
              items.reduce((s, i) => s + (i.score ?? 0) * i.weight, 0) / weight,
            ),
      reason: missing
        ? "部分必需指标资料不足，暂不生成总分"
        : weight <= 0
          ? "未设置总分权重"
          : null,
      items,
    };
  }
}
