import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { SupportService } from "./support.service";

const prior = {
  realm: process.env.APP_REALM,
  enabled: process.env.SAY_RING_LOCAL_AVATAR_WRITE_ENABLED,
  directory: process.env.SAY_RING_AVATAR_DIR,
};
let avatarDirectory = "";

function service() {
  const rows = new Map<string, Record<string, unknown>>();
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: "11111111-1111-4111-8111-111111111111", status: "ACTIVE", ...data };
    rows.set(row.id, row);
    return row;
  });
  const findUnique = vi.fn(async ({ where }: { where: { id?: string; objectKey?: string } }) =>
    where.id ? rows.get(where.id) ?? null : [...rows.values()].find((row) => row.objectKey === where.objectKey) ?? null);
  const db = { fileObject: { create, findUnique }, integrationConfig: { findUnique: vi.fn(async () => null) } };
  const support = new SupportService(db as any, { resolve: vi.fn() } as any);
  return { support, rows, create };
}

async function image(width = 2400, height = 1200): Promise<Express.Multer.File> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: "#356ad1" } })
    .jpeg({ quality: 85 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  return { buffer, size: buffer.length, mimetype: "image/jpeg", originalname: "synthetic.jpg" } as Express.Multer.File;
}

beforeEach(async () => {
  avatarDirectory = await mkdtemp(join(tmpdir(), "say-ring-avatar-"));
  process.env.APP_REALM = "global";
  process.env.SAY_RING_LOCAL_AVATAR_WRITE_ENABLED = "true";
  process.env.SAY_RING_AVATAR_DIR = avatarDirectory;
});

afterEach(async () => {
  for (const [key, value] of Object.entries({ APP_REALM: prior.realm, SAY_RING_LOCAL_AVATAR_WRITE_ENABLED: prior.enabled, SAY_RING_AVATAR_DIR: prior.directory })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await rm(avatarDirectory, { recursive: true, force: true });
});

describe("Say Ring server-local avatar", () => {
  it("stores a normalized avatar locally and reads the same bytes after service reconstruction", async () => {
    const first = service();
    await first.support.onModuleInit();
    const uploaded = await first.support.uploadSayRingAvatar("22222222-2222-4222-8222-222222222222", await image());
    expect(uploaded.url).toBe(`http://localhost:8080/api/saydian-app/v2/files/${uploaded.id}`);
    expect(first.create).toHaveBeenCalledOnce();
    const row = first.rows.get(uploaded.id)!;
    expect(row.objectKey).toMatch(/^say-ring-avatar\/v1\/[0-9a-f-]+\.jpg$/);
    expect(await readdir(avatarDirectory)).toHaveLength(1);
    const saved = await readFile(join(avatarDirectory, String(row.objectKey).split("/").at(-1)!));
    const metadata = await sharp(saved).metadata();
    expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1024);
    expect(metadata.exif).toBeUndefined();
    const second = service();
    second.rows.set(uploaded.id, row);
    const response = await second.support.publicFile(uploaded.id);
    const chunks: Buffer[] = [];
    for await (const chunk of response.body as Readable) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(saved);
    expect(response.sha256).toBe(uploaded.sha256);
  });

  it("rejects a missing mounted directory without storing metadata or falling back to S3", async () => {
    process.env.SAY_RING_AVATAR_DIR = join(avatarDirectory, "missing");
    const h = service();
    await expect(h.support.onModuleInit()).rejects.toMatchObject({ status: 503 });
    await expect(h.support.uploadSayRingAvatar("member", await image())).rejects.toMatchObject({ status: 503 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects disguised images, and removes a completed file if metadata persistence fails", async () => {
    const h = service();
    const invalid = { buffer: Buffer.from("not an image"), size: 12, mimetype: "image/png", originalname: "bad.png" } as Express.Multer.File;
    await expect(h.support.uploadSayRingAvatar("member", invalid)).rejects.toMatchObject({ status: 400 });
    const oversized = { buffer: Buffer.alloc(10 * 1024 * 1024 + 1), size: 10 * 1024 * 1024 + 1, mimetype: "image/png", originalname: "large.png" } as Express.Multer.File;
    await expect(h.support.uploadSayRingAvatar("member", oversized)).rejects.toMatchObject({ status: 400 });
    expect(h.create).not.toHaveBeenCalled();
    h.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(h.support.uploadSayRingAvatar("member", await image())).rejects.toThrow("database unavailable");
    expect(await readdir(avatarDirectory)).toEqual([]);
  });

  it("keeps file bytes when a database insert committed but its response was lost", async () => {
    const h = service();
    h.create.mockImplementationOnce(async ({ data }) => {
      h.rows.set("committed", { id: "committed", status: "ACTIVE", ...data });
      throw new Error("commit response lost");
    });
    await expect(h.support.uploadSayRingAvatar("member", await image())).rejects.toThrow("commit response lost");
    expect(await readdir(avatarDirectory)).toHaveLength(1);
  });

  it("never enables the dedicated upload for the domestic realm", async () => {
    process.env.APP_REALM = "domestic";
    const h = service();
    await expect(h.support.uploadSayRingAvatar("member", await image())).rejects.toMatchObject({ status: 404 });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects tampered local keys and missing or corrupted files without exposing another path", async () => {
    const h = service();
    const row = { id: "file-id", purpose: "avatar", status: "ACTIVE", objectKey: "say-ring-avatar/v1/../../etc/passwd", byteSize: 10, sha256: "bad", contentType: "image/jpeg" };
    h.rows.set(row.id, row);
    await expect(h.support.publicFile(row.id)).rejects.toMatchObject({ status: 404 });
    row.objectKey = "say-ring-avatar/v1/11111111-1111-4111-8111-111111111111.jpg";
    await expect(h.support.publicFile(row.id)).rejects.toMatchObject({ status: 503 });
    await writeFile(join(avatarDirectory, "11111111-1111-4111-8111-111111111111.jpg"), Buffer.alloc(10));
    await expect(h.support.publicFile(row.id)).rejects.toMatchObject({ status: 503 });
  });

  it("leaves the old S3 path unchanged while the local feature flag is off", async () => {
    process.env.SAY_RING_LOCAL_AVATAR_WRITE_ENABLED = "false";
    const h = service();
    await expect(h.support.uploadSayRingAvatar("member", await image())).rejects.toMatchObject({ status: 503 });
    expect(await readdir(avatarDirectory)).toEqual([]);
    h.rows.set("old", { id: "old", purpose: "avatar", status: "ACTIVE", objectKey: "avatar/member/old.jpg", byteSize: 1, sha256: "old", contentType: "image/jpeg" });
    await expect(h.support.publicFile("old")).rejects.toMatchObject({ status: 503 });
  });

  it("keeps the shared upload route on its existing storage path even when local writes are enabled", async () => {
    const h = service();
    await expect(h.support.uploadImage("member", await image(), "avatar")).rejects.toMatchObject({ status: 503 });
    expect(h.create).not.toHaveBeenCalled();
    expect(await readdir(avatarDirectory)).toEqual([]);
  });
});
