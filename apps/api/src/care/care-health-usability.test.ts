import { describe, expect, it, vi } from "vitest";
import { CareStatus, HealthMetric } from "@prisma/client";
import { Readable } from "node:stream";
import { CareService } from "./care.service";
import { SupportService } from "../support/support.service";

function careHarness() {
  const relationship = { id: "synthetic-relation", inviterId: "viewer", recipientId: "subject",
    status: CareStatus.ACTIVE as CareStatus, expiresAt: null as Date | null, permissions: [
      { metric: HealthMetric.HEART_RATE, enabled: true, expiresAt: null as Date | null },
      { metric: HealthMetric.ECG, enabled: true, expiresAt: null as Date | null },
      { metric: HealthMetric.STEPS, enabled: false, expiresAt: null as Date | null },
    ] };
  const prisma = {
    careRelationship: { findUnique: vi.fn(async () => relationship) },
    careAccessAudit: { create: vi.fn(async (_input: any) => ({})) },
    healthRecord: { findMany: vi.fn(async ({ where }: any) => [{ clientRecordId: "synthetic-record",
      metric: where.metric, observedAt: new Date("2026-10-03T00:00:00Z"),
      timezoneOffsetMinutes: 480, values: { value: 75 }, unit: "bpm", quality: "VALID",
      ecgArtifact: where.metric === HealthMetric.ECG ? { sampleRateHz: 250, sampleCount: 3000, sha256: "a".repeat(64) } : null,
    }]) },
  };
  return { relationship, prisma, service: new CareService(prisma as never) };
}

describe("care health overview and private ECG authorization", () => {
  it("returns only authorized latest metrics, with ECG metadata and bounded queries", async () => {
    const h = careHarness();
    const summary = await h.service.summary("viewer", "synthetic-relation", "qa");
    expect(summary.metrics).toEqual(["heart_rate", "ecg"]);
    expect(summary.records).toHaveLength(2);
    expect(summary.records[1]?.ecgArtifact).toMatchObject({ sampleRateHz: 250, sampleCount: 3000 });
    expect(h.prisma.healthRecord.findMany.mock.calls.every(([q]) => q.where.userId === "subject" && q.take === 30)).toBe(true);
    expect(h.prisma.careAccessAudit.create).toHaveBeenCalledTimes(2);
  });

  it.each(["viewer", "pending", "relationshipExpiry", "disabled", "permissionExpiry"])("rejects ECG access after %s changes", async reason => {
    const h = careHarness();
    if (reason === "pending") h.relationship.status = CareStatus.PENDING;
    if (reason === "relationshipExpiry") h.relationship.expiresAt = new Date(0);
    if (reason === "disabled") h.relationship.permissions[1]!.enabled = false;
    if (reason === "permissionExpiry") h.relationship.permissions[1]!.expiresAt = new Date(0);
    await expect(h.service.authorizedSubject(reason === "viewer" ? "other" : "viewer",
      "synthetic-relation", HealthMetric.ECG, "qa")).rejects.toThrow("尚未授权");
    expect(h.prisma.healthRecord.findMany).not.toHaveBeenCalled();
    expect(h.prisma.careAccessAudit.create.mock.calls[0]?.[0].data.result).toBe("DENIED");
  });

  it("keeps range and subject scope for shared ECG records", async () => {
    const h = careHarness();
    const rows = await h.service.preview("viewer", "synthetic-relation", "ecg",
      "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    expect(rows[0]?.ecgArtifact).toHaveProperty("sha256");
    expect(rows[0]?.ecgArtifact).not.toHaveProperty("objectKey");
    expect(h.prisma.healthRecord.findMany.mock.calls[0]?.[0].where.userId).toBe("subject");
  });

  it("private file reader scopes record IDs to their owner and rejects wrong file ownership", async () => {
    const artifact = { objectKey: "ecg/synthetic/file", sha256: "a".repeat(64), sampleRateHz: 250, sampleCount: 3000 };
    const file = { objectKey: artifact.objectKey, sha256: artifact.sha256, ownerUserId: "subject", status: "ACTIVE", purpose: "ecg", byteSize: 3 };
    const prisma = { healthRecord: { findUnique: vi.fn(async () => ({ metric: "ECG", ecgArtifact: artifact })) },
      fileObject: { findUnique: vi.fn(async () => file) } };
    const service = new SupportService(prisma as never, {} as never);
    const send = vi.fn(async () => ({ Body: Readable.from(Buffer.from([1, 2, 3])) }));
    vi.spyOn(service as any, "storage").mockResolvedValue({ bucket: "private", s3: { send } });
    const result = await service.privateEcgArtifact("subject", "synthetic-record");
    expect(result.sampleCount).toBe(3000);
    expect(prisma.healthRecord.findUnique).toHaveBeenCalledWith({ where: {
      userId_clientRecordId: { userId: "subject", clientRecordId: "synthetic-record" } }, include: { ecgArtifact: true } });
    file.ownerUserId = "other";
    await expect(service.privateEcgArtifact("subject", "synthetic-record")).rejects.toThrow("暂无心电波形");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
