/** Individual-member health screen. Null is missing, never an implicit zero. */
export type HealthScreenDays = 7 | 30 | 90;
export type HealthScreenGroup =
  | "cardiovascular"
  | "oxygen"
  | "sleep"
  | "activity"
  | "temperature"
  | "metabolic";
export interface HealthScreenPeriod {
  days: HealthScreenDays;
  timezone: string;
  from: string;
  to: string;
  dates: string[];
}
export interface HealthScreenPoint {
  date: string;
  value: number | null;
  eligibleValue: number | null;
  count: number;
  eligibleCount: number;
}
export interface HealthScreenSeries {
  kind?: "device" | "reference";
  key: string;
  metric: string;
  label: string;
  group: HealthScreenGroup;
  unit: string;
  semantics: string;
  count: number;
  eligibleCount: number;
  coverageDays: number;
  eligibleDays: number;
  latest: number | null;
  latestAt: string | null;
  average: number | null;
  eligibleAverage: number | null;
  sources: string[];
  exclusions: Record<string, number>;
  points: HealthScreenPoint[];
}
export interface HealthScoreBand {
  min: number | null;
  max: number | null;
  score: number;
}
export interface HealthScoreItemRule {
  key: string;
  label: string;
  weight: number;
  required: boolean;
  minDays: number;
  minSamples: number;
  minAge: number | null;
  maxAge: number | null;
  gender: "ANY" | "MALE" | "FEMALE";
  allowedOrigins: string[];
  bands: HealthScoreBand[];
  basis: string;
  referenceUrl: string;
}
export interface HealthScoreRules {
  title: string;
  description: string;
  items: HealthScoreItemRule[];
}
export interface HealthScoreResult {
  version: number | null;
  title: string | null;
  total: number | null;
  reason: string | null;
  items: {
    key: string;
    label: string;
    score: number | null;
    value: number | null;
    reason: string | null;
    basis: string;
    referenceUrl: string;
    count: number;
    days: number;
    weight: number;
  }[];
}
export interface HealthScreenFacts {
  period: HealthScreenPeriod;
  recordCount: number;
  unusableRecordCount: number;
  eligibleRecordCount: number;
  coverageDays: number;
  lastMeasuredAt: string | null;
  dataUpdatedAt: string | null;
  series: HealthScreenSeries[];
  qualityCounts: Record<string, number>;
  score: HealthScoreResult;
  dataDigest: string;
}
export interface HealthAnalysisContent {
  summary: { text: string; evidence: string[] }[];
  insights: { key: string; text: string; evidence: string[] }[];
  suggestions: { text: string; evidence: string[] }[];
  limitations: string[];
}
export interface MemberAnalysisResult {
  id: string;
  status: "QUEUED" | "GENERATING" | "READY" | "FAILED" | "REVOKED";
  createdAt: string;
  generatedAt: string | null;
  period: HealthScreenPeriod;
  inputDigest: string;
  ruleVersion: number | null;
  content: HealthAnalysisContent | null;
  failureReason: string | null;
}
export interface HealthScreenResponse extends HealthScreenFacts {
  member: {
    id: string;
    memberNo: number;
    nickname: string;
    gender: string;
    age: number | null;
  };
  analysis: MemberAnalysisResult | null;
  analysisStale: boolean;
  availability: {
    canGenerate: boolean;
    reasons: string[];
    credits: number;
    consentBypass: boolean;
    creditBypass: boolean;
  };
  fetchedAt: string;
}
export interface HealthScreenRecord {
  unavailableReason: string | null;
  id: string;
  metric: string;
  measuredAt: string;
  uploadedAt: string;
  quality: string;
  source: string;
  sourceModel: string | null;
  values: {
    key: string;
    label: string;
    value: number;
    unit: string;
    reason: string | null;
  }[];
}
export interface HealthScreenRecords {
  items: HealthScreenRecord[];
  nextCursor: string | null;
}
export interface HealthScreenTransport {
  updates(
    memberId: string,
    days: HealthScreenDays,
    signal: AbortSignal,
  ): Promise<HealthScreenUpdates>;
  references(
    memberId: string,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<HealthReferencePage>;
  saveReference(
    memberId: string,
    input: HealthReferenceInput,
  ): Promise<HealthReferenceRecord>;
  voidReference(
    memberId: string,
    id: string,
    reason: string,
  ): Promise<HealthReferenceRecord>;
  load(
    memberId: string,
    days: HealthScreenDays,
    signal: AbortSignal,
  ): Promise<HealthScreenResponse>;
  records(
    memberId: string,
    days: HealthScreenDays,
    metric: string,
    cursor: string | null,
    signal: AbortSignal,
    reason?: string,
  ): Promise<HealthScreenRecords>;
  generate(
    memberId: string,
    days: HealthScreenDays,
    inputDigest: string,
    requestKey: string,
  ): Promise<MemberAnalysisResult>;
  result(
    memberId: string,
    id: string,
    signal: AbortSignal,
  ): Promise<MemberAnalysisResult>;
}
export interface HealthScreenUpdates {
  groups: { group: HealthScreenGroup; count: number; updatedAt: string }[];
}
export interface HealthReferenceInput {
  metric:
    | "BLOOD_GLUCOSE"
    | "BLOOD_PRESSURE"
    | "URIC_ACID"
    | "BLOOD_LIPIDS"
    | "HEART_RATE"
    | "BLOOD_OXYGEN"
    | "TEMPERATURE";
  measuredAt: string;
  unit: string;
  values: Record<string, number>;
  method:
    | "GLUCOSE_METER"
    | "URIC_ACID_METER"
    | "LIPID_METER"
    | "BLOOD_PRESSURE_MONITOR"
    | "PULSE_OXIMETER"
    | "THERMOMETER"
    | "LAB_REPORT";
  context: "FASTING" | "AFTER_MEAL_2H" | "RANDOM" | "RESTING";
  requestKey: string;
}
/** Reference-only vocabulary; does not extend the wearable upload metric enum. */
export const HEALTH_REFERENCE_DEFINITIONS = {
  BLOOD_GLUCOSE: {
    label: "血糖",
    units: ["mmol/L", "mg/dL"],
    methods: ["GLUCOSE_METER", "LAB_REPORT"],
    contexts: ["FASTING", "AFTER_MEAL_2H", "RANDOM"],
    fields: { value: "血糖" },
  },
  BLOOD_PRESSURE: {
    label: "血压",
    units: ["mmHg"],
    methods: ["BLOOD_PRESSURE_MONITOR"],
    contexts: ["RESTING"],
    fields: { systolic: "收缩压", diastolic: "舒张压" },
  },
  URIC_ACID: {
    label: "尿酸",
    units: ["μmol/L", "mg/dL"],
    methods: ["LAB_REPORT", "URIC_ACID_METER"],
    contexts: ["FASTING", "RANDOM"],
    fields: { value: "尿酸" },
  },
  BLOOD_LIPIDS: {
    label: "血脂",
    units: ["mmol/L", "mg/dL"],
    methods: ["LAB_REPORT", "LIPID_METER"],
    contexts: ["FASTING", "RANDOM"],
    fields: {
      totalCholesterol: "总胆固醇 TC",
      triglycerides: "甘油三酯 TG",
      hdl: "高密度脂蛋白胆固醇 HDL-C",
      ldl: "低密度脂蛋白胆固醇 LDL-C",
    },
  },
  HEART_RATE: {
    label: "心率",
    units: ["bpm"],
    methods: ["BLOOD_PRESSURE_MONITOR", "PULSE_OXIMETER"],
    contexts: ["RESTING"],
    fields: { value: "心率" },
  },
  BLOOD_OXYGEN: {
    label: "血氧",
    units: ["%"],
    methods: ["PULSE_OXIMETER", "LAB_REPORT"],
    contexts: ["RESTING"],
    fields: { value: "血氧" },
  },
  TEMPERATURE: {
    label: "实测体温",
    units: ["°C", "°F"],
    methods: ["THERMOMETER"],
    contexts: ["RESTING"],
    fields: { value: "实测体温" },
  },
} as const;
export const HEALTH_REFERENCE_METHODS: Record<string, string> = {
  GLUCOSE_METER: "血糖仪",
  URIC_ACID_METER: "尿酸仪",
  LIPID_METER: "血脂仪",
  LAB_REPORT: "检验单",
  BLOOD_PRESSURE_MONITOR: "血压计",
  PULSE_OXIMETER: "血氧仪",
  THERMOMETER: "体温计",
};
export const HEALTH_REFERENCE_CONTEXTS: Record<string, string> = {
  FASTING: "空腹",
  AFTER_MEAL_2H: "餐后2小时",
  RANDOM: "随机 / 非空腹",
  RESTING: "静息",
};
export interface HealthReferenceRecord {
  id: string;
  metric: string;
  measuredAt: string;
  unit: string;
  values: Record<string, number>;
  method: string;
  context: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
export interface HealthReferencePage {
  items: HealthReferenceRecord[];
  nextCursor: string | null;
}
export interface HealthScoreRuleVersion {
  id: string;
  version: number;
  status: string;
  rules: HealthScoreRules;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}
