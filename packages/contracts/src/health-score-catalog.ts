import type { HealthScoreItemRule } from "./health-screen";
export interface ScreenScoreMetric {
  key: string;
  label: string;
  units: string[];
  reference?: {
    metric: string;
    field: string;
    context: string;
    methods: string[];
    source: string;
  };
}
const device = (
  key: string,
  label: string,
  unit: string,
): ScreenScoreMetric => ({ key, label, units: [unit] });
const bp = "https://www.nhlbi.nih.gov/health/high-blood-pressure/diagnosis";
const glucose =
  "https://www.niddk.nih.gov/health-information/diabetes/overview/tests-diagnosis";
const urate = "https://medlineplus.gov/lab-tests/uric-acid-test/";
const lipids = "https://medlineplus.gov/lab-tests/cholesterol-levels/";
function reference(
  key: string,
  label: string,
  metric: string,
  field: string,
  context: string,
  units: string[],
  methods: string[],
  source: string,
): ScreenScoreMetric {
  return {
    key,
    label,
    units,
    reference: { metric, field, context, methods, source },
  };
}
export const SCREEN_SCORE_METRICS: ScreenScoreMetric[] = [
  device("heart_rate", "心率", "bpm"),
  device("systolic", "设备收缩压", "mmHg"),
  device("diastolic", "设备舒张压", "mmHg"),
  device("blood_oxygen", "血氧", "%"),
  device("sleep_minutes", "整夜睡眠时长", "min"),
  device("steps", "日步数", "步"),
  device("distance", "日距离", "m"),
  device("calories", "日活动热量", "kcal"),
  device("temperature_skin", "皮温", "°C"),
  device("temperature_estimated_body", "估算体温", "°C"),
  device("hrv_sdnn", "HRV SDNN", "ms"),
  device("hrv_rmssd", "HRV RMSSD", "ms"),
  reference(
    "ref_bp_systolic",
    "静息收缩压（血压计）",
    "BLOOD_PRESSURE",
    "systolic",
    "RESTING",
    ["mmHg"],
    ["BLOOD_PRESSURE_MONITOR"],
    bp,
  ),
  reference(
    "ref_bp_diastolic",
    "静息舒张压（血压计）",
    "BLOOD_PRESSURE",
    "diastolic",
    "RESTING",
    ["mmHg"],
    ["BLOOD_PRESSURE_MONITOR"],
    bp,
  ),
  ...[
    ["fasting", "空腹", "FASTING"],
    ["postmeal", "餐后2小时", "AFTER_MEAL_2H"],
    ["random", "随机", "RANDOM"],
  ].map(([id, label, context]) =>
    reference(
      "ref_glucose_" + id,
      label + "血糖",
      "BLOOD_GLUCOSE",
      "value",
      context!,
      ["mmol/L", "mg/dL"],
      ["LAB_REPORT", "GLUCOSE_METER"],
      glucose,
    ),
  ),
  ...[
    ["fasting", "空腹", "FASTING"],
    ["random", "随机", "RANDOM"],
  ].map(([id, label, context]) =>
    reference(
      "ref_urate_" + id,
      label + "血尿酸",
      "URIC_ACID",
      "value",
      context!,
      ["μmol/L", "mg/dL"],
      ["LAB_REPORT", "URIC_ACID_METER"],
      urate,
    ),
  ),
  ...[
    ["tc", "总胆固醇 TC", "totalCholesterol"],
    ["tg", "甘油三酯 TG", "triglycerides"],
    ["hdl", "HDL-C", "hdl"],
    ["ldl", "LDL-C", "ldl"],
  ].map(([id, label, field]) =>
    reference(
      "ref_lipid_" + id,
      "空腹" + label,
      "BLOOD_LIPIDS",
      field!,
      "FASTING",
      ["mmol/L", "mg/dL"],
      ["LAB_REPORT", "LIPID_METER"],
      lipids,
    ),
  ),
];
export const scoreMetric = (key: string) =>
  SCREEN_SCORE_METRICS.find((m) => m.key === key);
export function newScreenScoreRule(
  metric: ScreenScoreMetric,
): HealthScoreItemRule {
  const ref = metric.reference;
  return {
    key: metric.key,
    label: metric.label,
    weight: ref ? 0 : 1,
    required: !ref,
    minDays: ref ? 1 : 3,
    minSamples: ref ? 1 : 3,
    minAge: 18,
    maxAge: null,
    gender: "ANY",
    allowedOrigins: ref
      ? [ref.methods[0]!]
      : ["watch_history", "app_measurement"],
    ...(ref ? { referenceUnit: metric.units[0] } : {}),
    bands: [],
    basis: "",
    referenceUrl: ref?.source || "",
  };
}
