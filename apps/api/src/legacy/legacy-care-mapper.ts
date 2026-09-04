import { BadRequestException } from "@nestjs/common";
import type { HealthMetric } from "@saydian/app-contracts";

const names: Record<HealthMetric, string> = {
  steps: "steps",
  calories: "reliang",
  distance: "juli",
  sleep: "sleep",
  blood_pressure: "bloodPressure",
  blood_glucose: "bloodGlucose",
  blood_oxygen: "bloodOxygen",
  temperature: "bodyTemperature",
  ecg: "ecg",
  heart_rate: "heartReat",
  hrv: "HRV",
  body_composition: "bodycomposition",
  blood_composition: "bloodcomposition",
};

const metrics = new Map<string, HealthMetric>(
  Object.entries(names).flatMap(([metric, legacy]) => [
    [metric.toLowerCase(), metric as HealthMetric],
    [legacy.toLowerCase(), metric as HealthMetric],
  ]),
);
metrics.set("pulsereat", "heart_rate");
metrics.set("heartrate", "heart_rate");

export function legacyCareMetrics(input: unknown): HealthMetric[] {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new BadRequestException("共享设置格式不正确");
    }
  }
  if (!Array.isArray(value))
    throw new BadRequestException("请选择共享的健康项目");
  return [
    ...new Set(
      value.map((item) => {
        const metric = metrics.get(String(item).trim().toLowerCase());
        if (!metric) throw new BadRequestException("共享的健康项目不正确");
        return metric;
      }),
    ),
  ];
}

export function legacyCareNames(values: string[]): string[] {
  return values
    .map((metric) => names[metric.toLowerCase() as HealthMetric])
    .filter(Boolean);
}
