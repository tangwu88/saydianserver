import { BadRequestException, NotFoundException } from "@nestjs/common";
export const release = "1.0.0+1";
export const product = "sayheath";
export const featureKeys = [
  "bloodPressure",
  "bloodOxygen",
  "heartRate",
  "pulse",
  "scheduledBP",
] as const;
export type Feature = (typeof featureKeys)[number];
export const sensors = ["bloodPressure", "bloodOxygen", "heartRate"] as const;
export const documents = [
  "sayheath_user_agreement",
  "sayheath_privacy_policy",
] as const;
export function requireUS() {
  if (process.env.DEPLOYMENT_SITE !== "us") throw new NotFoundException();
}
export function strictFeature(value: unknown): Feature {
  if (!featureKeys.includes(value as Feature))
    throw new BadRequestException("Unsupported feature.");
  return value as Feature;
}
export function deviceKey(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new BadRequestException("Invalid device.");
  return value;
}
export function parseValues(feature: Feature, data: unknown, unit: unknown) {
  const obj = data as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw new BadRequestException("Invalid reading.");
  const keys =
    feature === "bloodPressure" ? ["systolic", "diastolic"] : ["value"];
  if (
    Object.keys(obj).length !== keys.length ||
    !keys.every((k) => Number.isInteger(obj[k]))
  )
    throw new BadRequestException("Invalid reading.");
  const v = obj as Record<string, number>;
  if (
    feature === "bloodPressure" &&
    unit === "mmHg" &&
    v.diastolic! > 0 &&
    v.systolic! <= 255 &&
    v.diastolic! < v.systolic!
  )
    return { systolic: v.systolic!, diastolic: v.diastolic! } as Record<
      string,
      number
    >;
  if (
    (feature === "heartRate" &&
      unit === "bpm" &&
      v.value! >= 20 &&
      v.value! <= 300) ||
    (feature === "bloodOxygen" &&
      unit === "%" &&
      v.value! >= 2 &&
      v.value! <= 100)
  )
    return { value: v.value! } as Record<string, number>;
  throw new BadRequestException("Invalid reading or unit.");
}
export function activityProjection(row: {
  id: string;
  metric: string;
  observedAt: Date;
  values: unknown;
  unit: string | null;
  aggregationLocalDate: string | null;
}) {
  if (row.metric !== "STEPS" && row.metric !== "SLEEP") return null;
  const obj = row.values as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return null;
  const number = (keys: string[]) =>
    keys
      .map((k) => obj[k])
      .find((v) => typeof v === "number" && Number.isFinite(v)) as
      number | undefined;
  const isSteps = row.metric === "STEPS";
  const unit = (row.unit ?? "").toLowerCase();
  const hours = number(["hours"]),
    minutes = number(["durationMinutes", "totalMinutes", "minutes"]),
    scalar = number(["value", "duration"]);
  const value = isSteps
    ? ["", "steps", "step", "步"].includes(unit)
      ? number(["steps", "value", "count"])
      : undefined
    : minutes !== undefined && ["", "min", "minutes"].includes(unit)
      ? minutes
      : hours !== undefined && ["", "h", "hours"].includes(unit)
        ? hours * 60
        : scalar !== undefined && ["h", "hours"].includes(unit)
          ? scalar * 60
          : scalar !== undefined && ["min", "minutes"].includes(unit)
            ? scalar
            : undefined;
  if (
    value === undefined ||
    value < 0 ||
    (isSteps ? !Number.isInteger(value) : value > 1440)
  )
    return null;
  return {
    id: row.id,
    feature: isSteps ? "activity" : "sleep",
    value,
    unit: isSteps ? "steps" : "min",
    observedAt: row.observedAt.toISOString(),
    localDate: row.aggregationLocalDate,
  };
}
