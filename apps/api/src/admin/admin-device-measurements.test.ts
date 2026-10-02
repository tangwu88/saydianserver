import { describe, expect, it, vi } from "vitest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

const deviceId = "00000000-0000-4000-8000-000000000001";
const hardwareKey = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const superAdmin = { id: "admin-id", role: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] };
const auditor = { id: "auditor-id", role: "HEALTH_AUDITOR", roles: ["HEALTH_AUDITOR"] };

function setup() {
  const deviceBinding = { findUnique: vi.fn().mockResolvedValue({ id: deviceId, userId: "member-id", hardwareKey, model: "W9S" }) };
  const healthRecord = { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([{
    id: "00000000-0000-4000-8000-000000000002",
    metric: "HEART_RATE",
    observedAt: new Date("2026-10-02T01:00:00.000Z"),
    timezoneOffsetMinutes: 480,
    values: { bpm: 72 },
    unit: "bpm",
    sourceDeviceKey: hardwareKey,
    sourceModel: "W9S",
    sourceFirmware: "1.2.3",
    sourcePlatform: "ios",
    sourceOrigin: "watch_history",
    sourceMeasurementSource: "wearable",
  }]) };
  const auditLog = { create: vi.fn().mockResolvedValue({}) };
  const service = new AdminService({ deviceBinding, healthRecord, auditLog } as any, {} as any);
  return { deviceBinding, healthRecord, auditLog, service };
}

describe("audited per-device measurement history", () => {
  it("returns this device's measurements with a pseudonymous identifier and audits the read", async () => {
    const h = setup();

    await expect(h.service.deviceMeasurements(auditor, deviceId, "request-1", "会员反馈核查", 1, 999)).resolves.toMatchObject({
      device: { id: deviceId, deviceIdentifier: "DEV-00112233-44556677", model: "W9S" },
      total: 1,
      page: 1,
      pageSize: 100,
      records: [{
        id: "00000000-0000-4000-8000-000000000002",
        metric: "heart_rate",
        deviceIdentifier: "DEV-00112233-44556677",
        sourceModel: "W9S",
        sourcePlatform: "ios",
        sourceOrigin: "watch_history",
        sourceMeasurementSource: "wearable",
        values: { bpm: 72 },
      }],
    });
    expect(h.healthRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "member-id", OR: [{ deviceBindingId: deviceId }, { sourceDeviceKey: hardwareKey }] }, orderBy: { observedAt: "desc" }, skip: 0, take: 100,
      select: expect.objectContaining({ sourceDeviceKey: true, sourceModel: true, sourceOrigin: true, sourceMeasurementSource: true }),
    }));
    expect(h.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "auditor-id", action: "HEALTH_RAW_READ", entityType: "DEVICE", entityId: deviceId,
      afterJson: { recordCount: 1, totalCount: 1, page: 1, pageSize: 100, reason: "会员反馈核查", reasonSource: "PROVIDED" },
    }) });
  });

  it("uses bounded pages without omitting older device measurements", async () => {
    const h = setup();
    h.healthRecord.count.mockResolvedValueOnce(123);
    h.healthRecord.findMany.mockResolvedValueOnce([]);

    await expect(h.service.deviceMeasurements(superAdmin, deviceId, "request-1", "", 3, 50)).resolves.toMatchObject({
      records: [], total: 123, page: 3, pageSize: 50,
    });
    expect(h.healthRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100, take: 50 }));
  });

  it("requires an audited business reason for health auditors before reading measurements", async () => {
    const h = setup();

    await expect(h.service.deviceMeasurements(auditor, deviceId, "request-1", "短", 100)).rejects.toThrow("5至300字");
    expect(h.deviceBinding.findUnique).not.toHaveBeenCalled();
    expect(h.healthRecord.findMany).not.toHaveBeenCalled();
    expect(h.auditLog.create).not.toHaveBeenCalled();
  });

  it("still audits a super-admin read when no manual reason is required", async () => {
    const h = setup();

    await h.service.deviceMeasurements(superAdmin, deviceId, "request-1", "");

    expect(h.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "HEALTH_RAW_READ", entityType: "DEVICE", entityId: deviceId,
      afterJson: { recordCount: 1, totalCount: 1, page: 1, pageSize: 50, reason: "超级管理员直接查看（免填原因）", reasonSource: "SUPER_ADMIN_EXEMPTION" },
    }) });
  });

  it("does not expose measurements to admins outside the raw-health roles", async () => {
    const h = setup();

    await expect(h.service.deviceMeasurements({ id: "reader", role: "READ_ONLY", roles: ["READ_ONLY"] }, deviceId, "request-1", "符合长度的查看原因", 100)).rejects.toThrow("无权查看原始健康记录");
    expect(h.deviceBinding.findUnique).not.toHaveBeenCalled();
    expect(h.healthRecord.findMany).not.toHaveBeenCalled();
  });

  it("uses only authenticated roles and forwards the reason to the audited service", () => {
    const admin = { deviceMeasurements: vi.fn() };
    const controller = new AdminController(admin as any, {} as any, {} as any);

    controller.deviceMeasurements(auditor, deviceId, { requestId: "request-1" } as any, "排查测量记录", "3", "50");

    expect(admin.deviceMeasurements).toHaveBeenCalledExactlyOnceWith(auditor, deviceId, "request-1", "排查测量记录", 3, 50);
  });
});
