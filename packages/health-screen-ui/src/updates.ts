import type { HealthScreenUpdates } from "@saydian/app-contracts";
export const MEASUREMENT_POLL_MS = 5000;
export const MEASUREMENT_NOTICE_MS = 20000;

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
      return {
        group: n.group,
        message: added > 0 ? `收到 ${added} 条新记录` : "数据已更新",
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
