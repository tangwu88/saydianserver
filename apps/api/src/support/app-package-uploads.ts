import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException, HttpException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, lstat, rm, stat, realpath, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";

export const packageChunkBytes = 1024 * 1024;
const maxBytes = 128 * packageChunkBytes;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export type PackageUploadResult = { fileName: string; url: string; sizeBytes: number; sha256: string };
export type StagedPackage = { path: string; size: number; sha256: string };
export function packageTarget(name: unknown, platformInput: unknown, productInput: unknown = "say-ring") {
  const platform = String(platformInput ?? "").trim().toLowerCase(), product = String(productInput ?? "say-ring");
  if (!["saidian", "saydian-global", "say-ring", "saydian-app-cn"].includes(product)) throw new BadRequestException("请选择有效的 App");
  if (product === "saydian-app-cn" && platform !== "android") throw new BadRequestException("中文版目前仅发布安卓安装包");
  const extension = platform === "android" ? "apk" : platform === "harmonyos" ? "hap" : "";
  if (!extension || !String(name ?? "").toLowerCase().endsWith(`.${extension}`)) throw new BadRequestException("请选择与平台匹配的 APK 或 HAP 安装包");
  return { platform, product, extension };
}
type Session = ReturnType<typeof packageTarget> & {
  id: string; adminId: string; total: number; sha256: string; fileName: string;
  directory: string; handle?: FileHandle; received: number; touched: number; busy: boolean;
  last?: { offset: number; sha256: string; bytes: number }; result?: PackageUploadResult;
};
type Publish = (adminId: string, file: StagedPackage, platform: string, product: string, stableName: string) => Promise<PackageUploadResult>;

/** Single API-instance upload sessions; only unpublished, bounded temporary bytes live here. */
export class AppPackageUploads {
  private readonly root: string;
  private readonly sessions = new Map<string, Session>();
  private readonly starting = new Map<string, { adminId: string; total: number }>();
  private ready?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private finalizing = false;
  constructor(private readonly publish: Publish, root = join(tmpdir(), "saydian-app-package-uploads"), private readonly now = Date.now) { this.root = resolve(root); }
  private async initialize() {
    this.ready ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      if ((await lstat(this.root)).isSymbolicLink() || resolve(await realpath(this.root)) !== this.root) throw new Error("Invalid upload staging root");
    })();
    try { await this.ready; } catch { delete this.ready; throw new ServiceUnavailableException("上传暂时无法初始化，请重试"); }
    if (!this.timer) { this.timer = setInterval(() => void this.expire().catch(() => {}), 60_000); this.timer.unref(); }
  }
  private async removeDirectory(directory: string) {
    const target = resolve(directory);
    if (dirname(target) !== this.root || !uuid.test(basename(target))) throw new Error("Invalid upload staging path");
    const info = await lstat(target).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error("Invalid upload staging directory");
    await rm(target, { recursive: true, force: true });
  }
  private current(adminId: string, id: string) {
    const s = this.sessions.get(id);
    if (!s || s.adminId !== adminId) throw new NotFoundException("上传会话已失效，请重新选择安装包");
    return s;
  }
  private lease(s: Session) {
    if (s.busy) throw new ConflictException("上传片段正在处理中，请稍后重试");
    s.busy = true; s.touched = this.now();
    return () => { s.busy = false; s.touched = this.now(); };
  }
  private status(s: Session) { return { uploadId: s.id, chunkBytes: packageChunkBytes, receivedBytes: s.received }; }
  async start(adminId: string, input: Record<string, unknown>, platform: unknown, product: unknown) {
    const target = packageTarget(input.fileName, platform, product), id = String(input.requestId ?? "");
    const total = Number(input.sizeBytes), sha256 = String(input.sha256 ?? "").toLowerCase();
    if (!uuid.test(id) || !Number.isSafeInteger(total) || total < 4 || total > maxBytes || !/^[a-f0-9]{64}$/.test(sha256)) throw new BadRequestException("安装包大小或校验信息不正确");
    await this.initialize(); await this.expire();
    const orphanBytes = await this.orphanBytes();
    const existing = this.sessions.get(id);
    if (existing) {
      if (existing.adminId !== adminId || existing.total !== total || existing.sha256 !== sha256 || existing.platform !== target.platform || existing.product !== target.product) throw new ConflictException("上传标识不匹配，请重新选择安装包");
      return this.status(existing);
    }
    if (this.starting.has(id)) throw new ConflictException("上传初始化中，请稍后重试");
    const active = [...this.sessions.values()].filter(s => !s.result), pending = [...this.starting.values()];
    if (this.sessions.size >= 32 || active.length + pending.length >= 4 || active.filter(s => s.adminId === adminId).length + pending.filter(owner => owner.adminId === adminId).length >= 2 || orphanBytes + total + active.reduce((n, s) => n + s.total, 0) + pending.reduce((n, s) => n + s.total, 0) > maxBytes) throw new HttpException("同时上传的安装包过多，请稍后重试", 429);
    this.starting.set(id, { adminId, total });
    const directory = join(this.root, id);
    let created = false;
    try {
      await mkdir(directory, { mode: 0o700 }); created = true;
      const handle = await open(join(directory, "package.bin"), "wx+", 0o600);
      const s: Session = { ...target, id, adminId, directory, handle, total, sha256, received: 0, touched: this.now(), busy: false, fileName: `${target.product}-${target.platform}-${this.now()}-${randomUUID().slice(0, 8)}.${target.extension}` };
      this.sessions.set(id, s); return this.status(s);
    } catch { if (created) await this.removeDirectory(directory).catch(() => {}); throw new ServiceUnavailableException("上传暂时无法初始化，请重试"); }
    finally { this.starting.delete(id); }
  }
  async part(adminId: string, id: string, offsetInput: string, file: Express.Multer.File | undefined) {
    const s = this.current(adminId, id), release = this.lease(s);
    try {
      if (!/^(0|[1-9]\d{0,8})$/.test(offsetInput)) throw new BadRequestException("上传偏移不正确");
      const offset = Number(offsetInput), bytes = file?.buffer;
      if (!bytes?.length || bytes.length !== file?.size || bytes.length > packageChunkBytes) throw new BadRequestException("上传片段大小不正确");
      const sha256 = digest(bytes);
      if (s.last?.offset === offset && s.last.bytes === bytes.length && s.last.sha256 === sha256) return this.status(s);
      if (s.result || offset !== s.received || bytes.length !== Math.min(packageChunkBytes, s.total - offset)) throw new BadRequestException("上传片段顺序或大小不正确");
      if (offset === 0 && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) throw new BadRequestException("安装包格式不正确");
      let written = 0;
      while (written < bytes.length) {
        const result = await s.handle!.write(bytes, written, bytes.length - written, offset + written);
        if (!result.bytesWritten) throw new Error("Incomplete staging write");
        written += result.bytesWritten;
      }
      s.received += bytes.length; s.last = { offset, sha256, bytes: bytes.length };
      return this.status(s);
    } finally { release(); }
  }
  async complete(adminId: string, id: string) {
    const s = this.current(adminId, id), release = this.lease(s);
    let acquired = false;
    try {
      if (s.result) return s.result;
      if (s.received !== s.total) throw new BadRequestException("安装包尚未上传完整");
      if (this.finalizing) throw new ConflictException("其他安装包正在校验，请稍后重试");
      this.finalizing = true; acquired = true;
      const path = join(s.directory, "package.bin"), hash = createHash("sha256");
      const fileInfo = await stat(path);
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (fileInfo.size !== s.total || hash.digest("hex") !== s.sha256) throw new BadRequestException("安装包完整性校验失败，请重新上传");
      s.result = await this.publish(adminId, { path, size: s.total, sha256: s.sha256 }, s.platform, s.product, s.fileName);
      await this.removeFiles(s).catch(() => {});
      return s.result;
    } finally { if (acquired) this.finalizing = false; release(); }
  }
  private async removeFiles(s: Session) { await s.handle?.close(); delete s.handle; await this.removeDirectory(s.directory); }
  private async orphanBytes() {
    let bytes = 0;
    for (const name of await readdir(this.root)) {
      const session = this.sessions.get(name);
      if (!uuid.test(name) || session && !session.result || this.starting.has(name)) continue;
      const directory = join(this.root, name), info = await lstat(directory).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
      bytes += (await stat(join(directory, "package.bin")).catch(() => null))?.size ?? 0;
    }
    return bytes;
  }
  async cancel(adminId: string, id: string) {
    const s = this.current(adminId, id), release = this.lease(s);
    try { await this.removeFiles(s); this.sessions.delete(id); return { cancelled: true }; } finally { release(); }
  }
  async expire() {
    for (const s of this.sessions.values()) {
      if (!s.busy && this.now() - s.touched > (s.result ? 10 : 15) * 60_000) {
        s.busy = true; this.sessions.delete(s.id);
        try { await this.removeFiles(s); } catch { s.busy = false; this.sessions.set(s.id, s); }
      }
    }
    // Only expired, unpublished staging owned by this feature; includes interrupted prior processes.
    for (const name of await readdir(this.root)) {
      if (!uuid.test(name) || this.sessions.has(name) || this.starting.has(name)) continue;
      const directory = join(this.root, name), info = await lstat(directory).catch(() => null);
      if (!info?.isDirectory() || info.isSymbolicLink()) continue;
      const updated = await stat(join(directory, "package.bin")).catch(() => info);
      if (this.now() - updated.mtimeMs > 15 * 60_000) await this.removeDirectory(directory);
    }
  }
  async destroy() {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled([...this.sessions.values()].filter(s => !s.busy).map(s => this.removeFiles(s)));
  }
}
