import type { HealthRecordInputContract } from "@saydian/app-contracts";
import { safeObject } from "../common/crypto";

export function legacyDailyToCanonical(
  rows: unknown[],
  sourceId: string,
): HealthRecordInputContract[] {
  const records: HealthRecordInputContract[] = [];
  rows.forEach((value, index) => {
    const row = safeObject(value);
    const date = new Date(String(row.date ?? ""));
    if (Number.isNaN(date.valueOf())) return;
    const base = {
      observedAt: date.toISOString(),
      timezoneOffsetMinutes: -date.getTimezoneOffset(),
      source: { platform: "mini_program" as const },
    };
    const add = (
      metric: HealthRecordInputContract["metric"],
      values: HealthRecordInputContract["values"],
      unit?: string,
    ) => {
      if (Object.values(values).every((item) => item === null || item === undefined)) return;
      records.push({
        id: `${sourceId}-${index}-${metric}`,
        metric,
        ...base,
        values,
        ...(unit ? { unit } : {}),
        quality: "unknown",
      });
    };
    if (row.heartReat != null) add("heart_rate", { value: Number(row.heartReat) }, "bpm");
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
      add("blood_glucose", { value: numericOrNull(row.bloodGlucose) }, "mmol/L");
    }
    const temperature = safeObject(row.bodyTemperature);
    if (temperature.bodyTemperature != null) {
      add("temperature", { value: numericOrNull(temperature.bodyTemperature) }, "°C");
    }
    const hrv = Array.isArray(row.HRVData) ? row.HRVData : [];
    if (hrv[0] != null) add("hrv", { value: numericOrNull(hrv[0]) }, "ms");
    const sleep = safeObject(row.sleepData);
    if (Object.keys(sleep).length) {
      add("sleep", {
        value: numericOrNull(sleep.allSleepTime),
        deepMinutes: numericOrNull(sleep.deepSleepTime),
        lightMinutes: numericOrNull(sleep.lowSleepTime),
        wakeCount: numericOrNull(sleep.wakeCount),
      }, "minute");
    }
  });
  return records;
}

export function canonicalToLegacyDaily(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const record of rows) {
    const observedAt = new Date(String(record.observedAt ?? ""));
    if (Number.isNaN(observedAt.valueOf())) continue;
    const key = observedAt.toISOString().slice(0, 13);
    const row = grouped.get(key) ?? {
      date: `${observedAt.toISOString().slice(0, 10)} ${String(observedAt.getUTCHours()).padStart(2, "0")}:00:00`,
      h: String(observedAt.getUTCHours()).padStart(2, "0"),
      isHourse: 1,
      hourse: `${String(observedAt.getUTCHours()).padStart(2, "0")}:00`,
      step: 0,
      sleepData: null,
      heartReat: null,
      bloodPressure: null,
      bloodGlucose: null,
      bloodOxygen: null,
      bodyTemperature: null,
      pulseReat: null,
      HRVData: null,
    };
    const metric = String(record.metric ?? "");
    const values = safeObject(record.values);
    if (metric === "heart_rate") {
      row.heartReat = values.value;
      row.pulseReat = [values.value];
    } else if (metric === "blood_pressure") {
      row.bloodPressure = {
        bloodPressureHigh: values.systolic,
        bloodPressureLow: values.diastolic,
      };
    } else if (metric === "blood_oxygen") {
      row.bloodOxygen = { oxygens: [values.value, 0, 0] };
    } else if (metric === "blood_glucose") {
      row.bloodGlucose = values.value;
    } else if (metric === "temperature") {
      row.bodyTemperature = { bodyTemperature: values.value };
    } else if (metric === "hrv") {
      row.HRVData = [values.value];
    } else if (metric === "sleep") {
      row.sleepData = {
        allSleepTime: values.value,
        deepSleepTime: values.deepMinutes,
        lowSleepTime: values.lightMinutes,
        wakeCount: values.wakeCount,
      };
    }
    grouped.set(key, row);
  }
  return [...grouped.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function numericOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
