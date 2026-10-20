import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import sharp from "sharp";
import { sha256 } from "../common/crypto";

export const publicImageWidths = [160, 480, 960, 1440] as const;
export function publicImageWidth(value: unknown): number {
  if (typeof value !== "string" || !publicImageWidths.some(width => String(width) === value))
    throw new BadRequestException("图片宽度仅支持160、480、960或1440");
  return Number(value);
}

type Variant = { bytes: Buffer; sha256: string; contentType: "image/webp" };

/** Only receives bytes of an ACTIVE public admin-content image, after authorization. */
export class PublicImageVariants {
  private readonly cache = new Map<string, Variant>();
  private readonly pending = new Map<string, Promise<Variant>>();
  private readonly waiters: Array<() => void> = [];
  private active = 0;
  private cachedBytes = 0;

  constructor(private readonly limits = { bytes: 32 * 1024 * 1024, entries: 128, concurrent: 2, pending: 16 }) {}

  async get(sourceSha256: string, width: number, load: () => Promise<Buffer>): Promise<Variant> {
    const key = `webp-v1:${sourceSha256}:${width}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached);
      return cached;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.pending.size >= this.limits.pending) throw new ServiceUnavailableException("图片正在处理，请稍后重试");
    const task = this.create(sourceSha256, width, load);
    this.pending.set(key, task);
    try {
      const value = await task;
      if (value.bytes.length <= this.limits.bytes) {
        this.cache.set(key, value); this.cachedBytes += value.bytes.length;
        while (this.cache.size > this.limits.entries || this.cachedBytes > this.limits.bytes) {
          const oldest = this.cache.keys().next().value!;
          this.cachedBytes -= this.cache.get(oldest)!.bytes.length; this.cache.delete(oldest);
        }
      }
      return value;
    } finally { this.pending.delete(key); }
  }

  private async create(digest: string, width: number, load: () => Promise<Buffer>): Promise<Variant> {
    if (this.active < this.limits.concurrent) this.active++;
    else await new Promise<void>(resolve => this.waiters.push(resolve));
    try {
      const source = await load();
      if (!source.length || source.length > 10 * 1024 * 1024 || sha256(source) !== digest)
        throw new ServiceUnavailableException("商品图片校验失败");
      try {
        const raster = source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          (source[0] === 255 && source[1] === 216 && source[2] === 255) ||
          (source.subarray(0, 4).toString("ascii") === "RIFF" && source.subarray(8, 12).toString("ascii") === "WEBP");
        if (!raster) throw new Error("Unsupported raster format");
        const pipeline = sharp(source, { limitInputPixels: 40_000_000, failOn: "warning" });
        const metadata = await pipeline.metadata();
        if ((metadata.pages || 1) > 1) throw new Error("Keep animated originals");
        const bytes = await pipeline
          .rotate().resize({ width, withoutEnlargement: true })
          .webp({ quality: 82, effort: 3 }).timeout({ seconds: 4 }).toBuffer();
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Oversized image");
        return { bytes, sha256: sha256(bytes), contentType: "image/webp" };
      } catch { throw new BadRequestException("商品图片暂时无法转换"); }
    } finally {
      const next = this.waiters.shift();
      if (next) next(); else this.active--;
    }
  }
}
