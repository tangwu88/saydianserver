import { BadRequestException } from "@nestjs/common";
import { safeObject } from "../common/crypto";

const warningFields = [
  { metric: "heart_rate", flag: "heart_auto", high: "heart_num", defaultHigh: 120 },
  { metric: "blood_pressure", flag: "blood_pressure_auto", defaultHigh: 140, secondaryHigh: 90 },
  { metric: "blood_glucose", flag: "blood_glucose_auto" },
  { metric: "temperature", flag: "body_temperature_auto", defaultHigh: 37.5 },
] as const;

/** Defaults match the released Flutter HealthWarningSettings, with every rule disabled. */
export function canonicalToLegacyWarnings(input: unknown) {
  const rules = Array.isArray(input) ? input.map(safeObject) : [];
  const result: Record<string, number | null> = {};
  for (const field of warningFields) {
    const rule = rules.find((row) => String(row.metric).toLowerCase() === field.metric);
    result[field.flag] = rule?.enabled === true ? 1 : 0;
    if ("high" in field) result[field.high] = optionalNumber(rule?.highThreshold) ?? field.defaultHigh;
  }
  return result;
}

export function legacyWarningsToCanonical(input: unknown, currentInput: unknown) {
  const body = safeObject(input);
  const current = Array.isArray(currentInput) ? currentInput.map(safeObject) : [];
  const rules: Array<Record<string, unknown>> = [];
  for (const field of warningFields) {
    if (!(field.flag in body) && !("high" in field && field.high in body)) continue;
    const previous = current.find((row) => String(row.metric).toLowerCase() === field.metric);
    const enabled = field.flag in body ? parseFlag(body[field.flag]) : previous?.enabled === true;
    let highThreshold = optionalNumber(previous?.highThreshold) ?? ("defaultHigh" in field ? field.defaultHigh : null);
    if ("high" in field && field.high in body) {
      highThreshold = optionalNumber(body[field.high]);
      if (highThreshold === null || !Number.isInteger(highThreshold) || highThreshold < 20 || highThreshold > 300) {
        throw new BadRequestException("心率预警阈值必须为20至300的整数");
      }
    }
    const lowThreshold = optionalNumber(previous?.lowThreshold);
    if (enabled && highThreshold === null && lowThreshold === null) {
      throw new BadRequestException("请先配置该指标的预警阈值");
    }
    rules.push({
      metric: field.metric,
      enabled,
      lowThreshold,
      highThreshold,
      secondaryHighThreshold: optionalNumber(previous?.secondaryHighThreshold) ?? ("secondaryHigh" in field ? field.secondaryHigh : null),
      shareWithCare: previous?.shareWithCare === true,
    });
  }
  if (!rules.length) throw new BadRequestException("没有可保存的预警设置");
  return { rules };
}

function parseFlag(value: unknown): boolean {
  if ([true, 1, "1", "true", "on", "yes", "start"].includes(value as never)) return true;
  if ([false, 0, "0", "false", "off", "no", "stop", ""].includes(value as never)) return false;
  throw new BadRequestException("预警开关格式不正确");
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
