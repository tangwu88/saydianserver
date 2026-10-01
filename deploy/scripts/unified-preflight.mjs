import assert from "node:assert/strict";
import { readFileSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest, verifyMigrationHistory } from "./release-manifest.mjs";

export function preflight(manifest, state, history, freeBytes, firstCutover = false) {
assert(state.schemaVersion === 1 && (state.cutoverCompleted === true || firstCutover && state.cutoverCompleted === false), "First cutover and restore rehearsal have not been accepted");
assert(state.databaseContainer === "saydian-global-global-postgres-1", "Unexpected member database");
assert(Number.isSafeInteger(state.restoreBytes) && state.restoreBytes > 0, "Restore space estimate missing");
assert(Number.isSafeInteger(state.backupBytes) && state.backupBytes > 0, "Backup space estimate missing");
const required = Object.values(manifest.images).reduce((sum, image) => sum + image.sizeBytes, 0) + state.restoreBytes + state.backupBytes + 5 * 1024 ** 3;
assert(freeBytes >= required, `Insufficient free disk: require ${required} bytes including 5 GiB reserve`);
return { requiredBytes: required, pending: verifyMigrationHistory(manifest, history) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [revision, manifestFile, historyFile, stateFile, targetDirectory, firstCutover] = process.argv.slice(2);
  const manifest = validateManifest(JSON.parse(readFileSync(manifestFile, "utf8")), revision);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const space = statfsSync(targetDirectory);
  console.log(JSON.stringify(preflight(manifest, state, JSON.parse(readFileSync(historyFile, "utf8")), space.bavail * space.bsize, firstCutover === "first-cutover")));
}
