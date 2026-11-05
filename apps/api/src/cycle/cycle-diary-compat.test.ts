import { describe, expect, it, vi } from "vitest";
import { CycleService } from "./cycle.service";
import { validateRow } from "./cycle-domain";

function rig() {
  const rows = new Map<string, any>(),
    mutations = new Map<string, any>();
  let state = { sequence: 0, epoch: 0 };
  rows.set("settings", {
    clientId: "settings",
    userId: "A",
    kind: "settings",
    revision: 1,
    deleted: false,
    changeSeq: 0,
    data: { enabled: true, adultConfirmed: true, purposeAccepted: true },
  });
  const tx = {
    $queryRaw: vi.fn(),
    user: { findUnique: async () => ({ status: "ACTIVE" }) },
    cycleState: {
      upsert: async () => state,
      update: async ({ data }: any) => (state = { ...state, ...data }),
    },
    cycleRecord: {
      findUnique: async ({ where }: any) =>
        rows.get(where.userId_clientId.clientId),
      upsert: async ({ create, update }: any) => {
        const prior = rows.get(create.clientId);
        const next = prior ? { ...prior, ...update } : create;
        rows.set(create.clientId, next);
        return next;
      },
      findMany: async ({ where }: any) =>
        [...rows.values()].filter((r) =>
          where.kind
            ? r.kind === where.kind && !r.deleted
            : r.changeSeq > where.changeSeq.gt,
        ),
    },
    cycleMutation: {
      findUnique: async ({ where }: any) =>
        mutations.get(where.userId_mutationId.mutationId),
      create: async ({ data }: any) => mutations.set(data.mutationId, data),
    },
  };
  const svc = new CycleService(
    { $transaction: (op: any) => op(tx) } as never,
    {} as never,
  );
  const change = (
    rev: number,
    id: string,
    data: Record<string, unknown>,
    deleted = false,
  ) => ({
    id: "daily-2020-03-01",
    kind: "daily",
    baseRevision: rev,
    mutationId: id,
    deleted,
    data: deleted ? {} : { date: "2020-03-01", ...data },
  });
  const send = (row: ReturnType<typeof change>, extended = false) =>
    svc.sync("A", {
      epoch: 0,
      rows: [row],
      ...(extended ? { schemaVersion: 2 } : {}),
    });
  return { rows, svc, change, send };
}
describe("cycle diary capability negotiation", () => {
  it("accepts only three known unique self-reported symptoms and only from the negotiated format", () => {
    const { change } = rig();
    for (const symptoms of [
      ["headache", "headache"],
      ["unknown"],
      [null],
      "bloating",
    ])
      expect(() =>
        validateRow(change(0, "one", { symptoms }), "2020-03-03", true),
      ).toThrow();
    expect(() =>
      validateRow(change(0, "one", { symptoms: ["headache"] }), "2020-03-03"),
    ).toThrow();
  });
  it("old reads, conflicts and replays never expose symptoms; legacy edits preserve them; explicit clear and delete propagate", async () => {
    const { rows, svc, change, send } = rig(),
      id = "daily-2020-03-01";
    await send(
      change(0, "a", { flow: "light", symptoms: ["headache", "bloating"] }),
      true,
    );
    expect(await svc.changes("A", 0, true)).toMatchObject({
      schemaVersion: 2,
      rows: [{ data: { symptoms: ["headache", "bloating"] } }],
    });
    expect(JSON.stringify(await svc.changes("A"))).not.toContain("symptoms");
    expect(
      JSON.stringify(await send(change(0, "stale", { flow: "medium" }))),
    ).not.toContain("symptoms");
    const legacy = change(1, "b", { mood: "calm" });
    expect(JSON.stringify(await send(legacy))).not.toContain("symptoms");
    expect(JSON.stringify(await send(legacy))).not.toContain("symptoms");
    expect(rows.get(id).data).toMatchObject({
      mood: "calm",
      symptoms: ["headache", "bloating"],
    });
    await send(change(2, "c", { mood: "low", symptoms: [] }), true);
    expect(rows.get(id).data.symptoms).toEqual([]);
    await send(change(3, "d", { symptoms: ["lower_back_ache"] }), true);
    await send(change(4, "e", {}, true));
    expect(rows.get(id)).toMatchObject({ deleted: true, data: {} });
    expect(JSON.stringify(await svc.changes("A", 0, true))).not.toContain(
      "lower_back_ache",
    );
  });
});
