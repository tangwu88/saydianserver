import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const components = ["api", "worker", "admin"];
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const repository = "ghcr.io/tangwu88/saydianserver";

export function validateManifest(input, revision) {
  assert(input?.schemaVersion === 1 && sha.test(input.revision), "Invalid release manifest");
  assert(input.revision === revision, "Release revision mismatch");
  assert(Object.keys(input.images ?? {}).sort().join() === [...components].sort().join(), "Expected exactly three images");
  for (const name of components) {
    const image = input.images[name];
    const prefix = `${repository}-${name}@sha256:`;
    assert(typeof image?.ref === "string" && image.ref.startsWith(prefix) && digest.test(image.ref.slice(prefix.length)), "Invalid immutable image reference");
    assert(Number.isSafeInteger(image.sizeBytes) && image.sizeBytes > 0, "Invalid image size");
    assert(/^sha256:[a-f0-9]{64}$/.test(image.imageId), "Invalid image config identity");
  }
  assert(Array.isArray(input.migrations) && input.migrations.length, "Migration inventory missing");
  const names = new Set();
  for (const migration of input.migrations) {
    assert(/^\d{14}_[a-z0-9_]+$/.test(migration.name) && digest.test(migration.sha256), "Invalid migration entry");
    assert(!names.has(migration.name) && typeof migration.automatic === "boolean", "Duplicate or unreviewed migration");
    names.add(migration.name);
  }
  return input;
}

export function composeImages(manifest, prefix = "global-", offline = false) {
  return { services: Object.fromEntries(components.map(name => [prefix + name, { image: offline ? manifest.images[name].imageId : manifest.images[name].ref,
    ...(name !== "admin" ? { environment: { APP_REVISION: manifest.revision } } : {}) }])) };
}

export function verifyMigrationHistory(manifest, applied) {
  const entries = new Map(manifest.migrations.map(entry => [entry.name, entry]));
  const completed = new Set();
  for (const row of applied) {
    if (row.rolled_back_at) continue;
    const expected = entries.get(row.migration_name);
    assert(expected && expected.sha256 === row.checksum, `Migration history differs: ${row.migration_name}`);
    assert(row.finished_at, `Unfinished migration: ${row.migration_name}`);
    completed.add(row.migration_name);
  }
  const pending = manifest.migrations.filter(entry => !completed.has(entry.name));
  assert(pending.every(entry => entry.automatic), "Pending migration requires independent review");
  return pending.map(entry => entry.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, revision, file] = process.argv.slice(2);
  assert(sha.test(revision ?? ""));
  if (command === "create") {
    const approved = JSON.parse(readFileSync("deploy/compatible-migrations.json", "utf8"));
    const directory = "apps/api/prisma/migrations";
    const migrations = readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
      const hash = createHash("sha256").update(readFileSync(`${directory}/${entry.name}/migration.sql`)).digest("hex");
      return { name: entry.name, sha256: hash, automatic: approved[entry.name] === hash };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const images = Object.fromEntries(components.map(name => {
      const [image] = JSON.parse(execFileSync("docker", ["image", "inspect", `${repository}-${name}:sha-${revision}`], { encoding: "utf8" }));
      assert(image.Config.Labels["org.opencontainers.image.revision"] === revision);
      const ref = image.RepoDigests.find(ref => ref.startsWith(`${repository}-${name}@sha256:`));
      return [name, { ref, imageId: image.Id, sizeBytes: image.Size }];
    }));
    writeFileSync(file, JSON.stringify(validateManifest({ schemaVersion: 1, revision, images, migrations }, revision), null, 2) + "\n");
  } else {
    const manifest = validateManifest(JSON.parse(readFileSync(file, "utf8")), revision);
    if (command === "compose" || command === "compose-offline") process.stdout.write(JSON.stringify(composeImages(manifest, "global-", command === "compose-offline")) + "\n");
    else assert(command === "verify");
  }
}
