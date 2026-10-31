import { expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { S3Client } from "@aws-sdk/client-s3";
import { SupportService } from "./support.service";
import { AppPackageUploads, packageChunkBytes } from "./app-package-uploads";
it("streams the original file through the actual S3 SDK with explicit length and SHA, without re-encoding its bytes", async () => {
  const bytes = Buffer.alloc(packageChunkBytes + 17, 3); bytes[0] = 80; bytes[1] = 75;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const received: { bytes: number; sha256: string; encoding: unknown; length: unknown; checksum: unknown }[] = [];
  const server = createServer(async (request, response) => {
    const hash = createHash('sha256'); let count = 0;
    for await (const chunk of request) { hash.update(chunk); count += chunk.length; }
    received.push({ bytes: count, sha256: hash.digest('hex'), encoding: request.headers['content-encoding'], length: request.headers['content-length'], checksum: request.headers['x-amz-checksum-sha256'] });
    response.writeHead(200, { ETag: '"synthetic"', 'Content-Length': '0' }); response.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const storage = new S3Client({ endpoint: `http://127.0.0.1:${address.port}`, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: 'synthetic-test', secretAccessKey: 'synthetic-test' } });
  const upsert = vi.fn(async ({ create }) => create);
  const support = new SupportService({ fileObject: { upsert }, integrationConfig: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) } } as any, {} as any);
  (support as any).storage = async () => ({ bucket: 'synthetic-fixture', s3: storage });
  const root = await mkdtemp(join(tmpdir(), 'saydian-stream-test-'));
  const manager = new AppPackageUploads((...args) => (support as any).uploadStagedAppPackage(...args), root);
  try {
    const id = randomUUID(); await manager.start('synthetic', { requestId: id, fileName: 'test.hap', sizeBytes: bytes.length, sha256 }, 'harmonyos', 'say-ring');
    for (let offset = 0; offset < bytes.length; offset += packageChunkBytes) { const buffer = bytes.subarray(offset, offset + packageChunkBytes); await manager.part('synthetic', id, String(offset), { buffer, size: buffer.length } as Express.Multer.File); }
    await manager.complete('synthetic', id); await manager.complete('synthetic', id);
    expect(received).toEqual([{ bytes: bytes.length, sha256, encoding: undefined, length: String(bytes.length), checksum: Buffer.from(sha256, 'hex').toString('base64') }]);
    expect(upsert).toHaveBeenCalledTimes(1);
  } finally { await manager.destroy(); storage.destroy(); await new Promise<void>(r => server.close(() => r())); await rm(root, { recursive: true, force: true }); }
}, 15000);
