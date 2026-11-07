import type { MemberHealthReference } from "@prisma/client";
import type {
  HealthReferenceInput,
  HealthReferenceRecord,
  HealthScreenGroup,
} from "@saydian/app-contracts";
import type { ScreenRecord } from "./aggregation";

import {
  HEALTH_REFERENCE_DEFINITIONS,
  HEALTH_REFERENCE_METHODS,
  HEALTH_REFERENCE_CONTEXTS,
} from "@saydian/app-contracts";
export const referenceMethods = HEALTH_REFERENCE_METHODS;
export const referenceContexts = HEALTH_REFERENCE_CONTEXTS;
export const metricGroups: Record<string, HealthScreenGroup> = {
  HEART_RATE: "cardiovascular",
  BLOOD_PRESSURE: "cardiovascular",
  HRV: "cardiovascular",
  ECG: "cardiovascular",
  BLOOD_OXYGEN: "oxygen",
  SLEEP: "sleep",
  STEPS: "activity",
  DISTANCE: "activity",
  CALORIES: "activity",
  TEMPERATURE: "temperature",
  BLOOD_GLUCOSE: "metabolic",
  URIC_ACID: "metabolic",
  BLOOD_LIPIDS: "metabolic",
  BODY_COMPOSITION: "metabolic",
  BLOOD_COMPOSITION: "metabolic",
};
// These are input format limits, not clinical normal ranges. No automatic correction or conversion.
export function validateReference(
  input: unknown,
  now = new Date(),
): HealthReferenceInput {
  const fail = (message: string): never => {
    throw new TypeError(message);
  };
  if (!input || typeof input !== "object" || Array.isArray(input))
    return fail("参考测量格式不正确");
  const p = input as HealthReferenceInput;
  const definitions = HEALTH_REFERENCE_DEFINITIONS;
  const def = Object.prototype.hasOwnProperty.call(definitions, p.metric)
    ? definitions[p.metric]
    : null;
  if (
    !def ||
    !(def.units as readonly string[]).includes(p.unit) ||
    !(def.methods as readonly string[]).includes(p.method)
  )
    return fail("请选择与指标一致的单位和参考测量来源");
  if (!(def.contexts as readonly string[]).includes(p.context))
    return fail("请选择与指标一致的测量情境");
  if (!p.values || typeof p.values !== "object" || Array.isArray(p.values))
    return fail("请填写参考测量数值");
  const keys = Object.keys(def.fields);
  const supplied = Object.keys(p.values);
  // A lab may report only part of a lipid panel. Missing components stay absent, never zero.
  if (
    !supplied.length ||
    supplied.some((k) => !keys.includes(k)) ||
    (p.metric !== "BLOOD_LIPIDS" && supplied.length !== keys.length)
  )
    return fail(
      p.metric === "BLOOD_LIPIDS"
        ? "请至少填写一项血脂指标，未检测项留空"
        : "请填写完整的参考测量数值",
    );
  for (const value of Object.values(p.values)) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value <= 0 ||
      value > (p.metric === "URIC_ACID" && p.unit === "μmol/L" ? 10000 : 1000)
    )
      return fail("数值格式不正确，请核对原始测量结果");
  }
  if (
    p.metric === "BLOOD_PRESSURE" &&
    (p.values.systolic! <= p.values.diastolic! ||
      p.values.systolic! > 400 ||
      p.values.diastolic! > 300)
  )
    return fail("请核对收缩压和舒张压是否填反或超出输入范围");
  if (p.metric === "BLOOD_OXYGEN" && p.values.value! > 100)
    return fail("血氧百分比不能超过100");
  if (p.metric === "HEART_RATE" && p.values.value! > 350)
    return fail("请核对心率数值");
  if (
    p.metric === "TEMPERATURE" &&
    p.values.value! > (p.unit === "°C" ? 60 : 140)
  )
    return fail("请核对温度单位和数值");
  if (
    typeof p.measuredAt !== "string" ||
    !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(p.measuredAt) ||
    !Number.isFinite(Date.parse(p.measuredAt)) ||
    Date.parse(p.measuredAt) > now.valueOf() ||
    Date.parse(p.measuredAt) < Date.parse("2000-01-01T00:00:00Z")
  )
    return fail("测量时间必须含时区，且不能晚于当前时间");
  if (
    typeof p.requestKey !== "string" ||
    !/^[a-f0-9-]{36}$/i.test(p.requestKey)
  )
    return fail("请求编号无效，请刷新后重试");
  return {
    metric: p.metric,
    measuredAt: new Date(p.measuredAt).toISOString(),
    unit: p.unit,
    values: Object.fromEntries(
      keys.filter((k) => supplied.includes(k)).map((k) => [k, p.values[k]!]),
    ),
    method: p.method,
    context: p.context,
    requestKey: p.requestKey,
  };
}
export function referencePublic(
  row: MemberHealthReference,
): HealthReferenceRecord {
  return {
    id: row.id,
    metric: row.metric,
    measuredAt: row.observedAt.toISOString(),
    unit: row.unit,
    values: row.values as Record<string, number>,
    method: row.method,
    context: row.context,
    createdAt: row.createdAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() || null,
    voidReason: row.voidReason,
  };
}
export function referenceScreenRecord(
  row: MemberHealthReference,
): ScreenRecord {
  return {
    ...row,
    id: `reference:${row.id}`,
    quality: "VALID",
    sourceOrigin: "manual_entry",
    sourceModel: referenceMethods[row.method] || "手动参考",
    sourceMetadata: {},
    aggregationKind: null,
    aggregationActive: true,
    aggregationLocalDate: null,
    reference: { method: row.method, context: row.context },
  };
}
