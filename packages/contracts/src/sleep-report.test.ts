import { describe, expect, it } from "vitest";
import { canonicalSleepInput, normalizeSleepReportInput } from "./sleep-report";
import { createHash } from "node:crypto";

// Synthetic input only. Not actual wearable evidence or a provider response.
export const sleepFixture = () => ({ sdkDate: "2026-08-04", timezone: "+08:00", sourceKey: "a".repeat(64), totalSeconds: 25200, deepSeconds: 7200, lightSeconds: 14400, remSeconds: 3600, awakeSeconds: 1200, sessions: [{ kind: "night", startAt: "2026-08-03T16:00:00.000Z", endAt: "2026-08-04T00:00:00.000Z", asleepSeconds: 25200 }] });

describe("sleep upload aggregate contract", () => {
  it("matches Flutter's cross-language snapshot digest", () => expect(createHash("sha256").update(canonicalSleepInput(normalizeSleepReportInput(sleepFixture()))).digest("hex")).toBe("5a84ec3eff249db62cbf543968d138bbaa2f0452e03f81bbbb00847066356dce"));
  it("keeps cross-midnight absolute times and exact seconds", () => expect(normalizeSleepReportInput(sleepFixture())).toEqual(sleepFixture()));
  it("does not fill missing stages or score with zero", () => { const input = { sdkDate: "2026-08-04", timezone: "+08:00", sourceKey: "a".repeat(64), totalSeconds: 25200, sessions: [] }; expect(normalizeSleepReportInput(input)).toEqual(input); });
  it.each([
    { totalSeconds: 0 }, { totalSeconds: 1.5 }, { totalSeconds: 86401 }, { totalSeconds: "25200" }, { sdkDate: "2026-02-30" }, { timezone: "+14:20" }, { sourceKey: "actual-device-address" }, { deviceScore: 101 }, { deepSeconds: -1 }, { remSeconds: 5000 }, { email: "test@example.invalid" }, { segments: [] }, { sessions: [{ kind: "night", startAt: "2026-08-03T16:00:00", endAt: "2026-08-04T00:00:00Z", asleepSeconds: 25200 }] },
  ])("rejects malformed, inconsistent and identifying uploads: %j", patch => expect(() => normalizeSleepReportInput({ ...sleepFixture(), ...patch })).toThrow());
  it("rejects overlap and sessions whose totals do not match", () => { const input = sleepFixture(); expect(() => normalizeSleepReportInput({ ...input, sessions: [...input.sessions, ...input.sessions] })).toThrow(); expect(() => normalizeSleepReportInput({ ...input, sessions: [{ ...input.sessions[0], asleepSeconds: 25000 }] })).toThrow(); });
  it("has stable canonical hashes independent of field order", () => { const input = sleepFixture(); expect(canonicalSleepInput(input)).toBe(canonicalSleepInput(Object.fromEntries(Object.entries(input).reverse()))); });
});
