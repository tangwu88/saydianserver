import { describe, expect, it, vi } from "vitest";
import { HealthService, healthPageCursor, healthPageFilter } from "./health.service";
import type { PrismaService } from "../common/prisma.service";

const userId = "11111111-1111-4111-a111-111111111111";
const rowId = "22222222-2222-4222-a222-222222222222";
const inputRecord = (id = "synthetic-record") => ({
  id, metric: "heart_rate", observedAt: "2026-01-01T00:00:00.000Z",
  timezoneOffsetMinutes: 480, values: { bpm: 72, unknown: null }, quality: "unknown",
  source: { platform: "migration", model: "SYSTEM-QA" },
});
function harness() {
  let rows: any[] = [], idempotency: any[] = [];
  let failCommit = false;
  const tx: any = {
    $executeRaw: vi.fn(async () => 1),
    healthRecord: {
      findUnique: vi.fn(async ({ where }: any) => rows.find(r => r.userId === where.userId_clientRecordId.userId && r.clientRecordId === where.userId_clientRecordId.clientRecordId) ?? null),
      findFirst: vi.fn(async ({ where }: any) => rows.find(r =>
        r.userId === where.userId
        && (where.metric == null || r.metric === where.metric)
        && (where.sourceDeviceKey == null || r.sourceDeviceKey === where.sourceDeviceKey)
        && (where.aggregationKind == null || r.aggregationKind === where.aggregationKind)
        && (where.aggregationLocalDate == null || r.aggregationLocalDate === where.aggregationLocalDate)
        && (where.aggregationActive == null || r.aggregationActive === where.aggregationActive)) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        rows = rows.map((row) => {
          if (row.id !== where.id || (where.aggregationActive != null && row.aggregationActive !== where.aggregationActive)) return row;
          count += 1;
          return { ...row, ...data };
        });
        return { count };
      }),
      create: vi.fn(async ({ data }: any) => { const row = { id: `db-row-${rows.length + 1}`, ...data, ecgArtifact: null }; rows.push(row); return row; }),
      findMany: vi.fn(async ({ where }: any = {}) => rows.filter(row =>
        where?.aggregationKind === null
          ? row.aggregationKind == null
          : row.aggregationKind == null || row.aggregationActive)),
    },
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: any) => idempotency.find(r => r.key === where.userId_scope_key.key) ?? null),
      create: vi.fn(async ({ data }: any) => { if (failCommit) throw new Error("synthetic storage failure"); idempotency.push(data); return data; }),
    },
    deviceBinding: { findUnique: vi.fn(async () => null) },
    fileObject: { findUnique: vi.fn(async () => null) },
    ecgArtifact: { findUnique: vi.fn(async () => null), create: vi.fn() },
    healthWarningRule: { findUnique: vi.fn(async () => null) },
  };
  const prisma: any = { ...tx, $transaction: vi.fn(async (work: any) => {
    const snapshotRows = structuredClone(rows), snapshotIdempotency = structuredClone(idempotency);
    try { return await work(tx); } catch (error) { rows = snapshotRows; idempotency = snapshotIdempotency; throw error; }
  }) };
  return { service: new HealthService(prisma as PrismaService), prisma, tx,
    rows: () => rows, idem: () => idempotency, failCommit: () => { failCommit = true; } };
}
describe("health ingestion durable idempotency", () => {
  it("holds the member lock and stores records with the response in one transaction", async () => {
    const h = harness(), body = { records: [inputRecord()] };
    const result = await h.service.ingestBatch(userId, "same-request-key", body);
    expect(result.acceptedIds).toEqual(["synthetic-record"]);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(h.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(h.tx.idempotencyRecord.findUnique.mock.invocationCallOrder[0]!);
    expect(h.rows()).toHaveLength(1); expect(h.idem()).toHaveLength(1);
    expect(await h.service.ingestBatch(userId, "same-request-key", body)).toEqual(result);
    expect(h.tx.healthRecord.create).toHaveBeenCalledTimes(1);
  });
  it("rejects reuse of an idempotency key with a different payload", async () => {
    const h = harness();
    await h.service.ingestBatch(userId, "same-request-key", { records: [inputRecord()] });
    await expect(h.service.ingestBatch(userId, "same-request-key", { records: [inputRecord("other")] })).rejects.toThrow("同一幂等键");
    expect(h.rows()).toHaveLength(1);
  });
  it("accepts an identical record on a different key regardless of value key order", async () => {
    const h = harness(), record = inputRecord();
    await h.service.ingestBatch(userId, "first-request-key", { records: [record] });
    const result = await h.service.ingestBatch(userId, "second-request-key", { records: [{ ...record, values: { unknown: null, bpm: 72 } }] });
    expect(result.acceptedIds).toEqual([record.id]); expect(result.rejected).toEqual([]);
    expect(h.rows()).toHaveLength(1);
  });
  it("rejects conflicting content for the same client record ID", async () => {
    const h = harness(), record = inputRecord();
    await h.service.ingestBatch(userId, "first-request-key", { records: [record] });
    const result = await h.service.ingestBatch(userId, "second-request-key", { records: [{ ...record, values: { bpm: 73 } }] });
    expect(result.acceptedIds).toEqual([]);
    expect(result.rejected[0]?.code).toBe("record_conflict");
    expect(h.rows()[0].values.bpm).toBe(72);
  });
  it("rolls back saved data when response persistence fails, so retries cannot lie", async () => {
    const h = harness(); h.failCommit();
    await expect(h.service.ingestBatch(userId, "first-request-key", { records: [inputRecord()] })).rejects.toThrow("synthetic storage failure");
    expect(h.rows()).toHaveLength(0); expect(h.idem()).toHaveLength(0);
  });
  it("returns validation rejections without discarding other valid records", async () => {
    const h = harness();
    const result = await h.service.ingestBatch(userId, "first-request-key", { records: [inputRecord(), { ...inputRecord("invalid"), metric: "fictional" }] });
    expect(result.acceptedIds).toEqual(["synthetic-record"]); expect(result.rejected).toHaveLength(1);
    expect(h.rows()).toHaveLength(1);
  });
  it("rejects an ECG object already associated to another record before creating a row", async () => {
    const h = harness(), sha = "a".repeat(64);
    h.tx.fileObject.findUnique.mockResolvedValue({ ownerUserId: userId, status: "ACTIVE", sha256: sha, objectKey: "SYSTEM-QA/ecg", byteSize: 8 });
    h.tx.ecgArtifact.findUnique.mockResolvedValue({ healthRecordId: rowId });
    const result = await h.service.ingestBatch(userId, "first-request-key", { records: [{
      ...inputRecord(), metric: "ecg", ecgArtifact: { uploadObjectKey: "SYSTEM-QA/ecg", sha256: sha, sampleRateHz: 100, sampleCount: 4 },
    }] });
    expect(result.acceptedIds).toEqual([]); expect(result.rejected[0]?.code).toBe("record_conflict");
    expect(h.tx.healthRecord.create).not.toHaveBeenCalled();
  });
  it("does not require device binding but persists and compares the scoped device fingerprint", async () => {
    const h = harness(), record = inputRecord();
    const first = { ...record, source: { ...record.source, deviceId: "SYSTEM-QA-DEVICE-A" } };
    expect((await h.service.ingestBatch(userId, "first-device-key", { records: [first] })).acceptedIds).toEqual([record.id]);
    expect(h.rows()[0].sourceDeviceKey).toMatch(/^[a-f0-9]{64}$/);
    const different = { ...record, source: { ...record.source, deviceId: "SYSTEM-QA-DEVICE-B" } };
    expect((await h.service.ingestBatch(userId, "other-device-key", { records: [different] })).rejected[0]?.code).toBe("record_conflict");
    h.tx.deviceBinding.findUnique.mockResolvedValue({ id: "33333333-3333-4333-a333-333333333333" });
    expect((await h.service.ingestBatch(userId, "retry-device-key", { records: [first] })).acceptedIds).toEqual([record.id]);
  });
  it("does not invent a source identity for a historical record with an unknown device", async () => {
    const h = harness(), record = inputRecord();
    await h.service.ingestBatch(userId, "first-device-key", { records: [record] });
    const claimed = { ...record, source: { ...record.source, deviceId: "SYSTEM-QA-DEVICE-A" } };
    const result = await h.service.ingestBatch(userId, "claim-device-key", { records: [claimed] });
    expect(result.acceptedIds).toEqual([]); expect(result.rejected[0]?.code).toBe("record_conflict");
    expect(h.rows()[0].sourceDeviceKey).toBeNull();
  });
  it("does not classify an unrelated SQL unique error as accepted", async () => {
    const h = harness();
    h.tx.healthRecord.create.mockRejectedValue({ code: "P2002" });
    await expect(h.service.ingestBatch(userId, "first-request-key", { records: [inputRecord()] })).rejects.toEqual({ code: "P2002" });
    expect(h.idem()).toHaveLength(0);
  });

  it("persists and returns capture metadata and rejects changing it for an existing record", async () => {
    const h = harness(), record = inputRecord();
    const source = { ...record.source, origin: "unknown", measurementSource: "imported", rawVersion: 2 };
    const original = { ...record, source };
    expect((await h.service.ingestBatch(userId, "metadata-first-key", { records: [original] })).acceptedIds).toEqual([record.id]);
    expect(h.rows()[0]).toMatchObject({ sourceOrigin: "unknown", sourceMeasurementSource: "imported", sourceRawVersion: 2 });
    expect((await h.service.list(userId)).items[0]?.source).toMatchObject(source);
    const changed = { ...record, source: { ...source, origin: "watch_history" } };
    expect((await h.service.ingestBatch(userId, "metadata-changed-key", { records: [changed] })).rejected[0]?.code).toBe("record_conflict");
    expect((await h.service.ingestBatch(userId, "metadata-retry-key", { records: [original] })).acceptedIds).toEqual([record.id]);
    expect(h.rows()[0].values).toEqual(record.values);
  });

  it("does not invent capture metadata on older records", async () => {
    const h = harness();
    await h.service.ingestBatch(userId, "metadata-legacy-key", { records: [inputRecord()] });
    const source = (await h.service.list(userId)).items[0]?.source;
    expect(source).not.toHaveProperty("origin");
    expect(source).not.toHaveProperty("measurementSource");
    expect(source).not.toHaveProperty("rawVersion");
  });

  it("retains daily summary versions but exposes only the newest fold", async () => {
    const h = harness();
    const daily = (id: string, value: number, observedAt: string) => ({
      ...inputRecord(id),
      metric: "steps",
      observedAt,
      values: { value },
      unit: "步",
      aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
      source: {
        platform: "android",
        deviceId: "urion:U19-EB1",
        origin: "watch_history",
        measurementSource: "wearable",
        rawVersion: 1,
      },
    });
    expect((await h.service.ingestBatch(userId, "daily-first-key", {
      records: [daily("summary-v1", 1_000, "2026-09-28T01:00:00.000Z")],
    })).acceptedIds).toEqual(["summary-v1"]);
    expect((await h.service.ingestBatch(userId, "daily-second-key", {
      records: [daily("summary-v2", 1_200, "2026-09-28T02:00:00.000Z")],
    })).acceptedIds).toEqual(["summary-v2"]);

    expect(h.rows()).toHaveLength(2);
    expect(h.rows().filter((row) => row.aggregationActive)).toHaveLength(1);
    expect(h.rows().find((row) => row.aggregationActive)?.clientRecordId).toBe("summary-v2");
    expect(h.tx.healthWarningRule.findUnique).not.toHaveBeenCalled();
    expect((await h.service.list(userId)).items).toEqual([
      expect.objectContaining({
        id: "summary-v2",
        values: { value: 1_200 },
        unit: "步",
        aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
      }),
    ]);
    expect(await h.service.legacyRecords(userId, ["steps"])).toEqual([]);

    await h.service.ingestBatch(userId, "daily-stale-key", {
      records: [daily("summary-stale", 900, "2026-09-28T00:30:00.000Z")],
    });
    expect(h.rows()).toHaveLength(3);
    expect(h.rows().find((row) => row.aggregationActive)?.clientRecordId).toBe("summary-v2");
  });

  it("keeps daily summary folds separate by source device", async () => {
    const h = harness();
    const record = (id: string, deviceId: string) => ({
      ...inputRecord(id),
      metric: "sleep",
      values: { hours: 7.5 },
      unit: "h",
      aggregation: { kind: "daily_summary", localDate: "2026-09-28" },
      source: { platform: "android", deviceId },
    });
    await h.service.ingestBatch(userId, "device-summary-a", { records: [record("summary-a", "urion:A")] });
    await h.service.ingestBatch(userId, "device-summary-b", { records: [record("summary-b", "urion:B")] });
    expect(h.rows().filter((row) => row.aggregationActive)).toHaveLength(2);
  });
});
describe("health stable timestamp/id pagination", () => {
  const observedAt = new Date("2026-01-01T00:00:00.000Z");
  it("encodes both sort keys", () => {
    const cursor = healthPageCursor({ id: rowId, observedAt });
    expect(healthPageFilter(cursor)).toEqual({ OR: [{ observedAt: { lt: observedAt } }, { observedAt, id: { lt: rowId } }] });
  });
  it("keeps the old ISO before timestamp compatible", () => {
    expect(healthPageFilter(observedAt.toISOString())).toEqual({ observedAt: { lt: observedAt } });
    expect(healthPageFilter()).toEqual({});
  });
  it("rejects invalid dates and IDs before a database query", () => {
    for (const input of ["not-a-date", "2026-99-99", Buffer.from(JSON.stringify({ v: 1, id: "bad", observedAt })).toString("base64url")]) {
      expect(() => healthPageFilter(input)).toThrow("分页游标");
    }
  });
  it("rejects fractional and infinite page sizes", async () => {
    const h = harness();
    await expect(h.service.list(userId, undefined, 1.5)).rejects.toThrow("正整数");
    await expect(h.service.list(userId, undefined, Infinity)).rejects.toThrow("正整数");
    expect(h.tx.healthRecord.findMany).not.toHaveBeenCalled();
  });
});
