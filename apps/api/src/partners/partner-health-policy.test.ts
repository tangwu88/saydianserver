import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PartnerMembersService } from "./partner-members.service";
import { canReadPartnerHealth } from "./partner-health-policy";
import { PartnerCommerceService } from "./partner-commerce.service";
describe("cooperation health access and ERP log boundaries", () => {
  it("uses the reserved strategic tier, never an editable name", () => {
    expect(
      canReadPartnerHealth({
        active: true,
        level: { code: "distribution-1", active: true },
      }),
    ).toBe(true);
    for (const partner of [
      null,
      { active: false, level: { code: "distribution-1", active: true } },
      { active: true, level: { code: "distribution-1", active: false } },
      ...["distribution-2", "distribution-3", "战略合作"].map((code) => ({
        active: true,
        level: { code, active: true },
      })),
    ])
      expect(canReadPartnerHealth(partner)).toBe(false);
  });
  it.each(["distribution-2", "distribution-3"])(
    "denies every health surface before data reads for %s",
    async (code) => {
      const tx: any = {
        brandPartner: {
          findUnique: vi.fn(async () => ({
            active: true,
            level: { code, active: true },
          })),
        },
        healthRecord: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
          groupBy: vi.fn(),
        },
        healthReport: { findMany: vi.fn(), findFirst: vi.fn() },
        deviceBinding: { findFirst: vi.fn() },
        auditLog: { create: vi.fn() },
      };
      const service = new PartnerMembersService(
          { $transaction: (fn: any) => fn(tx) } as any,
          { privateEcgArtifact: vi.fn() } as any,
        ),
        partnerId = randomUUID(),
        id = randomUUID();
      const calls = [
        () => service.healthRecords(partnerId, id, "read", 1, 30),
        () => service.healthSummary(partnerId, id, "read"),
        () => service.measurements(partnerId, id, "read", 1, 30),
        () => service.reports(partnerId, id, "read", 1),
        () => service.report(partnerId, id, "read"),
        () => service.ecg(partnerId, id, "read"),
      ];
      for (const call of calls)
        await expect(call()).rejects.toMatchObject({ status: 403 });
      expect(tx.healthRecord.findMany).not.toHaveBeenCalled();
      expect(tx.healthRecord.findFirst).not.toHaveBeenCalled();
      expect(tx.healthReport.findFirst).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );
  it("never schedules or reads logs for another partner's order", async () => {
    const prisma: any = {
      commerceOrder: { findFirst: vi.fn(async () => null) },
      commerceIntegrationJob: { upsert: vi.fn() },
    };
    await expect(
      new PartnerCommerceService(prisma).processing(randomUUID(), randomUUID()),
    ).rejects.toThrow("订单不存在");
    expect(prisma.commerceIntegrationJob.upsert).not.toHaveBeenCalled();
  });
  it("reuses a minute's idempotent read job and keeps actual cache during a sync error", async () => {
    const id = randomUUID(),
      partnerId = randomUUID(),
      items = [
        {
          id: "123",
          time: "2026-10-14 12:00:00",
          name: "审核",
          remark: "通过",
          operator: "合成操作员",
        },
      ];
    const prisma: any = {
      commerceOrder: {
        findFirst: vi.fn(async () => ({
          id,
          partnerId,
          executionOwner: "NEW_SYSTEM",
          erpOrderId: "123",
          erpProcessLogJson: { items },
          erpProcessLogSyncedAt: new Date(0),
        })),
      },
      integrationConfig: {
        findUnique: vi.fn(async () => ({ state: "CONFIGURED" })),
      },
      commerceIntegrationJob: {
        upsert: vi.fn(async () => ({ status: "DEAD_LETTER" })),
        findFirst: vi.fn(async () => ({ status: "DEAD_LETTER" })),
      },
    };
    const service = new PartnerCommerceService(prisma);
    const result = await service.processing(partnerId, id);
    await service.processing(partnerId, id);
    expect(result).toMatchObject({ items, state: "ERROR" });
    expect(prisma.commerceIntegrationJob.upsert.mock.calls[0][0].where).toEqual(
      prisma.commerceIntegrationJob.upsert.mock.calls[1][0].where,
    );
  });
});
