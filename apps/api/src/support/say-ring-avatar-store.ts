import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, unlink } from "node:fs/promises";
import { isAbsolute, join, parse } from "node:path";
import sharp from "sharp";
import { env } from "../common/environment";
import { sha256 } from "../common/crypto";
import { validateEvidenceImage } from "../commerce/commerce-evidence";

const prefix = "say-ring-avatar/v1/";
const filePattern = /^say-ring-avatar\/v1\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp)$/;
const productionDirectory = "/var/lib/saydian/say-ring-avatars";

export function isSayRingLocalAvatarKey(key: string): boolean {
  return key.startsWith("say-ring-avatar/");
}

function directory(): string {
  const value = env("SAY_RING_AVATAR_DIR");
  if (!isAbsolute(value) || value === parse(value).root || (process.env.NODE_ENV === "production" && value !== productionDirectory)) {
    throw new ServiceUnavailableException("头像文件服务暂时不可用");
  }
  return value;
}

function filePath(key: string): string {
  const match = filePattern.exec(key);
  if (!match) throw new NotFoundException("文件不存在");
  return join(directory(), `${match[1]}.${match[2]}`);
}

export async function assertSayRingAvatarDirectory(): Promise<void> {
  const root = directory();
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Not a private directory");
    const probe = join(root, `.write-check-${randomUUID()}`);
    const handle = await open(probe, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.sync(); } finally { await handle.close(); await unlink(probe); }
  } catch {
    throw new ServiceUnavailableException("头像文件服务暂时不可用");
  }
}

export async function normalizeSayRingAvatar(file: Express.Multer.File): Promise<{ bytes: Buffer; contentType: string; extension: string; sha256: string }> {
  const contentType = validateEvidenceImage(file);
  const format = contentType === "image/jpeg" ? "jpeg" : contentType === "image/png" ? "png" : "webp";
  try {
    const bytes = await sharp(file.buffer, { failOn: "error", limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .toFormat(format)
      .toBuffer();
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Invalid output size");
    return { bytes, contentType, extension: format === "jpeg" ? "jpg" : format, sha256: sha256(bytes) };
  } catch {
    throw new BadRequestException("头像图片无法处理，请选择有效的 JPG、PNG 或 WebP 图片");
  }
}

export async function writeSayRingAvatar(bytes: Buffer, extension: string): Promise<{ objectKey: string; path: string }> {
  await assertSayRingAvatarDirectory();
  const objectKey = `${prefix}${randomUUID()}.${extension}`;
  const path = filePath(objectKey);
  const temporary = `${path}.pending-${randomUUID()}`;
  let linked = false;
  try {
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await link(temporary, path);
    linked = true;
    await unlink(temporary);
    const directoryHandle = await open(directory(), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return { objectKey, path };
  } catch {
    await unlink(temporary).catch(() => undefined);
    if (linked) await unlink(path).catch(() => undefined);
    throw new ServiceUnavailableException("头像文件服务暂时不可用");
  }
}

export async function readSayRingAvatar(key: string, expectedSize: number, expectedSha256: string): Promise<Buffer> {
  const path = filePath(key);
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== expectedSize) throw new Error("Invalid avatar file");
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    if (bytes.length !== expectedSize || sha256(bytes) !== expectedSha256) throw new Error("Avatar checksum mismatch");
    return bytes;
  } catch {
    throw new ServiceUnavailableException("头像文件暂时无法读取");
  }
}

export async function removeSayRingAvatar(key: string): Promise<void> {
  await unlink(filePath(key)).catch(() => undefined);
}
