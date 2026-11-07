import type {
  HealthScreenUpdates,
  HealthScreenMeasurementUpdate,
} from "@saydian/app-contracts";
import { formatScreenValue, sleepValueInHours } from "./sleep-display";
export const MEASUREMENT_POLL_MS = 5000;
export const MEASUREMENT_NOTICE_MS = 20000;

export function measurementReadings(
  m: HealthScreenMeasurementUpdate,
): string[] {
  if (m.withdrawn) return [m.label + "已撤销"];
  const values = m.values.filter((v) => Number.isFinite(v.value));
  if (m.metric === "BLOOD_PRESSURE") {
    const high = values.find((v) => v.key.includes("systolic"));
    const low = values.find((v) => v.key.includes("diastolic"));
    if (high && low && high.unit === low.unit)
      return [
        `${m.label} ${formatScreenValue(high.value)}/${formatScreenValue(low.value)} ${high.unit}`,
      ];
  }
  if (!values.length) return [m.label + "已上报"];
  return values.map((v) => {
    const display = sleepValueInHours(m.metric, v.unit, v.value);
    const label =
      m.kind === "reference" && values.length === 1
        ? m.label
        : v.label.replace(/\s*·\s*(单位待核实|来源待核实|定义待核实)$/, "");
    return `${label} ${formatScreenValue(display.value)} ${display.unit}`.trim();
  });
}

export function changedHealthGroups(
  previous: HealthScreenUpdates | null,
  next: HealthScreenUpdates,
) {
  if (!previous) return [];
  return next.groups
    .filter((n) => {
      const p = previous.groups.find((p) => p.group === n.group);
      return !p || n.count > p.count || n.updatedAt > p.updatedAt;
    })
    .map((n) => {
      const old = previous.groups.find((p) => p.group === n.group);
      const added = n.count - (old?.count || 0);
      const measurements = (n.measurements || []).filter((m) => {
        if (!old) return true;
        if (!old.measurements) return m.updatedAt > old.updatedAt;
        return (
          old.measurements.find((p) => p.key === m.key)?.revision !== m.revision
        );
      });
      const readings = measurements.flatMap(measurementReadings);
      return {
        group: n.group,
        message: readings.length
          ? readings.join("；")
          : added > 0
            ? `收到 ${added} 条新记录`
            : "数据已更新",
        readings,
        updatedAt: n.updatedAt,
      };
    });
}

/** Track accepted uploads independently of chart refreshes or scoring eligibility. */
export class MeasurementObserver {
  private previous: HealthScreenUpdates | null = null;
  private generation = 0;
  private pending: AbortController | null = null;

  constructor(
    private readonly read: (
      signal: AbortSignal,
    ) => Promise<HealthScreenUpdates>,
  ) {}

  reset() {
    this.generation++;
    this.pending?.abort();
    this.pending = null;
    this.previous = null;
  }

  async initialize(signal: AbortSignal) {
    if (this.previous) return false;
    const generation = this.generation;
    const first = await this.read(signal);
    if (!signal.aborted && generation === this.generation && !this.previous) {
      this.previous = first;
      return true;
    }
    return false;
  }

  async check() {
    if (this.pending) return [];
    const request = new AbortController(),
      generation = this.generation;
    this.pending = request;
    try {
      const next = await this.read(request.signal);
      if (request.signal.aborted || generation !== this.generation) return [];
      const changes = changedHealthGroups(this.previous, next);
      this.previous = next;
      return changes;
    } catch (error) {
      if (request.signal.aborted || generation !== this.generation) return [];
      throw error;
    } finally {
      if (this.pending === request) this.pending = null;
    }
  }
}
