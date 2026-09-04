import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LegacyMemberController } from "./legacy-member.controller";
import { legacyCareMetrics, legacyCareNames } from "./legacy-care-mapper";
import {
  legacyDailyToCanonical,
  canonicalToLegacyDaily,
  numericOrNull,
} from "./legacy-health-mapper";
import { healthWarningValue } from "../health/health.service";

function fixture() {
  const health = {
    ingestBatch: vi.fn(async (_user, _key, body) => ({
      acceptedIds: body.records.map((row: { id: string }) => row.id),
      rejected: [],
      nextCursor: null,
    })),
    legacyRecords: vi.fn(async () => []),
    legacyDetail: vi.fn(async () => ({ id: "record-a" })),
  };
  const care = {
    savePermissions: vi.fn(async () => ({})),
    preview: vi.fn(async () => []),
  };
  const notifications = { markRead: vi.fn(async () => ({ read: true })) };
  const legacy = {
    relationshipForSettings: vi.fn(async () => ({
      id: "relation",
      permissions: [{ enabled: true, metric: "BLOOD_PRESSURE" }],
    })),
    viewerRelationship: vi.fn(async () => ({
      relationship: { id: "relation" },
    })),
    notificationId: vi.fn(async () => "notice-db"),
    notification: vi.fn(async () => ({ is_read: 1 })),
    notificationStatistics: vi.fn(async () => ({
      announce_count: 1,
      remind_count: 2,
      unread_count: 3,
    })),
  };
  const controller = new LegacyMemberController(
    {} as never,
    {} as never,
    health as never,
    care as never,
    notifications as never,
    {} as never,
    legacy as never,
  );
  const user = { id: "owner", sessionId: "session" } as never;
  return { controller, user, health, care, notifications, legacy };
}

describe("legacy client contracts", () => {
  it("round-trips mini-program permission names without granting unknown metrics", () => {
    const old = [
      "steps",
      "reliang",
      "juli",
      "bloodPressure",
      "heartReat",
      "HRV",
      "bodycomposition",
      "bloodcomposition",
    ];
    expect(legacyCareNames(legacyCareMetrics(old))).toEqual(old);
    expect(legacyCareMetrics('["blood_pressure","pulseReat"]')).toEqual([
      "blood_pressure",
      "heart_rate",
    ]);
    expect(() => legacyCareMetrics(["unknown"])).toThrow(
      "共享的健康项目不正确",
    );
    expect(() => legacyCareMetrics({})).toThrow();
  });

  it("saves and reads permissions in each client's naming convention", async () => {
    const { controller, user, care } = fixture();
    await controller.saveCareSettings(user, {
      to_member_id: 2,
      setting: ["bloodPressure", "heartReat"],
    });
    expect(care.savePermissions).toHaveBeenCalledWith("owner", "relation", {
      metrics: ["blood_pressure", "heart_rate"],
    });
    expect((await controller.careSettings(user, "2")).data).toEqual({
      setting: '["bloodPressure"]',
    });
  });

  it("marks a legacy detail read only after resolving its ownership", async () => {
    const { controller, user, notifications, legacy } = fixture();
    expect((await controller.notification(user, "3")).data).toEqual({
      is_read: 1,
    });
    expect(notifications.markRead).toHaveBeenCalledWith("owner", "notice-db");
    legacy.notificationId.mockRejectedValueOnce(new ForbiddenException());
    await expect(controller.notification(user, "foreign")).rejects.toThrow();
    expect(notifications.markRead).toHaveBeenCalledTimes(1);
  });

  it("provides the original statistics response", async () => {
    const { controller, user } = fixture();
    expect((await controller.notificationStatistics(user)).data).toEqual({
      announce_count: 1,
      remind_count: 2,
      unread_count: 3,
    });
  });

  it("makes legacy daily retries deterministic and splits expanded batches", async () => {
    const { controller, user, health } = fixture();
    const body = {
      dailyDate: Array.from({ length: 201 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 8, 3, 0, i)).toISOString(),
        heartReat: 70,
      })),
    };
    await controller.saveDaily(user, body);
    await controller.saveDaily(user, body);
    expect(health.ingestBatch).toHaveBeenCalledTimes(4);
    expect(health.ingestBatch.mock.calls[0]).toEqual(
      health.ingestBatch.mock.calls[2],
    );
    expect(health.ingestBatch.mock.calls[1]).toEqual(
      health.ingestBatch.mock.calls[3],
    );
    expect(health.ingestBatch.mock.calls[0]?.[2].records).toHaveLength(200);
  });

  it("does not report partial legacy uploads as complete success", async () => {
    const { controller, user, health } = fixture();
    health.ingestBatch.mockResolvedValueOnce({
      acceptedIds: [],
      rejected: [{ id: "bad", code: "invalid", message: "invalid" }] as never,
      nextCursor: null,
    });
    await expect(
      controller.saveDaily(user, {
        dailyDate: [{ date: "2026-09-03 08:00:00", heartReat: 70 }],
      }),
    ).rejects.toThrow("部分健康记录未保存");
  });

  it("never masks a database failure as an empty care day", async () => {
    const { controller, user, care } = fixture();
    care.preview.mockRejectedValueOnce(new Error("database down"));
    await expect(
      controller.dailyPreview(user, { selectmember: "2" }, {
        requestId: "test",
      } as never),
    ).rejects.toThrow("database down");
  });

  it("keeps separate no-timestamp composition measurements separate", async () => {
    const { controller, user, health } = fixture();
    const body = { data: { BMI: 22 } };
    await controller.saveBodyComposition(user, body);
    await controller.saveBodyComposition(user, body);
    expect(health.ingestBatch.mock.calls[0]?.[1]).not.toEqual(
      health.ingestBatch.mock.calls[1]?.[1],
    );
  });

  it("interprets unzoned legacy dates in China time, not host time", () => {
    const [record] = legacyDailyToCanonical(
      [{ date: "2026-09-03 08:31:22", heartReat: 70 }],
      "legacy",
    );
    expect(record?.observedAt).toBe("2026-09-03T00:31:22.000Z");
    expect(record?.timezoneOffsetMinutes).toBe(480);
    expect(canonicalToLegacyDaily([record as never])[0]?.date).toBe(
      "2026-09-03 08:31:22",
    );
  });

  it("retains multiple measurements within the same hour and timestamp", () => {
    const rows = ["00:10:00", "00:20:00", "00:20:00"].map((time, i) => ({
      id: `record-${i}`,
      metric: "heart_rate",
      observedAt: `2026-09-03T${time}.000Z`,
      values: { value: 70 + i },
    }));
    const mapped = canonicalToLegacyDaily(rows);
    expect(mapped).toHaveLength(3);
    expect(mapped.map((row) => row.heartReat).sort()).toEqual([70, 71, 72]);
  });

  it("does not turn missing health values into zero or a low warning", () => {
    for (const value of [null, undefined, "", " ", false])
      expect(numericOrNull(value)).toBeNull();
    expect(
      healthWarningValue("heart_rate", { bpm: null, value: null }),
    ).toBeNull();
    expect(healthWarningValue("heart_rate", { bpm: null, value: 72 })).toBe(72);
    expect(
      legacyDailyToCanonical(
        [
          {
            date: "2026-09-03 08:00:00",
            heartReat: "",
            bloodPressure: { bloodPressureHigh: null, bloodPressureLow: null },
          },
        ],
        "legacy",
      ),
    ).toEqual([]);
  });
});
