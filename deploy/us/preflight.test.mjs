import test from "node:test";
import assert from "node:assert/strict";
import { capacityReport, releasePreflight, reserveBytes } from "./preflight.mjs";
const manifest = { images: { api: { sizeBytes: 100 }, worker: { sizeBytes: 200 }, admin: { sizeBytes: 300 } }, migrations: [] };
const state = () => ({ schemaVersion: 1, host: "47.85.43.52", site: "us", infrastructureImageBytes: 40, databaseBytes: 10, fileBytes: 20, backupBytes: 30, restoreBytes: 40, transferBytes: 50, logBytes: 60, previousReleaseBytes: 70, restoreAccepted: true, accountSelectionAccepted: true, filesVerified: true });
test("reserves infrastructure, source data, files, transfer, backup, restore, logs, previous release and 5 GiB", () => {
  const required = 920 + reserveBytes;
  assert.equal(releasePreflight(manifest, state(), [], required).requiredBytes, required);
  assert.equal(capacityReport(manifest, state(), required - 1).missingBytes, 1);
  assert.throws(() => releasePreflight(manifest, state(), [], required - 1), /missing 1 bytes/);
});
test("refuses missing measurements and unaccepted migration; cannot target China", () => {
  for (const key of ["host", "site", "databaseBytes", "backupBytes", "restoreBytes", "logBytes", "restoreAccepted", "accountSelectionAccepted", "filesVerified"]) {
    const invalid = state(); delete invalid[key];
    assert.throws(() => releasePreflight(manifest, invalid, [], 10 * reserveBytes));
  }
});
