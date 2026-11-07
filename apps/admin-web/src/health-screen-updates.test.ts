import { describe, it, expect, vi } from "vitest";
import type {
  HealthScreenUpdates,
  HealthScreenMeasurementUpdate,
} from "@saydian/app-contracts";
import {
  changedHealthGroups,
  MeasurementObserver,
  measurementReadings,
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

function reading(
  patch: Partial<HealthScreenMeasurementUpdate> = {},
): HealthScreenMeasurementUpdate {
  return {
    key: "device:HEART_RATE",
    revision: "initial",
    metric: "HEART_RATE",
    kind: "device",
    label: "心率",
    measuredAt: "2026-11-06T00:00:00Z",
    updatedAt: "2026-11-07T01:00:00Z",
    withdrawn: false,
    values: [{ key: "heart_rate", label: "心率", value: 74, unit: "次/分" }],
    ...patch,
  };
}
describe("specific measurement values in arrival notifications", () => {
  it("shows the uploaded reading, not its daily average, and does not repeat unchanged metrics", () => {
    const pulse = reading(),
      pressure = reading({
        key: "device:BLOOD_PRESSURE",
        metric: "BLOOD_PRESSURE",
        label: "血压",
        values: [
          { key: "systolic", label: "收缩压", value: 120, unit: "mmHg" },
          { key: "diastolic", label: "舒张压", value: 80, unit: "mmHg" },
        ],
      });
    const old: HealthScreenUpdates = {
      groups: [{ ...original.groups[0]!, measurements: [pulse, pressure] }],
    };
    const next: HealthScreenUpdates = {
      groups: [
        {
          ...old.groups[0]!,
          count: 3,
          updatedAt: "2026-11-07T02:00:00Z",
          measurements: [
            {
              ...pulse,
              revision: "new",
              values: [{ ...pulse.values[0]!, value: 83 }],
            },
            pressure,
          ],
        },
      ],
    };
    expect(changedHealthGroups(old, next)[0]?.readings).toEqual([
      "心率 83 次/分",
    ]);
    expect(changedHealthGroups(next, next)).toEqual([]);
    next.groups[0]!.measurements![0]!.revision = "same-value-new-upload";
    next.groups[0]!.updatedAt = "2026-11-07T03:00:00Z";
    expect(changedHealthGroups(old, next)[0]?.message).toBe("心率 83 次/分");
  });
  it("combines high and low blood pressure and preserves units", () => {
    expect(
      measurementReadings(
        reading({
          metric: "BLOOD_PRESSURE",
          label: "血压",
          values: [
            { key: "systolic", label: "收缩压", value: 120, unit: "mmHg" },
            { key: "diastolic", label: "舒张压", value: 80, unit: "mmHg" },
          ],
        }),
      ),
    ).toEqual(["血压 120/80 mmHg"]);
  });
  it("shows blood oxygen and sleep durations in hours", () => {
    expect(
      measurementReadings(
        reading({
          metric: "BLOOD_OXYGEN",
          values: [
            { key: "blood_oxygen", label: "血氧", value: 98, unit: "%" },
          ],
        }),
      ),
    ).toEqual(["血氧 98 %"]);
    expect(
      measurementReadings(
        reading({
          metric: "SLEEP",
          values: [
            {
              key: "sleep_samples",
              label: "睡眠片段时长",
              value: 405.81,
              unit: "分钟",
            },
          ],
        }),
      ),
    ).toEqual(["睡眠片段时长 6.76 小时"]);
  });
  it("preserves reference context, lipid subitems and HRV algorithm", () => {
    expect(
      measurementReadings(
        reading({
          kind: "reference",
          metric: "BLOOD_GLUCOSE",
          label: "餐后2小时血糖参考值",
          values: [
            {
              key: "ref_glucose",
              label: "血糖 · 手动参考",
              value: 7.8,
              unit: "mmol/L",
            },
          ],
        }),
      ),
    ).toEqual(["餐后2小时血糖参考值 7.8 mmol/L"]);
    expect(
      measurementReadings(
        reading({
          kind: "reference",
          metric: "BLOOD_LIPIDS",
          values: [
            {
              key: "tc",
              label: "总胆固醇 TC · 手动参考",
              value: 4.6,
              unit: "mmol/L",
            },
            {
              key: "hdl",
              label: "高密度脂蛋白 HDL · 手动参考",
              value: 1.3,
              unit: "mmol/L",
            },
          ],
        }),
      ),
    ).toEqual([
      "总胆固醇 TC · 手动参考 4.6 mmol/L",
      "高密度脂蛋白 HDL · 手动参考 1.3 mmol/L",
    ]);
    expect(
      measurementReadings(
        reading({
          metric: "HRV",
          values: [
            { key: "hrv_rmssd", label: "HRV · RMSSD", value: 41, unit: "ms" },
          ],
        }),
      ),
    ).toEqual(["HRV · RMSSD 41 ms"]);
  });
  it("never invents a number for empty measurements or reuses a withdrawn reference", () => {
    expect(
      measurementReadings(
        reading({ metric: "ECG", label: "心电数据", values: [] }),
      ),
    ).toEqual(["心电数据已上报"]);
    expect(
      measurementReadings(
        reading({ withdrawn: true, label: "空腹血糖参考值" }),
      ),
    ).toEqual(["空腹血糖参考值已撤销"]);
    expect(
      measurementReadings(
        reading({
          metric: "STEPS",
          values: [{ key: "steps", label: "步数", value: 0, unit: "步" }],
        }),
      ),
    ).toEqual(["步数 0 步"]);
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
