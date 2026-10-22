import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { DevicesService } from "./devices.service";

const binding = {
  id: "00000000-0000-4000-8000-000000000001",
  hardwareKey: "scoped-hash",
  vendor: "Veepoo",
  model: "W9S",
  displayName: "SD-Watch-W9S",
  macAddress: "AA:BB:CC:DD:EE:FF",
  firmware: "1.2.3",
  capabilities: ["metric:heart_rate"],
  syncCursor: null,
  lastSeenAt: new Date("2026-10-01T03:00:00.000Z"),
};

describe("DevicesService.bind", () => {
  it("normalizes a real MAC and records every successful ready connection", async () => {
    const upsert = vi.fn(async () => binding);
    const create = vi.fn(async (_input: any) => ({ id: "event-1" }));
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: vi.fn(async () => []), deviceBinding: { upsert }, deviceConnectionEvent: { create } }),
    );
    const service = new DevicesService({ $transaction: transaction } as any);

    await expect(
      service.bind("00000000-0000-4000-8000-000000000002", {
        deviceId: "veepoo:watch-1",
        vendor: "Veepoo",
        model: "W9S",
        displayName: "SD-Watch-W9S",
        macAddress: "aa-bb-cc-dd-ee-ff",
        firmware: "1.2.3",
        capabilities: ["metric:heart_rate", "metric:heart_rate"],
        sdkData: "native|id\\value\nnext",
      }),
    ).resolves.toMatchObject({
      id: binding.id,
      macAddress: "AA:BB:CC:DD:EE:FF",
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ macAddress: "AA:BB:CC:DD:EE:FF" }),
        update: expect.objectContaining({ macAddress: "AA:BB:CC:DD:EE:FF" }),
      }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceBindingId: binding.id,
        macAddress: "AA:BB:CC:DD:EE:FF",
        connectedAt: expect.any(Date),
        rawPayload: expect.stringContaining("sdkData=native\\|id\\\\value\\nnext"),
      }),
    });
    const rawPayload = create.mock.calls[0]?.[0]?.data.rawPayload as string;
    expect(rawPayload).toContain("deviceId=veepoo:watch-1");
    expect(rawPayload).toContain("macAddress=aa-bb-cc-dd-ee-ff");
    expect(rawPayload).toContain('capabilities=["metric:heart_rate","metric:heart_rate"]');
  });

  it("rejects a non-MAC value instead of storing an iOS connection UUID", async () => {
    const service = new DevicesService({} as any);
    await expect(
      service.bind("00000000-0000-4000-8000-000000000002", {
        deviceId: "veepoo:watch-1",
        vendor: "Veepoo",
        model: "W9S",
        displayName: "SD-Watch-W9S",
        macAddress: "12345678-1234-1234-1234-1234567890AB",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps the stored MAC when a later connection cannot report one", async () => {
    const upsert = vi.fn(async (_input: any) => binding);
    const create = vi.fn(async () => ({ id: "event-2" }));
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: vi.fn(async () => []), deviceBinding: { upsert }, deviceConnectionEvent: { create } }),
    );
    const service = new DevicesService({ $transaction: transaction } as any);

    await service.bind("00000000-0000-4000-8000-000000000002", {
      deviceId: "veepoo:watch-1",
      vendor: "Veepoo",
      model: "W9S",
      displayName: "SD-Watch-W9S",
    });

    const update = upsert.mock.calls[0]?.[0]?.update;
    expect(update).not.toHaveProperty("macAddress");
    expect(update).not.toHaveProperty("firmware");
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ macAddress: null, firmware: null }),
    });
  });

  it("rejects an oversized raw payload instead of truncating connection evidence", async () => {
    const service = new DevicesService({} as any);
    await expect(
      service.bind("00000000-0000-4000-8000-000000000002", {
        deviceId: "veepoo:watch-1",
        vendor: "Veepoo",
        model: "W9S",
        displayName: "SD-Watch-W9S",
        sdkData: "x".repeat(65_536),
      }),
    ).rejects.toThrow("设备上报原始数据过大");
  });
});


describe("Say Ring first-binding initialization", () => {
  const input = { deviceId: "coolwear:test-ring", vendor: "CoolWear",
    model: "R7Pro", displayName: "R7Pro", product: "say-ring", initializeFirstBinding: true };
  function fixture(prior: number) {
    const count = vi.fn(async (_input: unknown) => prior);
    const lock = vi.fn(async () => []);
    const upsert = vi.fn(async () => { prior++; return binding; });
    const tx = { $queryRaw: lock, deviceBinding: { count, upsert },
      deviceConnectionEvent: { create: vi.fn(async () => ({})) } };
    return { service: new DevicesService({ $transaction: async (fn: any) => fn(tx) } as any), count, lock, upsert };
  }
  it("grants only the first successful member binding; repeats cannot clear again", async () => {
    const f = fixture(0);
    expect((await f.service.bind("member", input)).firstBindingInitialization)
      .toEqual({ product: "say-ring", deviceId: input.deviceId, shouldClear: true });
    expect((await f.service.bind("member", input)).firstBindingInitialization?.shouldClear).toBe(false);
    expect(f.count).toHaveBeenCalledWith({ where: { userId: "member" } });
    expect(f.lock.mock.invocationCallOrder[0]!).toBeLessThan(f.count.mock.invocationCallOrder[0]!);
  });
  it("retains any lifetime binding, including an unbound or other-model ring", async () => {
    const f = fixture(1);
    expect((await f.service.bind("member", input)).firstBindingInitialization?.shouldClear).toBe(false);
    expect(f.count.mock.calls[0]![0]).toEqual({ where: { userId: "member" } });
  });
  it.each([{}, { product: "saydian-global", initializeFirstBinding: true },
    { product: "say-ring", initializeFirstBinding: "true" }])("does not grant old or other-product clients: %j", async options => {
    const f = fixture(0);
    const { product: _p, initializeFirstBinding: _i, ...legacy } = input;
    expect(await f.service.bind("member", { ...legacy, ...options })).not.toHaveProperty("firstBindingInitialization");
    expect(f.count).not.toHaveBeenCalled();
    expect(f.lock).toHaveBeenCalledTimes(1);
  });
  it("does not issue a grant if the connection transaction fails", async () => {
    const f = fixture(0); f.upsert.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.service.bind("member", input)).rejects.toThrow("database unavailable");
  });
});
