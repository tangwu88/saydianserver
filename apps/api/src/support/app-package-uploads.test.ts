import { afterEach, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppPackageUploads, packageChunkBytes, type PackageUploadResult, type StagedPackage } from "./app-package-uploads";
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const handles: Array<{ manager: AppPackageUploads; root: string }> = [];
async function fixture(size = packageChunkBytes * 2 + 17) {
  const root = await mkdtemp(join(tmpdir(), "saydian-package-test-"));
  let now = Date.now();
  const bytes = Buffer.alloc(size, 7); bytes[0] = 0x50; bytes[1] = 0x4b;
  const published: Buffer[] = [];
  const publish = vi.fn(async (_admin: string, file: StagedPackage, platform: string, product: string, stableName: string): Promise<PackageUploadResult> => {
    const data = await readFile(file.path); published.push(data);
    return { fileName: stableName, url: `/global/api/saydian-app/v2/support/app-package/${stableName}`, sizeBytes: file.size, sha256: digest(data) };
  });
  const manager = new AppPackageUploads(publish, root, () => now);
  handles.push({ manager, root });
  const input = { requestId: randomUUID(), fileName: "client.hap", sizeBytes: bytes.length, sha256: digest(bytes) };
  const start = () => manager.start("owner", input, "harmonyos", "say-ring");
  const part = (offset: number, value = bytes.subarray(offset, Math.min(offset + packageChunkBytes, bytes.length)), owner = "owner") => manager.part(owner, input.requestId, String(offset), { buffer: value, size: value.length } as Express.Multer.File);
  const all = async () => { await start(); for (let offset = 0; offset < bytes.length; offset += packageChunkBytes) await part(offset); };
  return { root, bytes, input, publish, published, manager, start, part, all, advance: (ms: number) => { now += ms; } };
}
afterEach(async () => { for (const h of handles.splice(0)) { await h.manager.destroy(); await rm(h.root, { recursive: true, force: true }); } });
it("assembles exact original bytes and completes idempotently without republishing", async () => {
  const h = await fixture(); await h.all();
  const one = await h.manager.complete("owner", h.input.requestId), two = await h.manager.complete("owner", h.input.requestId);
  expect(two).toEqual(one); expect(one.sha256).toBe(h.input.sha256); expect(h.publish).toHaveBeenCalledTimes(1);
  expect(Buffer.compare(h.published[0]!, h.bytes)).toBe(0);
  expect(one.fileName).toMatch(/^say-ring-harmonyos-.*\.hap$/);
  await expect(stat(join(h.root, h.input.requestId))).rejects.toThrow();
});
it("retries starts and the latest acknowledged fragment without appending duplicate bytes", async () => {
  const h = await fixture(); expect((await h.start()).receivedBytes).toBe(0); await h.part(0);
  expect((await h.start()).receivedBytes).toBe(packageChunkBytes);
  expect((await h.part(0)).receivedBytes).toBe(packageChunkBytes);
  await h.part(packageChunkBytes); await h.part(packageChunkBytes * 2);
  await h.manager.complete("owner", h.input.requestId); expect(Buffer.compare(h.published[0]!, h.bytes)).toBe(0);
});
it("binds a session to its administrator, product, size and digest", async () => {
  const h = await fixture(); await h.start();
  await expect(h.part(0, undefined, "other")).rejects.toThrow();
  await expect(h.manager.complete("other", h.input.requestId)).rejects.toThrow();
  await expect(h.manager.cancel("other", h.input.requestId)).rejects.toThrow();
  for (const input of [{ ...h.input, sha256: "f".repeat(64) }, { ...h.input, sizeBytes: 99 }]) await expect(h.manager.start("owner", input, "harmonyos", "say-ring")).rejects.toThrow();
  await expect(h.manager.start("owner", h.input, "harmonyos", "saidian")).rejects.toThrow();
  expect(h.publish).not.toHaveBeenCalled();
});
it("overwrites an interrupted partial disk write at the original offset on retry", async () => {
  const h = await fixture(20); await h.start();
  const file = (h.manager as any).sessions.get(h.input.requestId).handle;
  const original = file.write.bind(file); let failed = false;
  file.write = async (buffer: Buffer, offset: number, length: number, position: number) => {
    if (!failed) { failed = true; await original(buffer, offset, 5, position); throw new Error("synthetic interrupted write"); }
    return original(buffer, offset, length, position);
  };
  await expect(h.part(0)).rejects.toThrow(); await h.part(0); await h.manager.complete("owner", h.input.requestId);
  expect(Buffer.compare(h.published[0]!, h.bytes)).toBe(0);
});
it("rejects wrong product, extension, digest, UUID and over-limit declarations", async () => {
  const h = await fixture();
  for (const input of [{ ...h.input, requestId: "../../outside" }, { ...h.input, fileName: "client.app" }, { ...h.input, sizeBytes: 128 * packageChunkBytes + 1 }, { ...h.input, sizeBytes: 0 }, { ...h.input, sha256: "invalid" }]) await expect(h.manager.start("owner", input, "harmonyos", "say-ring")).rejects.toThrow();
  await expect(h.manager.start("owner", h.input, "harmonyos", "saydian-app-cn")).rejects.toThrow();
  await expect(h.manager.start("owner", h.input, "harmonyos", "unknown")).rejects.toThrow();
});
it("rejects incomplete, oversized, out-of-order and conflicting fragments without publishing", async () => {
  const h = await fixture(); await h.start();
  await expect(h.manager.complete("owner", h.input.requestId)).rejects.toThrow();
  await expect(h.part(packageChunkBytes)).rejects.toThrow();
  await expect(h.part(0, Buffer.alloc(packageChunkBytes + 1))).rejects.toThrow();
  await expect(h.part(0, Buffer.from("bad header"))).rejects.toThrow();
  await h.part(0); await expect(h.part(0, Buffer.alloc(packageChunkBytes, 5))).rejects.toThrow();
  expect(h.publish).not.toHaveBeenCalled();
});
it("validates the full SHA before public object storage writes", async () => {
  const h = await fixture(); h.input.sha256 = "f".repeat(64); await h.all();
  await expect(h.manager.complete("owner", h.input.requestId)).rejects.toThrow(/完整性/); expect(h.publish).not.toHaveBeenCalled();
});
it("retries a failed final storage call using the identical immutable object name", async () => {
  const h = await fixture(); await h.all();
  h.publish.mockRejectedValueOnce(new Error("synthetic storage failure"));
  await expect(h.manager.complete("owner", h.input.requestId)).rejects.toThrow();
  await h.manager.complete("owner", h.input.requestId);
  expect(h.publish.mock.calls[0]![4]).toBe(h.publish.mock.calls[1]![4]);
});
it("serializes final full-file reads and rejects concurrent work on the same session", async () => {
  const h = await fixture(20); await h.all();
  let resolve!: (value: PackageUploadResult) => void;
  h.publish.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const finish = h.manager.complete("owner", h.input.requestId); await vi.waitFor(() => expect(h.publish).toHaveBeenCalled());
  await expect(h.manager.complete("owner", h.input.requestId)).rejects.toThrow();
  await expect(h.manager.cancel("owner", h.input.requestId)).rejects.toThrow();
  resolve({ fileName: "synthetic.hap", url: "synthetic", sizeBytes: 20, sha256: h.input.sha256 }); await finish;
});
it("bounds pending uploads and cancels only unpublished staging", async () => {
  const h = await fixture(); await h.start();
  await h.manager.start("owner", { ...h.input, requestId: randomUUID() }, "harmonyos", "say-ring");
  await expect(h.manager.start("owner", { ...h.input, requestId: randomUUID() }, "harmonyos", "say-ring")).rejects.toThrow();
  await h.manager.cancel("owner", h.input.requestId);
  await expect(h.part(0)).rejects.toThrow();
  expect(h.publish).not.toHaveBeenCalled();
});
it("bounds the aggregate reserved temporary bytes including interrupted-process files", async () => {
  const h = await fixture(20); await h.start(); await h.manager.cancel("owner", h.input.requestId);
  const orphan = join(h.root, randomUUID()); await mkdir(orphan); await writeFile(join(orphan, "package.bin"), Buffer.alloc(3 * packageChunkBytes));
  await expect(h.manager.start("owner", { ...h.input, requestId: randomUUID(), sizeBytes: 126 * packageChunkBytes }, "harmonyos", "say-ring")).rejects.toThrow();
  const large = { ...h.input, requestId: randomUUID(), sizeBytes: 125 * packageChunkBytes };
  await h.manager.start("owner", large, "harmonyos", "say-ring");
  await expect(h.manager.start("another", { ...h.input, requestId: randomUUID() }, "harmonyos", "say-ring")).rejects.toThrow();
  expect(h.publish).not.toHaveBeenCalled();
});
it("expires only owned temporary fragments and recognizes expired interrupted-process staging", async () => {
  const h = await fixture(); await h.start(); await h.part(0);
  await writeFile(join(h.root, "keep.txt"), "untouched");
  const orphan = join(h.root, randomUUID()); await mkdir(orphan); await writeFile(join(orphan, "package.bin"), "unpublished");
  const before = new Date(Date.now() - 20 * 60_000); await utimes(join(orphan, "package.bin"), before, before);
  h.advance(16 * 60_000); await h.manager.expire();
  await expect(h.part(0)).rejects.toThrow(); await expect(stat(orphan)).rejects.toThrow();
  expect(await readFile(join(h.root, "keep.txt"), "utf8")).toBe("untouched"); expect(h.publish).not.toHaveBeenCalled();
});
