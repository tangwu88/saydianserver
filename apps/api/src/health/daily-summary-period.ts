import type { Prisma } from "@prisma/client";

/** Daily totals have calendar-day precision, not a sampled measurement time. */
export function dailySummaryPeriodWhere(
  from: Date,
  to: Date,
  timezone: string | null | undefined,
  endInclusive = false,
): Prisma.HealthRecordWhereInput | null {
  if (typeof timezone !== "string" || !timezone.trim()) return null;
  const lastInstant = endInclusive ? to : new Date(to.valueOf() - 1);
  if (!Number.isFinite(from.valueOf()) || !Number.isFinite(lastInstant.valueOf()) || lastInstant < from) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone.trim(), calendar: "iso8601", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
    const localDate = (instant: Date) => {
      const parts = formatter.formatToParts(instant);
      const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === name)!.value;
      return `${part("year")}-${part("month")}-${part("day")}`;
    };
    return {
      aggregationKind: "daily_summary", supersededAt: null,
      aggregationLocalDate: { gte: localDate(from), lte: localDate(lastInstant) },
    };
  } catch {
    // Missing/invalid member timezone must not silently become Beijing or UTC.
    return null;
  }
}
