import { describe, expect, it, vi } from "vitest";
import { AdminService } from "./admin.service";

describe("AdminService.devices", () => {
  it("returns readable member and device metadata for the authenticated admin list", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "00000000-0000-4000-8000-000000000001",
        hardwareKey:
          "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        vendor: "Veepoo",
        model: "W9S",
        displayName: "SD-Watch-W9S",
        macAddress: "AA:BB:CC:DD:EE:FF",
        firmware: "1.2.3",
        capabilities: ["metric:heart_rate", "feature:watch_faces"],
        boundAt: new Date("2026-09-28T08:00:00.000Z"),
        lastSeenAt: new Date("2026-09-28T08:30:00.000Z"),
        unboundAt: null,
        user: { compatibilityId: 13, nickname: "Saydian user" },
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        hardwareKey:
          "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        vendor: "Yucheng",
        model: "R7",
        displayName: "SD-Ring-R7",
        macAddress: null,
        firmware: null,
        capabilities: [],
        boundAt: new Date("2026-09-27T08:00:00.000Z"),
        lastSeenAt: null,
        unboundAt: new Date("2026-09-28T07:00:00.000Z"),
        user: { compatibilityId: 14, nickname: null },
      },
    ]);
    const service = new AdminService(
      { deviceBinding: { findMany } } as any,
      {} as any,
    );

    await expect(service.devices()).resolves.toEqual([
      {
        id: "00000000-0000-4000-8000-000000000001",
        deviceIdentifier: "DEV-00112233-44556677",
        memberNo: "13",
        memberNickname: "Saydian user",
        bluetoothName: "SD-Watch-W9S",
        vendor: "Veepoo",
        model: "W9S",
        macAddress: "AA:BB:CC:DD:EE:FF",
        firmware: "1.2.3",
        capabilities: ["metric:heart_rate", "feature:watch_faces"],
        boundAt: "2026-09-28T08:00:00.000Z",
        lastSeenAt: "2026-09-28T08:30:00.000Z",
        status: "BOUND",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        deviceIdentifier: "DEV-AABBCCDD-EEFF0011",
        memberNo: "14",
        memberNickname: "未填写昵称",
        bluetoothName: "SD-Ring-R7",
        vendor: "Yucheng",
        model: "R7",
        macAddress: null,
        firmware: null,
        capabilities: [],
        boundAt: "2026-09-27T08:00:00.000Z",
        lastSeenAt: null,
        status: "UNBOUND",
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        hardwareKey: true,
        vendor: true,
        model: true,
        displayName: true,
        macAddress: true,
        firmware: true,
        capabilities: true,
        boundAt: true,
        lastSeenAt: true,
        unboundAt: true,
        user: { select: { compatibilityId: true, nickname: true } },
      },
      orderBy: { lastSeenAt: "desc" },
      take: 500,
    });
  });

  it("returns up to 200 newest connection snapshots for one device", async () => {
    const findUnique = vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      hardwareKey:
        "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
      vendor: "Veepoo",
      model: "W9S",
      displayName: "SD-Watch-W9S",
      macAddress: "AA:BB:CC:DD:EE:FF",
      firmware: "1.2.3",
      boundAt: new Date("2026-10-01T02:00:00.000Z"),
      lastSeenAt: new Date("2026-10-01T03:00:00.000Z"),
      unboundAt: null,
      user: { compatibilityId: 13, nickname: "Saydian user" },
      connectionEvents: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          connectedAt: new Date("2026-10-01T03:00:00.000Z"),
          vendor: "Veepoo",
          model: "W9S",
          displayName: "SD-Watch-W9S",
          macAddress: "AA:BB:CC:DD:EE:FF",
          firmware: "1.2.3",
          rawPayload: "deviceId=veepoo:WATCH | model=W9S",
        },
      ],
    }));
    const service = new AdminService(
      { deviceBinding: { findUnique } } as any,
      {} as any,
    );

    await expect(
      service.deviceConnections("00000000-0000-4000-8000-000000000001"),
    ).resolves.toMatchObject({
      device: {
        memberNo: "13",
        memberNickname: "Saydian user",
        deviceIdentifier: "DEV-00112233-44556677",
        bluetoothName: "SD-Watch-W9S",
        macAddress: "AA:BB:CC:DD:EE:FF",
      },
      connections: [
        {
          connectedAt: "2026-10-01T03:00:00.000Z",
          deviceIdentifier: "DEV-00112233-44556677",
          bluetoothName: "SD-Watch-W9S",
          macAddress: "AA:BB:CC:DD:EE:FF",
          rawPayload: "deviceId=veepoo:WATCH | model=W9S",
        },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "00000000-0000-4000-8000-000000000001" },
        select: expect.objectContaining({
          connectionEvents: expect.objectContaining({
            select: expect.objectContaining({ rawPayload: true }),
            orderBy: { connectedAt: "desc" },
            take: 200,
          }),
        }),
      }),
    );
  });

  it("returns only the selected member's devices for the member detail action", async () => {
    const findUnique = vi.fn(async () => ({
      compatibilityId: 13,
      nickname: "Saydian user",
      devices: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          hardwareKey:
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
          vendor: "Veepoo",
          model: "W9S",
          displayName: "SD-Watch-W9S",
          macAddress: null,
          firmware: "1.2.3",
          capabilities: [],
          boundAt: new Date("2026-10-01T02:00:00.000Z"),
          lastSeenAt: new Date("2026-10-01T03:00:00.000Z"),
          unboundAt: null,
        },
      ],
    }));
    const service = new AdminService(
      { user: { findUnique } } as any,
      {} as any,
    );

    await expect(
      service.memberDevices("00000000-0000-4000-8000-000000000010"),
    ).resolves.toMatchObject({
      member: { memberNo: "13", memberNickname: "Saydian user" },
      devices: [
        {
          deviceIdentifier: "DEV-00112233-44556677",
          memberNo: "13",
          macAddress: null,
          status: "BOUND",
        },
      ],
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "00000000-0000-4000-8000-000000000010" },
      select: expect.objectContaining({
        compatibilityId: true,
        nickname: true,
        devices: expect.objectContaining({
          orderBy: { lastSeenAt: "desc" },
          take: 500,
        }),
      }),
    });
  });
});
