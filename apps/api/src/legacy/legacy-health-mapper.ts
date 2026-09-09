import type { HealthRecordInputContract } from "@saydian/app-contracts";
import { safeObject, sha256 } from "../common/crypto";

export function legacyDailyToCanonical(
  rows: unknown[],
  sourceId: string,
): HealthRecordInputContract[] {
  const records: HealthRecordInputContract[] = [];
  rows.forEach((value) => {
    const row = safeObject(value);
    const date = parseLegacyDate(row.date);
    if (!date) return;
    const base = {
      observedAt: date.toISOString(),
      timezoneOffsetMinutes: 480,
      source: { platform: "mini_program" as const },
    };
    const add = (
      metric: HealthRecordInputContract["metric"],
      values: HealthRecordInputContract["values"],
      unit?: string,
    ) => {
      if (
        Object.values(values).every(
          (item) => item === null || item === undefined,
        )
      )
        return;
      // Preserve the pre-normalization fingerprint so a retried old upload does not duplicate sleep.
      const fingerprintValues = { ...values };
      if (metric === "sleep" && "minutes" in fingerprintValues) {
        const { minutes, ...other } = fingerprintValues;
        Object.keys(fingerprintValues).forEach((key) => delete fingerprintValues[key]);
        Object.assign(fingerprintValues, { value: minutes, ...other });
      }
      records.push({
        id: `${sourceId}-${sha256(JSON.stringify([base.observedAt, metric, fingerprintValues])).slice(0, 40)}`,
        metric,
        ...base,
        values,
        ...(unit ? { unit } : {}),
        quality: "unknown",
      });
    };
    const pulse = Array.isArray(row.pulseReat)
      ? row.pulseReat[0]
      : row.pulseReat;
    const heartRate = numericOrNull(row.heartReat ?? pulse);
    if (heartRate != null) add("heart_rate", { value: heartRate }, "bpm");
    const pressure = safeObject(row.bloodPressure);
    if (Object.keys(pressure).length) {
      add(
        "blood_pressure",
        {
          systolic: numericOrNull(pressure.bloodPressureHigh),
          diastolic: numericOrNull(pressure.bloodPressureLow),
        },
        "mmHg",
      );
    }
    const oxygen = safeObject(row.bloodOxygen);
    const oxygenValues = Array.isArray(oxygen.oxygens) ? oxygen.oxygens : [];
    if (oxygenValues[0] != null) {
      add("blood_oxygen", { value: numericOrNull(oxygenValues[0]) }, "%");
    }
    if (row.bloodGlucose != null) {
      add(
        "blood_glucose",
        { value: numericOrNull(row.bloodGlucose) },
        "mmol/L",
      );
    }
    const temperature = safeObject(row.bodyTemperature);
    if (temperature.bodyTemperature != null) {
      add(
        "temperature",
        { value: numericOrNull(temperature.bodyTemperature) },
        "°C",
      );
    }
    const hrv = Array.isArray(row.HRVData) ? row.HRVData : [];
    if (hrv[0] != null) add("hrv", { value: numericOrNull(hrv[0]) }, "ms");
    const sleep = safeObject(row.sleepData);
    if (Object.keys(sleep).length) {
      add(
        "sleep",
        {
          minutes: numericOrNull(sleep.allSleepTime),
          deepMinutes: numericOrNull(sleep.deepSleepTime),
          lightMinutes: numericOrNull(sleep.lowSleepTime),
          wakeCount: numericOrNull(sleep.wakeCount),
        },
        "minute",
      );
    }
  });
  return records;
}

export function canonicalToLegacyDaily(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<
    string,
    Array<{ row: Record<string, unknown>; metrics: Set<string> }>
  >();
  for (const record of rows) {
    const observedAt = new Date(String(record.observedAt ?? ""));
    if (Number.isNaN(observedAt.valueOf())) continue;
    const offset =
      typeof record.timezoneOffsetMinutes === "number"
        ? record.timezoneOffsetMinutes
        : 480;
    const local = new Date(
      observedAt.valueOf() + offset * 60_000,
    ).toISOString();
    const key = observedAt.toISOString();
    const metric = String(record.metric ?? "");
    const group = grouped.get(key) ?? [];
    let entry = group.find((candidate) => !candidate.metrics.has(metric));
    if (!entry) {
      entry = {
        metrics: new Set(),
        row: {
          id: record.id,
          date: local.replace("T", " ").replace(/(?:\.000)?Z$/, ""),
          h: local.slice(11, 13),
          isHourse: local.slice(14, 19) === "00:00" ? 1 : 0,
          hourse: local.slice(11, 16),
          step: null,
          sleepData: null,
          heartReat: null,
          bloodPressure: null,
          bloodGlucose: null,
          bloodOxygen: null,
          bodyTemperature: null,
          pulseReat: null,
          HRVData: null,
        },
      };
      group.push(entry);
    }
    const row = entry.row;
    entry.metrics.add(metric);
    const values = safeObject(record.values);
    if (metric === "heart_rate") {
      const value = values.value ?? values.bpm ?? values.heartRate ?? null;
      row.heartReat = value;
      row.pulseReat = value == null ? null : [value];
    } else if (metric === "blood_pressure") {
      row.bloodPressure = {
        bloodPressureHigh: values.systolic,
        bloodPressureLow: values.diastolic,
      };
    } else if (metric === "blood_oxygen") {
      row.bloodOxygen = {
        oxygens: [values.value ?? values.percent ?? values.spo2 ?? null],
      };
    } else if (metric === "blood_glucose") {
      row.bloodGlucose = values.value;
    } else if (metric === "temperature") {
      row.bodyTemperature = { bodyTemperature: values.value };
    } else if (metric === "hrv") {
      row.HRVData = [values.value];
    } else if (metric === "sleep") {
      row.sleepData = {
        allSleepTime: values.minutes ?? values.durationMinutes ?? values.value ?? null,
        deepSleepTime: values.deepMinutes,
        lowSleepTime: values.lightMinutes,
        wakeCount: values.wakeCount,
      };
    } else if (metric === "steps") {
      row.step = values.value ?? values.steps ?? null;
    }
    grouped.set(key, group);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .flatMap(([, entries]) => entries.map((entry) => entry.row));
}

const compositionAliases = {
  body_composition: {
    BMI: "bmi", bodyFatRate: "bodyFatPercent", fatRate: "fatMass", FFM: "fatFreeMass",
    bodyWater: "bodyWaterRate", waterContent: "waterMass", proteinProportion: "proteinRate",
  },
  blood_composition: {
    uricAcidVal: "uricAcid", cholesterol: "totalCholesterol", triacylglycerol: "triglycerides",
    highDensity: "highDensityLipoprotein", lowDensity: "lowDensityLipoprotein",
  },
} as const;

export function legacyCompositionToCanonical(
  metric: keyof typeof compositionAliases,
  input: Record<string, number | string | boolean | null>,
): Record<string, number | string | boolean | null> {
  const result = { ...input };
  for (const [oldKey, key] of Object.entries(compositionAliases[metric])) {
    if (oldKey in result) {
      if (!(key in result)) result[key] = numericOrNull(result[oldKey]);
      delete result[oldKey];
    }
  }
  return result;
}

export function canonicalToLegacyComposition(metric: keyof typeof compositionAliases, input: unknown) {
  const result = { ...safeObject(input) };
  for (const [oldKey, key] of Object.entries(compositionAliases[metric])) {
    if (key in result) result[oldKey] = result[key];
  }
  return result;
}

export function numericOrNull(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    String(value).trim() === ""
  )
    return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

// The original Chinese mini-program sends local timestamps without an offset.
// Interpret those as Asia/Shanghai independently of the server's TZ.
export function parseLegacyDate(value: unknown): Date | null {
  if (value == null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (/^\d{10,13}$/.test(text)) {
    const epoch = Number(text);
    const date = new Date(epoch * (text.length <= 10 ? 1000 : 1));
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  let normalized = text.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += "T00:00:00";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized))
    normalized += "+08:00";
  const date = new Date(normalized);
  return Number.isNaN(date.valueOf()) ? null : date;
}
