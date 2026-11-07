import { describe, it, expect, vi } from "vitest";
import type { HealthScreenUpdates } from "@saydian/app-contracts";
import {
  changedHealthGroups,
  MeasurementObserver,
} from "../../../packages/health-screen-ui/src/updates";
const original = {
  groups: [
    {
      group: "cardiovascular" as const,
      count: 2,
      updatedAt: "2026-11-06T00:00:00Z",
    },
  ],
};
describe("measurement arrival revisions", () => {
  it("does not announce initial load or unchanged polling", () => {
    expect(changedHealthGroups(null, original)).toEqual([]);
    expect(changedHealthGroups(original, original)).toEqual([]);
  });
  it("announces new uploads even when their observed timestamp is historical", () => {
    expect(
      changedHealthGroups(original, {
        groups: [
          {
            ...original.groups[0]!,
            count: 3,
            updatedAt: "2026-11-07T00:00:00Z",
          },
        ],
      })[0]?.message,
    ).toBe("收到 1 条新记录");
  });
  it("distinguishes revised daily data from additional records", () => {
    expect(
      changedHealthGroups(original, {
        groups: [{ ...original.groups[0]!, updatedAt: "2026-11-07T00:00:00Z" }],
      })[0]?.message,
    ).toBe("数据已更新");
  });
  it("does not report date-window expiry as a new upload", () => {
    expect(
      changedHealthGroups(original, {
        groups: [{ ...original.groups[0]!, count: 1 }],
      }),
    ).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const uploaded: HealthScreenUpdates = {
  groups: [
    { ...original.groups[0]!, count: 3, updatedAt: "2026-11-07T01:00:00Z" },
  ],
};
describe("measurement notifications independent of chart refresh", () => {
  it("captures uploads during the first chart read, including an already-visible measurement", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValue(uploaded);
    const observer = new MeasurementObserver(read);
    await observer.initialize(new AbortController().signal);
    // The chart may already have loaded the uploaded measurement in the meantime.
    expect(await observer.check()).toMatchObject([
      { group: "cardiovascular", message: "收到 1 条新记录" },
    ]);
    expect(await observer.check()).toEqual([]);
    expect(await observer.initialize(new AbortController().signal)).toBe(false);
  });
  it("coalesces simultaneous checks and retries after a failed revision read", async () => {
    const waiting = deferred<HealthScreenUpdates>();
    const read = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockReturnValueOnce(waiting.promise)
      .mockRejectedValueOnce(new Error("temporary network failure"))
      .mockResolvedValue(uploaded);
    const observer = new MeasurementObserver(read);
    await observer.initialize(new AbortController().signal);
    const check = observer.check();
    expect(await observer.check()).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
    waiting.resolve(original);
    expect(await check).toEqual([]);
    await expect(observer.check()).rejects.toThrow("temporary network failure");
    expect(await observer.check()).toHaveLength(1);
    expect(await observer.check()).toEqual([]);
  });
  it("aborts and discards late responses after a member, period or session change", async () => {
    const stale = deferred<HealthScreenUpdates>();
    let staleSignal: AbortSignal | undefined;
    const read = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockImplementationOnce((signal: AbortSignal) => {
        staleSignal = signal;
        return stale.promise;
      })
      .mockResolvedValueOnce({ groups: [] })
      .mockResolvedValue({ groups: [] });
    const observer = new MeasurementObserver(read);
    await observer.initialize(new AbortController().signal);
    const check = observer.check();
    observer.reset();
    expect(staleSignal?.aborted).toBe(true);
    await observer.initialize(new AbortController().signal);
    stale.resolve(uploaded);
    expect(await check).toEqual([]);
    expect(await observer.check()).toEqual([]);
  });
  it("does not accept an initial read cancelled by a newer chart request", async () => {
    const first = deferred<HealthScreenUpdates>();
    const read = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(uploaded);
    const observer = new MeasurementObserver(read);
    const request = new AbortController();
    const initializing = observer.initialize(request.signal);
    request.abort();
    first.resolve(original);
    expect(await initializing).toBe(false);
    await observer.initialize(new AbortController().signal);
    expect(await observer.check()).toEqual([]);
  });
  it("reports simultaneous uploads to different body regions", () => {
    expect(
      changedHealthGroups(original, {
        groups: [
          ...uploaded.groups,
          { group: "oxygen", count: 1, updatedAt: "2026-11-07T01:00:00Z" },
          { group: "activity", count: 2, updatedAt: "2026-11-07T01:00:00Z" },
        ],
      }).map((item) => item.group),
    ).toEqual(["cardiovascular", "oxygen", "activity"]);
  });
});
