import type { HealthScreenSeries } from "@saydian/app-contracts";
export interface TrendGroup {
  key: string;
  title: string;
  unit: string;
  series: HealthScreenSeries[];
}
const labels: Record<string, string> = {
  BLOOD_PRESSURE: "血压",
  BLOOD_GLUCOSE: "血糖",
  HEART_RATE: "心率",
  URIC_ACID: "尿酸",
  BLOOD_LIPIDS: "血脂",
  BLOOD_OXYGEN: "血氧",
  SLEEP: "睡眠",
  STEPS: "步数",
  DISTANCE: "距离",
  CALORIES: "活动消耗",
};
const order = Object.keys(labels);
/** Overlay only compatible dimensions; each source/context retains its own series. */
export function groupTrends(series: HealthScreenSeries[]): TrendGroup[] {
  const groups = new Map<string, TrendGroup>();
  for (const s of series) {
    // Temperature kinds, HRV algorithms and sleep/activity definitions are never conflated.
    const dimension = [
      "TEMPERATURE",
      "HRV",
      "SLEEP",
      "BODY_COMPOSITION",
      "BLOOD_COMPOSITION",
    ].includes(s.metric)
      ? s.key
      : s.metric;
    const key = `${dimension}:${s.unit}:${s.semantics}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: labels[dimension] || s.label.split(" · ")[0]!,
        unit: s.unit,
        series: [],
      };
      groups.set(key, g);
    }
    g.series.push(s);
  }
  return [...groups.values()].sort((a, b) => {
    const rank = (s: HealthScreenSeries) =>
      order.includes(s.metric) ? order.indexOf(s.metric) : 99;
    return rank(a.series[0]!) - rank(b.series[0]!);
  });
}
export function shortSeriesLabel(s: HealthScreenSeries) {
  return s.label
    .replace("高密度脂蛋白胆固醇 ", "")
    .replace("低密度脂蛋白胆固醇 ", "")
    .replace("手动参考", "参考");
}
export function trendPath(
  points: HealthScreenSeries["points"],
  x: (i: number) => number,
  y: (n: number) => number,
) {
  let gap = true,
    d = "";
  points.forEach((p, i) => {
    if (p.value === null) {
      gap = true;
      return;
    }
    d += `${gap ? "M" : "L"}${x(i)},${y(p.value)} `;
    gap = false;
  });
  return d;
}
