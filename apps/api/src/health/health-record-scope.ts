import type { Prisma } from "@prisma/client";

/**
 * Raw measurements are always visible. A versioned daily summary is visible
 * only while it is the active (newest) version for its fold key.
 */
export function foldedHealthRecordWhere(): Prisma.HealthRecordWhereInput {
  return {
    OR: [
      { aggregationKind: null },
      { aggregationKind: "daily_summary", aggregationActive: true },
    ],
  };
}

/**
 * Applies a business-time window without confusing a summary's upload time
 * (`observedAt`) with the device calendar day it summarizes (`localDate`).
 */
export function foldedHealthRecordPeriodWhere(
  from: Date | undefined,
  to: Date | undefined,
): Prisma.HealthRecordWhereInput {
  const observedAt: Prisma.DateTimeFilter = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
  const aggregationLocalDate: Prisma.StringNullableFilter = {
    ...(from ? { gte: from.toISOString().slice(0, 10) } : {}),
    ...(to ? { lte: to.toISOString().slice(0, 10) } : {}),
  };
  return {
    OR: [
      {
        aggregationKind: null,
        ...(from || to ? { observedAt } : {}),
      },
      {
        aggregationKind: "daily_summary",
        aggregationActive: true,
        ...(from || to ? { aggregationLocalDate } : {}),
      },
    ],
  };
}

export function healthAggregationContract(record: {
  aggregationKind?: string | null;
  aggregationLocalDate?: string | null;
}) {
  return record.aggregationKind === "daily_summary" && record.aggregationLocalDate
    ? {
        kind: "daily_summary" as const,
        localDate: record.aggregationLocalDate,
      }
    : undefined;
}
