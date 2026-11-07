import type {
  HealthScreenRecord,
  HealthScreenSeries,
} from "@saydian/app-contracts";

const numbers = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

export const formatScreenValue = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : numbers.format(value);

function hoursScale(metric: string, unit: string): number | null {
  if (metric.toUpperCase() !== "SLEEP") return null;
  switch (unit.trim().toLowerCase()) {
    case "分钟":
    case "min":
    case "minute":
    case "minutes":
      return 1 / 60;
    case "小时":
    case "h":
    case "hr":
    case "hour":
    case "hours":
      return 1;
    case "秒":
    case "s":
    case "sec":
    case "second":
    case "seconds":
      return 1 / 3600;
    default:
      return null;
  }
}

export function sleepValueInHours(
  metric: string,
  unit: string,
  value: number | null,
) {
  const scale = hoursScale(metric, unit);
  return {
    unit: scale === null ? unit : "小时",
    value: value === null || scale === null ? value : value * scale,
  };
}

/** Display copies only: scoring, input digests and stored measurements keep their units. */
export function sleepSeriesInHours(s: HealthScreenSeries): HealthScreenSeries {
  const scale = hoursScale(s.metric, s.unit);
  if (scale === null || (scale === 1 && s.unit === "小时")) return s;
  const convert = (value: number | null) =>
    value === null ? null : value * scale;
  return {
    ...s,
    unit: "小时",
    latest: convert(s.latest),
    average: convert(s.average),
    eligibleAverage: convert(s.eligibleAverage),
    points: s.points.map((p) => ({
      ...p,
      value: convert(p.value),
      eligibleValue: convert(p.eligibleValue),
    })),
  };
}

export function sleepRecordInHours(r: HealthScreenRecord): HealthScreenRecord {
  if (r.metric.toUpperCase() !== "SLEEP") return r;
  return {
    ...r,
    values: r.values.map((v) => {
      const scale = hoursScale(r.metric, v.unit);
      return scale === null
        ? v
        : { ...v, unit: "小时", value: v.value * scale };
    }),
  };
}
