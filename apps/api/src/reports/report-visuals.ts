import { healthMetricLabel, SLEEP_REPORT_TEMPLATE, type ReportVisuals } from "@saydian/app-contracts";
import { safeObject } from "../common/crypto";

/** Snapshot-only: no current member records, identifiers, raw stages or AI-inferred numbers. */
export function reportVisuals(report: { templateVersion?: string; metricSummary?: unknown; evidenceIndex?: unknown }): ReportVisuals {
  const rows = Array.isArray(report.metricSummary) ? report.metricSummary : [];
  if (report.templateVersion === SLEEP_REPORT_TEMPLATE) {
    const row = safeObject(rows.find(value => safeObject(value).metric === "sleep"));
    const total = finite(row.totalSeconds);
    if (total === null || total <= 0 || total > 86_400) return { version: 1, kind: "sleep", metrics: [] };
    const stages = [
      ["deepSeconds", "深睡"], ["lightSeconds", "浅睡"], ["remSeconds", "快速眼动"],
    ].map(([key, label]) => ({ key: key!, label: label!, seconds: finite(row[key!]) }));
    const known = stages.reduce((sum, stage) => sum + (stage.seconds ?? 0), 0);
    // Do not turn inconsistent or absent stage values into a plausible pie chart.
    if (known > total) stages.forEach(stage => { stage.seconds = null; });
    return {
      version: 1, kind: "sleep", metrics: [],
      sleep: {
        totalSeconds: total,
        wakeCount: finite(row.wakeCount),
        stages,
        unclassifiedSeconds: known > total ? total : total - known,
        sessionCount: Array.isArray(row.sessions) && row.sessions.length ? row.sessions.length : null,
      },
    };
  }
  const distanceVerified = safeObject(safeObject(report.evidenceIndex).dataQuality).distanceUnitsNormalized === true;
  return {
    version: 1, kind: "health",
    metrics: rows.slice(0, 20).flatMap(input => {
      const row = safeObject(input);
      const metric = String(row.metric ?? "");
      if (metric === "distance" && !distanceVerified) return [];
      if (healthMetricLabel(metric) === "其他健康记录" || !Array.isArray(row.measurements)) return [];
      return row.measurements.slice(0, 4).flatMap(input => {
        const measure = safeObject(input);
        const average = finite(measure.average), latest = finite(measure.latest), count = finite(measure.sampleCount);
        if (average === null || latest === null || count === null || count < 1) return [];
        const points = (Array.isArray(measure.dailyAverages) ? measure.dailyAverages : []).slice(-31).flatMap(input => {
          const point = safeObject(input), value = finite(point.value);
          const date = String(point.date ?? "");
          return value === null || !/^\d{4}-\d{2}-\d{2}$/.test(date) ? [] : [{ date, value }];
        }).sort((a, b) => a.date.localeCompare(b.date));
        const key = String(measure.key ?? "");
        const suffix = key === "systolic" ? " · 收缩压" : key === "diastolic" ? " · 舒张压" : "";
        return [{ key: `${metric}:${key}`, label: healthMetricLabel(metric) + suffix, unit: String(measure.unit ?? "").slice(0, 20), average, latest, sampleCount: count, points }];
      });
    }),
  };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
