const qualityNotices = new Set([
  "quality_unknown",
  "数据质量待核实",
  "质量待核实",
]);

/** Suppress quality-only notices without changing measurements or scoring evidence. */
export function visibleRecordReason(reason: string | null): string | null {
  return reason && !qualityNotices.has(reason) ? reason : null;
}

export function visibleExclusions(exclusions: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(exclusions).filter(([key]) => !qualityNotices.has(key)),
  );
}
