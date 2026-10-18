import type { ReportVisuals } from "@saydian/app-contracts";

export function chartGeometry(points: ReportVisuals["metrics"][number]["points"]) {
  const clean = points.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(Date.parse(p.date)) && Number.isFinite(p.value));
  if (!clean.length) return { path: "", dots: [], minimum: null, maximum: null };
  const times = clean.map(p => Date.parse(p.date)), values = clean.map(p => p.value);
  const from = Math.min(...times), span = Math.max(...times) - from;
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const dots = clean.map((p, i) => ({ ...p,
    x: span ? 12 + (times[i]! - from) / span * 276 : 150,
    y: maximum === minimum ? 42 : 70 - (p.value - minimum) / (maximum - minimum) * 56,
  }));
  return {
    minimum, maximum, dots,
    path: dots.map((p, i) => `${!i || times[i]! - times[i - 1]! > 86_400_000 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "),
  };
}

export function reportNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}
export function sleepDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "未记录";
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}
