import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import sharp from "sharp";
import { sha256 } from "../common/crypto";
import { PublicImageVariants, publicImageWidth } from "./public-image-variants";
import { SupportService } from "./support.service";
import { FilesController } from "./support.controller";

const image = (background = "#bb092c") => sharp({ create: { width: 1200, height: 1800, channels: 3, background } }).png().toBuffer();
const id = "5dacdf96-6389-45bf-bc68-3fb2ac95ead1";
function harness(bytes: Buffer) {
  const row = { id, purpose: "admin-content", ownerUserId: null, status: "ACTIVE", contentType: "image/png", byteSize: bytes.length, sha256: sha256(bytes), objectKey: "synthetic-public.png" };
  const prisma = { fileObject: { findFirst: vi.fn().mockResolvedValue(row) } };
  const send = vi.fn().mockImplementation(async () => ({ Body: Readable.from([bytes]) }));
  const service = new SupportService(prisma as never, {} as never);
  vi.spyOn(service as any, "storage").mockResolvedValue({ bucket: "synthetic", s3: { send } });
  return { service, prisma, send, row };
}

describe("bounded public product image variants", () => {
  it("only accepts fixed sizes; arbitrary widths cannot multiply cache entries", () => {
    for (const width of ["160", "480", "960", "1440"]) expect(publicImageWidth(width)).toBe(Number(width));
    for (const width of [undefined, 960, "961", "0960", "960px", ["960"], "-1"]) expect(() => publicImageWidth(width)).toThrow();
  });

  it("produces aspect-preserving WebP without enlarging or overwriting the original", async () => {
    const source = await image(), original = Buffer.from(source), variants = new PublicImageVariants();
    const small = await variants.get(sha256(source), 160, async () => source);
    const large = await variants.get(sha256(source), 1440, async () => source);
    expect(await sharp(small.bytes).metadata()).toMatchObject({ format: "webp", width: 160, height: 240 });
    expect(await sharp(large.bytes).metadata()).toMatchObject({ format: "webp", width: 1200, height: 1800 });
    expect(small.sha256).toBe(sha256(small.bytes)); expect(source).toEqual(original);
  });

  it("coalesces concurrent requests and reuses the output cache", async () => {
    const source = await image(), variants = new PublicImageVariants(), load = vi.fn(async () => source);
    const outputs = await Promise.all(Array.from({ length: 8 }, () => variants.get(sha256(source), 960, load)));
    expect(load).toHaveBeenCalledTimes(1); expect(outputs.every(value => value === outputs[0])).toBe(true);
    await variants.get(sha256(source), 960, load); expect(load).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrency and waiting work, then recovers after completion", async () => {
    const first = await image(), second = await image("#222222"), third = await image("#eeeeee");
    const variants = new PublicImageVariants({ bytes: 1024 * 1024, entries: 8, concurrent: 1, pending: 2 });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const nextLoad = vi.fn(async () => second);
    const a = variants.get(sha256(first), 160, async () => { await gate; return first; });
    const b = variants.get(sha256(second), 160, nextLoad);
    await expect(variants.get(sha256(third), 160, async () => third)).rejects.toThrow("正在处理");
    expect(nextLoad).not.toHaveBeenCalled(); release(); await Promise.all([a, b]);
    await expect(variants.get(sha256(third), 160, async () => third)).resolves.toMatchObject({ contentType: "image/webp" });
  });

  it("evicts old cache entries and never caches corrupt or mismatched sources", async () => {
    const first = await image(), second = await image("#eeeeee");
    const variants = new PublicImageVariants({ bytes: 1024 * 1024, entries: 1, concurrent: 1, pending: 2 });
    const load = vi.fn(async () => first);
    await variants.get(sha256(first), 160, load); await variants.get(sha256(second), 160, async () => second);
    await variants.get(sha256(first), 160, load); expect(load).toHaveBeenCalledTimes(2);
    await expect(variants.get(sha256(first), 480, async () => second)).rejects.toThrow("校验失败");
    const broken = Buffer.from("not-an-image");
    await expect(variants.get(sha256(broken), 480, async () => broken)).rejects.toThrow("无法转换");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><image href="file:///synthetic-not-read"/></svg>');
    await expect(variants.get(sha256(svg), 480, async () => svg)).rejects.toThrow("无法转换");
    await expect(variants.get(sha256(first), 480, async () => first)).resolves.toMatchObject({ contentType: "image/webp" });
  });

  it("authorizes public admin images on every request, including cache hits", async () => {
    const h = harness(await image());
    await h.service.publicImage(id, "480"); await h.service.publicImage(id, "480");
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.prisma.fileObject.findFirst).toHaveBeenCalledWith({ where: { id, status: "ACTIVE", purpose: "admin-content", ownerUserId: null } });
    h.prisma.fileObject.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.publicImage(id, "480")).rejects.toThrow("不存在");
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid IDs, private/missing files, unsupported formats and excessive input sizes before reads", async () => {
    const h = harness(await image());
    await expect(h.service.publicImage("../private", "480")).rejects.toThrow("不存在");
    expect(h.prisma.fileObject.findFirst).not.toHaveBeenCalled();
    h.prisma.fileObject.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.publicImage(id, "480")).rejects.toThrow("不存在");
    h.prisma.fileObject.findFirst.mockResolvedValueOnce({ ...h.row, contentType: "image/svg+xml" });
    await expect(h.service.publicImage(id, "480")).rejects.toThrow("不存在");
    h.prisma.fileObject.findFirst.mockResolvedValueOnce({ ...h.row, byteSize: 11 * 1024 * 1024 });
    await expect(h.service.publicImage(id, "480")).rejects.toThrow("过大"); expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses incomplete source streams without caching partial bytes", async () => {
    const h = harness(await image());
    h.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from("truncated")]) });
    await expect(h.service.publicImage(id, "480")).rejects.toThrow("无法读取");
    await expect(h.service.publicImage(id, "480")).resolves.toMatchObject({ contentType: "image/webp" });
  });

  it("returns a conditional 304 only after the public-source check; originals are unaffected", async () => {
    const body = Readable.from([Buffer.from("synthetic")]), pipe = vi.spyOn(body, "pipe"), destroy = vi.spyOn(body, "destroy");
    const support = { publicImage: vi.fn().mockResolvedValue({ body, sha256: "a".repeat(64), contentType: "image/webp", byteSize: 9 }) };
    const controller = new FilesController(support as never);
    const response = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
    await controller.image(id, "480", `W/"${"a".repeat(64)}"`, response as never);
    expect(support.publicImage).toHaveBeenCalledWith(id, "480");
    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "public, max-age=86400");
    expect(response.status).toHaveBeenCalledWith(304); expect(destroy).toHaveBeenCalled(); expect(pipe).not.toHaveBeenCalled();
  });
});
