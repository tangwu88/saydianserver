import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const h = vi.hoisted(() => ({ token: "owner", post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock("./api", () => ({ api: h, responseData: (r: any) => r.data.data, adminSessionKey: () => h.token }));
import { PackageUploadError, uploadAppPackageChunks } from "./app-package-upload";
const network = () => Object.assign(new Error("synthetic network reset"), { isAxiosError: true, code: "ERR_NETWORK" });
const envelope = (data: unknown) => ({ data: { data } });
beforeEach(() => { vi.clearAllMocks(); h.token = "owner"; h.delete.mockResolvedValue({}); });
afterEach(() => vi.restoreAllMocks());
function fixture(size = 1024 * 1024 * 2 + 17) {
  const bytes = new Uint8Array(size); bytes.set([80, 75, 3, 4]);
  const file = new File([bytes], "SayRing.hap", { type: "application/octet-stream" });
  const hash = createHash("sha256").update(bytes).digest("hex"), parts = new Map<number, Uint8Array>();
  const progress = vi.fn(), controller = new AbortController();
  let id = "", starts = 0, finishes = 0;
  const result = { fileName: "say-ring-harmonyos-123-abcd1234.hap", url: "/global/api/saydian-app/v2/support/app-package/say-ring-harmonyos-123-abcd1234.hap", sizeBytes: size, sha256: hash };
  h.post.mockImplementation(async (url, body) => {
    if (url.endsWith("/complete")) { finishes++; return envelope(result); }
    starts++; id = body.requestId;
    return envelope({ uploadId: id, chunkBytes: 1024 * 1024, receivedBytes: 0 });
  });
  h.put.mockImplementation(async (url, body) => {
    const offset = Number(url.split("/").at(-1)), data = new Uint8Array(await (body.get("file") as Blob).arrayBuffer()); parts.set(offset, data);
    return envelope({ receivedBytes: offset + data.length });
  });
  const run = () => uploadAppPackageChunks(file, "harmonyos", "say-ring", progress, controller.signal);
  return { file, bytes, hash, progress, controller, run, parts, result, id: () => id, starts: () => starts, finishes: () => finishes };
}
it("sends at most 1MiB per request and applies metadata only after complete SHA verification", async () => {
  const f = fixture(); expect(await f.run()).toEqual(f.result);
  expect(h.put).toHaveBeenCalledTimes(3); expect([...f.parts.values()].every(v => v.length <= 1024 * 1024)).toBe(true);
  expect(Buffer.compare(Buffer.concat([...f.parts.values()]), Buffer.from(f.bytes))).toBe(0);
  expect(f.progress.mock.calls.some(([p]) => p.stage === "verifying")).toBe(true); expect(h.delete).not.toHaveBeenCalled();
});
it("retries a fragment whose response was lost using the same session and offset", async () => {
  const f = fixture(); const original = h.put.getMockImplementation()!; let failed = false;
  h.put.mockImplementation(async (...args) => { const r = await original(...args); if (!failed) { failed = true; throw network(); } return r; });
  await f.run(); expect(h.put.mock.calls[0]![0]).toBe(h.put.mock.calls[1]![0]); expect(f.starts()).toBe(1);
  expect(f.parts.size).toBe(3); expect(f.progress.mock.calls.some(([p]) => p.stage === "retrying")).toBe(true);
});
it("reports progress within a fragment, effective speed and remaining time without counting multipart overhead", async () => {
  const f = fixture(1024 * 1024 * 2), original = h.put.getMockImplementation()!;
  let now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
  const callbacks: Array<(event: { loaded: number }) => void> = [];
  h.put.mockImplementation(async (...args) => {
    const callback = args[2].onUploadProgress; callbacks.push(callback);
    now += 2000; callback({ loaded: 512 * 1024 });
    if (callbacks.length === 1) expect(f.progress).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: "uploading", percent: 25, uploadedBytes: 512 * 1024, totalBytes: f.file.size,
      bytesPerSecond: 256 * 1024, remainingSeconds: 6,
    }));
    callback({ loaded: 1024 * 1024 + 500 });
    if (callbacks.length === 1) expect(f.progress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 50, uploadedBytes: 1024 * 1024 }));
    return original(...args);
  });
  await f.run();
  expect(f.progress.mock.calls.filter(([p]) => p.stage === "uploading").every(([p]) => p.percent < 100 && p.uploadedBytes <= f.file.size)).toBe(true);
  const count = f.progress.mock.calls.length; callbacks[0]!({ loaded: 1024 });
  expect(f.progress).toHaveBeenCalledTimes(count); // Delayed events must not regress the completed state.
});
it.each(["cancel", "account"])("ignores late progress after %s without throwing from the event callback", async (kind) => {
  const f = fixture(20), original = h.put.getMockImplementation()!;
  h.put.mockImplementation(async (...args) => {
    const result = await original(...args);
    if (kind === "cancel") f.controller.abort(); else h.token = "another-account";
    const count = f.progress.mock.calls.length;
    expect(() => args[2].onUploadProgress({ loaded: 10 })).not.toThrow();
    expect(f.progress).toHaveBeenCalledTimes(count);
    return result;
  });
  await expect(f.run()).rejects.toBeInstanceOf(PackageUploadError);
});
it("retries a lost completion response without starting another upload", async () => {
  const f = fixture(20), original = h.post.getMockImplementation()!; let failed = false;
  h.post.mockImplementation(async (...args) => { const r = await original(...args); if (String(args[0]).endsWith('/complete') && !failed) { failed = true; throw network(); } return r; });
  await f.run(); expect(f.starts()).toBe(1); expect(f.finishes()).toBe(2);
  expect(h.post.mock.calls.filter(([url]) => String(url).endsWith('/complete')).map(([url]) => url)).toEqual([`/app-packages/uploads/${f.id()}/complete`, `/app-packages/uploads/${f.id()}/complete`]);
});
it("rejects mismatched final metadata and cancels staging", async () => {
  const f = fixture(20); f.result.sha256 = "f".repeat(64);
  await expect(f.run()).rejects.toThrow(/结果校验/); expect(h.delete).toHaveBeenCalledOnce();
});
it("stops on account changes without sending cleanup with another user's credentials", async () => {
  const f = fixture(20); const original = h.put.getMockImplementation()!;
  h.put.mockImplementation(async (...args) => { const r = await original(...args); h.token = "another-account"; return r; });
  await expect(f.run()).rejects.toThrow(/登录已变化/); expect(f.finishes()).toBe(0); expect(h.delete).not.toHaveBeenCalled();
});
it("cancels without completing or applying partial metadata", async () => {
  const f = fixture(20), original = h.put.getMockImplementation()!;
  h.put.mockImplementation(async (...args) => { const r = await original(...args); f.controller.abort(); return r; });
  await expect(f.run()).rejects.toThrow(/取消/); expect(f.finishes()).toBe(0); expect(h.delete).toHaveBeenCalledOnce();
});
it("does not retry permission failures", async () => {
  const f = fixture(20); h.post.mockRejectedValueOnce(Object.assign(new Error("denied"), { isAxiosError: true, response: { status: 403 } }));
  await expect(f.run()).rejects.toThrow(/权限/); expect(h.post).toHaveBeenCalledOnce(); expect(h.put).not.toHaveBeenCalled();
});
it("bounds network retries and leaves a readable error", async () => {
  const f = fixture(20); h.put.mockRejectedValue(network());
  await expect(f.run()).rejects.toBeInstanceOf(PackageUploadError); expect(h.put).toHaveBeenCalledTimes(4); expect(h.delete).toHaveBeenCalledOnce();
}, 10000);
