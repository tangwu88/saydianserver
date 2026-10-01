import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest } from "./release-manifest.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function validateTransfer(transfer, manifestText, revision) {
  const manifest = validateManifest(JSON.parse(manifestText), revision);
  assert(transfer.schemaVersion === 1 && transfer.revision === revision);
  assert(transfer.manifestSha256 === digest(manifestText), "Release manifest differs");
  assert(/^[a-f0-9]{64}$/.test(transfer.archive.sha256));
  assert(Number.isSafeInteger(transfer.archive.sizeBytes) && transfer.archive.sizeBytes > 0);
  assert(Array.isArray(transfer.chunks) && transfer.chunks.length > 0 && transfer.chunks.length <= 256);
  transfer.chunks.forEach((chunk, index) => {
    assert(chunk.name === `chunk-${String(index).padStart(3, "0")}`, "Unexpected chunk path/order");
    assert(/^[a-f0-9]{64}$/.test(chunk.sha256));
    assert(Number.isSafeInteger(chunk.sizeBytes) && chunk.sizeBytes > 0 && chunk.sizeBytes <= 8 * 1024 ** 2);
  });
  assert(transfer.chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0) === transfer.archive.sizeBytes);
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, revision, manifestPath, transferPath, payloadPath, chunkName] = process.argv.slice(2);
  const manifestText = readFileSync(manifestPath, "utf8");
  if (mode === "create") {
    const chunks = readdirSync(chunkName).sort().map(name => ({ name, sizeBytes: statSync(resolve(chunkName, name)).size, sha256: digest(readFileSync(resolve(chunkName, name))) }));
    const transfer = { schemaVersion: 1, revision, manifestSha256: digest(manifestText), archive: { sizeBytes: statSync(payloadPath).size, sha256: await fileHash(payloadPath) }, chunks };
    validateTransfer(transfer, manifestText, revision);
    writeFileSync(transferPath, JSON.stringify(transfer, null, 2) + "\n", { flag: "wx" });
  } else {
    assert(mode === "verify");
    const transfer = JSON.parse(readFileSync(transferPath, "utf8"));
    validateTransfer(transfer, manifestText, revision);
    const chunk = transfer.chunks.find(value => value.name === chunkName);
    assert(chunk && statSync(payloadPath).isFile() && statSync(payloadPath).size === chunk.sizeBytes, "Invalid chunk size");
    assert(await fileHash(payloadPath) === chunk.sha256, "Chunk checksum mismatch");
  }
}
