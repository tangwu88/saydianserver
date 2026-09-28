import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { CareService } from "../care/care.service";
import { CareController } from "../care/care.controller";
import { HealthReportsService } from "../reports/health-reports.service";

const ordinary = (id: string, observedAt: string) => ({
  id, clientRecordId: id, userId: "subject", metric: "STEPS", observedAt: new Date(observedAt),
  timezoneOffsetMinutes: -240, values: { value: 2000 }, quality: "VALID",
  aggregationKind: null, aggregationLocalDate: null, supersededAt: null,
});
const daily = (id: string, localDate: string, observedAt: string) => ({
  ...ordinary(id, observedAt), aggregationKind: "daily_summary", aggregationLocalDate: localDate,
});
function matches(row: any, where: any): boolean {
  if (where.AND && !where.AND.every((part: any) => matches(row, part))) return false;
  if (where.OR && !where.OR.some((part: any) => matches(row, part))) return false;
  return Object.entries(where).every(([key, condition]: [string, any]) => {
    if (key === "AND" || key === "OR") return true;
    const value = row[key];
    if (condition === null || typeof condition !== "object") return value === condition;
    return Object.entries(condition).every(([operator, bound]: [string, any]) => {
      if (operator === "gte") return value >= bound;
      if (operator === "gt") return value > bound;
      if (operator === "lte") return value <= bound;
      if (operator === "lt") return value < bound;
      if (operator === "not") return value !== bound;
      throw new Error(`Unhandled synthetic query operator: ${operator}`);
    });
  });
}
function harness(rows: any[], timezone: string | null = "America/New_York") {
  const db = {
    healthProfile: { findUnique: vi.fn(async () => timezone ? { timezone } : null) },
    careRelationship: { findUnique: vi.fn(async () => ({
      id: "relationship", inviterId: "viewer", recipientId: "subject", status: "ACTIVE", expiresAt: null,
      permissions: [{ metric: "STEPS", enabled: true, expiresAt: null }],
    })) },
    careAccessAudit: { create: vi.fn(async () => ({})) },
    healthRecord: { findMany: vi.fn(async ({ where, skip = 0, take }: any) => rows
      .filter(row => matches(row, where)).slice(skip, skip + take)) },
  };
  return { db, care: new CareService(db as any), reports: new HealthReportsService(db as any) };
}

describe("daily summary calendar windows and compatibility", () => {
  it("keeps the legacy/default care query outside daily summaries", async () => {
    const h = harness([ordinary("ordinary", "2026-09-28T01:00:00Z"), daily("daily", "2026-09-27", "2026-09-28T02:00:00Z")]);
    const rows = await h.care.preview("viewer", "relationship", "steps", "2026-09-27T04:00:00Z", "2026-09-28T04:00:00Z");
    expect(rows.map(row => row.id)).toEqual(["ordinary"]);
  });

  it("only opts V2 care into daily summaries when the query is exactly true", () => {
    const preview = vi.fn();
    const controller = new CareController({ preview } as unknown as CareService);
    for (const include of [undefined, "false", "1", "true"]) {
      (controller.preview as any)({ id: "viewer" }, "relationship", "steps", undefined, undefined, { requestId: "request" }, include);
      expect(preview).toHaveBeenLastCalledWith("viewer", "relationship", "steps", undefined, undefined, "request", undefined, include === "true");
    }
  });

  it("care includes a late-read owned day and excludes an old day read in the window", async () => {
    const h = harness([
      daily("old-owned-day", "2026-08-01", "2026-09-27T14:00:00Z"),
      daily("late-read", "2026-09-27", "2026-09-28T14:00:00Z"),
      daily("next-owned-day", "2026-09-28", "2026-09-28T03:30:00Z"),
      ordinary("ordinary-in-range", "2026-09-27T14:00:00Z"),
      ordinary("ordinary-out-of-range", "2026-09-28T14:00:00Z"),
    ]);
    const rows = await (h.care.preview as any)("viewer", "relationship", "steps", "2026-09-27T04:00:00Z", "2026-09-28T04:00:00Z", "request", undefined, true);
    expect(rows.map((row: any) => row.id)).toEqual(["late-read", "ordinary-in-range"]);
  });

  it("report uses the member calendar, including DST, rather than the read date", async () => {
    const h = harness([
      daily("old-owned-day", "2026-10-01", "2026-11-01T14:00:00Z"),
      daily("late-read", "2026-11-01", "2026-11-03T14:00:00Z"),
      daily("before-local-midnight", "2026-10-31", "2026-11-01T14:00:00Z"),
      ordinary("ordinary-in-range", "2026-11-01T14:00:00Z"),
      ordinary("ordinary-out-of-range", "2026-11-02T05:00:00Z"),
    ]);
    const rows = await (h.reports as any).loadEvidenceRecords("subject", new Date("2026-11-01T04:00:00Z"), new Date("2026-11-02T04:59:59.999Z"));
    expect(rows.map((row: any) => row.id)).toEqual(["late-read", "ordinary-in-range"]);
  });

  it.each([null, "not-a-timezone"])("does not guess the calendar when timezone is %s", async (timezone) => {
    const h = harness([ordinary("ordinary", "2026-09-28T01:00:00Z"), daily("daily", "2026-09-27", "2026-09-28T02:00:00Z")], timezone);
    const rows = await (h.reports as any).loadEvidenceRecords("subject", new Date("2026-09-27T04:00:00Z"), new Date("2026-09-28T03:59:59.999Z"));
    expect(rows.map((row: any) => row.id)).toEqual(["ordinary"]);
  });

  it("filters outdated days and revisions before applying the care page limit", async () => {
    const h = harness([
      ...Array.from({ length: 30 }, (_, index) => daily(`old-${index}`, "2026-08-01", "2026-09-27T14:00:00Z")),
      { ...daily("superseded", "2026-09-27", "2026-09-27T14:00:00Z"), supersededAt: new Date() },
      daily("current", "2026-09-27", "2026-09-28T14:00:00Z"),
    ]);
    const rows = await (h.care.preview as any)("viewer", "relationship", "steps", "2026-09-27T04:00:00Z", "2026-09-28T04:00:00Z", "request", 1, true);
    expect(rows.map((row: any) => row.id)).toEqual(["current"]);
  });
});
