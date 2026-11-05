import { describe, it, expect, vi } from "vitest";
import {
  prediction,
  validateRow,
  noOverlap,
  safeAiChoice,
  RELEASED_CYCLE_MODELS,
  digest,
} from "./cycle-domain";
import { CycleService } from "./cycle.service";
import { CycleController } from "./cycle.controller";
import { createHash } from "node:crypto";
const settings = {
  enabled: true,
  adultConfirmed: true,
  purposeAccepted: true,
  recordOnly: false,
  historyComplete: true,
  hideSummary: false,
  remind: false,
  recordRemind: false,
  leadDays: 2,
  hour: 9,
  minute: 0,
};
const rows = [
  {
    id: "settings",
    kind: "settings",
    revision: 1,
    deleted: false,
    data: settings,
  },
  ...["2026-07-03", "2026-07-31", "2026-08-30", "2026-10-01"].map(
    (start, i) => ({
      id: `p${i}`,
      kind: "period",
      revision: 1,
      deleted: false,
      data: {
        start,
        ...(i < 3
          ? {
              end: new Date(+new Date(start) + 5 * 86400000)
                .toISOString()
                .slice(0, 10),
            }
          : {}),
      },
    }),
  ),
];
describe("cycle forecast boundaries", () => {
  it("reproduces calendar range without default or inferred actual end", () => {
    expect(prediction(rows, "2026-10-10")).toMatchObject({
      from: "2026-10-29",
      to: "2026-11-02",
      lengths: [28, 30, 32],
      enhanced: false,
    });
    expect(rows[4]!.data).not.toHaveProperty("end");
    expect(prediction(rows.slice(0, 4), "2026-10-10")).not.toHaveProperty(
      "from",
    );
  });
  it("stops stale ranges, record-only and missing-history prediction", () => {
    expect(prediction(rows, "2026-11-04").status).toBe("needs_confirmation");
    for (const patch of [
      { recordOnly: true },
      { historyComplete: false },
      { enabled: false },
    ])
      expect(
        prediction(
          [{ ...rows[0]!, data: { ...settings, ...patch } }, ...rows.slice(1)],
          "2026-10-10",
        ),
      ).not.toHaveProperty("from");
  });
  it("rejects future, normalized invalid, overlapping dates and unsupported symptoms", () => {
    const base = {
      id: "x",
      kind: "period",
      baseRevision: 0,
      mutationId: "m1",
      deleted: false,
    };
    for (const data of [
      { start: "2026-02-30" },
      { start: "2027-01-01" },
      { start: "2026-10-02", end: "2026-10-01" },
    ])
      expect(() => validateRow({ ...base, data }, "2026-11-04")).toThrow();
    expect(() =>
      noOverlap([
        ...rows,
        {
          id: "x",
          kind: "period",
          data: { start: "2026-07-04", end: "2026-07-09" },
          revision: 1,
          deleted: false,
        },
      ]),
    ).toThrow();
    expect(() =>
      validateRow(
        {
          ...base,
          kind: "daily",
          data: { date: "2026-10-02", pain: "normal" },
        },
        "2026-11-04",
      ),
    ).toThrow();
  });
  it("allows data-free tombstones, requires deliberate enable, locks enhancement off", () => {
    expect(
      validateRow(
        {
          id: "x",
          kind: "period",
          baseRevision: 1,
          mutationId: "m1",
          deleted: true,
          data: {},
        },
        "2026-11-04",
      ).deleted,
    ).toBe(true);
    expect(() =>
      validateRow(
        {
          id: "settings",
          kind: "settings",
          baseRevision: 0,
          mutationId: "m2",
          deleted: false,
          data: { ...settings, purposeAccepted: false },
        },
        "2026-11-04",
      ),
    ).toThrow();
    expect(RELEASED_CYCLE_MODELS).toEqual([]);
  });
  it("only accepts catalogued AI actions, no generated dates/numbers or unsupported prepare", () => {
    expect(safeAiChoice({ action: "keep_wearing" }, false)).toEqual({
      action: "keep_wearing",
    });
    for (const value of [
      { action: "prepare" },
      { action: "continue_recording", date: "2026-11-10" },
      { action: "you are pregnant" },
    ])
      expect(() => safeAiChoice(value, false)).toThrow();
  });
  it("rejects session change before service access", () => {
    const service = { changes: vi.fn() };
    const controller = new CycleController(service as any);
    expect(() =>
      controller.changes({ id: "member-a" } as any, "old-account"),
    ).toThrow();
    expect(service.changes).not.toHaveBeenCalled();
    const owner = createHash("sha256")
      .update("saydian-health-owner:member:member-a")
      .digest("hex");
    controller.changes({ id: "member-a" } as any, owner, "0");
    expect(service.changes).toHaveBeenCalledWith("member-a", 0, false);
    controller.changes({ id: "member-a" } as any, owner, "0", "2");
    expect(service.changes).toHaveBeenCalledWith("member-a", 0, true);
  });
  it("uses canonical hash independent of object insertion order", () =>
    expect(digest({ b: 1, a: { c: 2, d: 3 } })).toBe(
      digest({ a: { d: 3, c: 2 }, b: 1 }),
    ));
});
function dbFixture() {
  const records = new Map<string, any>(),
    mutations = new Map<string, any>();
  let sequence = 0;
  const db: any = {
    $queryRaw: vi.fn(),
    user: { findUnique: async () => ({ status: "ACTIVE" }) },
    cycleState: {
      upsert: async () => ({ sequence, epoch: 0 }),
      update: async ({ data }: any) => {
        sequence = data.sequence;
      },
    },
    cycleRecord: {
      findUnique: async ({ where }: any) =>
        records.get(where.userId_clientId.clientId) ?? null,
      upsert: async ({ create, update, where }: any) => {
        const id = where.userId_clientId.clientId;
        const old = records.get(id);
        const row = old ? { ...old, ...update } : create;
        records.set(id, row);
        return row;
      },
      findMany: async ({ where }: any) =>
        [...records.values()].filter(
          (r) => !where.kind || r.kind === where.kind,
        ),
    },
    cycleMutation: {
      findUnique: async ({ where }: any) =>
        mutations.get(where.userId_mutationId.mutationId) ?? null,
      create: async ({ data }: any) => {
        mutations.set(data.mutationId, data);
      },
    },
    consentRecord: { updateMany: vi.fn() },
  };
  db.$transaction = async (fn: any) => fn(db);
  return { db, records };
}
describe("cycle service sync", () => {
  it("acknowledges the same initial settings from two offline phones without overwriting a different choice", async () => {
    const { db } = dbFixture();
    const service = new CycleService(db, {} as any);
    const first = {
      id: "settings",
      kind: "settings",
      data: settings,
      deleted: false,
      baseRevision: 0,
      mutationId: "first-phone",
    };
    await service.sync("a", { rows: [first] });
    const second = { ...first, mutationId: "second-phone" };
    const receipt = await service.sync("a", { rows: [second] });
    expect(receipt.results).toMatchObject([
      { mutationId: "second-phone", row: { revision: 1, data: settings } },
    ]);
    expect(await service.sync("a", { rows: [second] })).toEqual(receipt);
    expect(receipt.sequence).toBe(1);
    const different = {
      ...first,
      mutationId: "different-choice",
      data: { ...settings, recordOnly: !settings.recordOnly },
    };
    expect(
      (await service.sync("a", { rows: [different] })).results,
    ).toMatchObject([{ conflict: { revision: 1, data: settings } }]);
  });

  it("idempotently replays ACK, detects revised conflict and preserves deleted row", async () => {
    const { db, records } = dbFixture(),
      s = new CycleService(db, {} as any);
    const setting = {
      id: "settings",
      kind: "settings",
      data: settings,
      deleted: false,
      baseRevision: 0,
      mutationId: "settings-1",
    };
    await s.sync("a", { rows: [setting] });
    const input = {
      rows: [
        {
          id: "p",
          kind: "period",
          data: { start: "2026-01-01", end: "2026-01-05" },
          deleted: false,
          baseRevision: 0,
          mutationId: "p1",
        },
      ],
    };
    const first = await s.sync("a", input);
    expect(await s.sync("a", input)).toEqual(first);
    expect(records.get("p").revision).toBe(1);
    const conflict = await s.sync("a", {
      rows: [
        { ...input.rows[0], data: { start: "2026-01-02" }, mutationId: "p2" },
      ],
    });
    expect((conflict.results[0] as any).conflict.revision).toBe(1);
    await s.sync("a", {
      rows: [
        {
          ...input.rows[0],
          deleted: true,
          data: {},
          baseRevision: 1,
          mutationId: "p3",
        },
      ],
    });
    expect(records.get("p")).toMatchObject({
      deleted: true,
      data: {},
      revision: 2,
    });
  });
  it("does not accept new entries before first purpose confirmation", async () => {
    const { db } = dbFixture(),
      s = new CycleService(db, {} as any);
    await expect(
      s.sync("a", {
        rows: [
          {
            id: "p",
            kind: "period",
            data: { start: "2026-01-01" },
            deleted: false,
            baseRevision: 0,
            mutationId: "m",
          },
        ],
      }),
    ).rejects.toThrow();
  });
});
