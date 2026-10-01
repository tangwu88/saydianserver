import { test } from "node:test";
import assert from "node:assert/strict";
import { validateManifest, composeImages, verifyMigrationHistory } from "./release-manifest.mjs";
const revision = "a".repeat(40);
const fixture = () => ({ schemaVersion: 1, revision,
  images: Object.fromEntries(["api", "worker", "admin"].map(name => [name, { ref: `ghcr.io/tangwu88/saydianserver-${name}@sha256:${"b".repeat(64)}`, imageId: `sha256:${"d".repeat(64)}`, sizeBytes: 4096 }])),
  migrations: [{ name: "20261001190000_say_ring_legal_product", sha256: "c".repeat(64), automatic: true }] });
test("pins each component to a digest and the same revision", () => {
  const manifest = validateManifest(fixture(), revision);
  assert.equal(composeImages(manifest).services["global-api"].environment.APP_REVISION, revision);
  assert.match(composeImages(manifest).services["global-admin"].image, /@sha256:/);
  assert.equal(composeImages(manifest, "global-", true).services["global-api"].image, manifest.images.api.imageId);
});
test("rejects changed revisions, mutable tags, other repositories and partial releases", () => {
  assert.throws(() => validateManifest(fixture(), "d".repeat(40)));
  for (const ref of ["latest", "ghcr.io/other/api@sha256:" + "b".repeat(64)]) {
    const value = fixture(); value.images.api.ref = ref; assert.throws(() => validateManifest(value, revision));
  }
  const value = fixture(); delete value.images.worker; assert.throws(() => validateManifest(value, revision));
});
test("only permits reviewed exact pending SQL, and refuses drift or failed migrations", () => {
  const value = fixture();
  assert.deepEqual(verifyMigrationHistory(value, []), [value.migrations[0].name]);
  value.migrations[0].automatic = false;
  assert.throws(() => verifyMigrationHistory(value, []), /independent review/);
  const row = { migration_name: value.migrations[0].name, checksum: "c".repeat(64), finished_at: "2026-10-01", rolled_back_at: null };
  assert.deepEqual(verifyMigrationHistory(value, [row]), []);
  assert.throws(() => verifyMigrationHistory(value, [{ ...row, checksum: "d".repeat(64) }]), /differs/);
  assert.throws(() => verifyMigrationHistory(value, [{ ...row, finished_at: null }]), /Unfinished/);
});
