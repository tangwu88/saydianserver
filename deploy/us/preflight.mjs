import assert from "node:assert/strict";
import { readFileSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest, verifyMigrationHistory } from "../scripts/release-manifest.mjs";

export const reserveBytes = 5 * 1024 ** 3;
const sizes = ["infrastructureImageBytes", "databaseBytes", "fileBytes", "backupBytes", "restoreBytes", "transferBytes", "logBytes", "previousReleaseBytes"];
export function capacityReport(manifest, state, freeBytes) {
  assert(state.schemaVersion === 1 && state.host === "47.85.43.52" && state.site === "us", "Unexpected US deployment target");
  assert(Number.isSafeInteger(freeBytes) && freeBytes >= 0, "Invalid free disk measurement");
  for (const key of sizes) assert(Number.isSafeInteger(state[key]) && state[key] >= 0, `Missing measured ${key}`);
  assert(state.databaseBytes > 0 && state.backupBytes > 0 && state.restoreBytes > 0 && state.logBytes > 0, "Database, backup, restore and logs must be budgeted");
  const applicationImageBytes = Object.values(manifest.images).reduce((sum, image) => sum + image.sizeBytes, 0);
  const requiredBytes = applicationImageBytes + sizes.reduce((sum, key) => sum + state[key], 0) + reserveBytes;
  assert(Number.isSafeInteger(requiredBytes), "Capacity estimate overflow");
  return { freeBytes, applicationImageBytes, reserveBytes, requiredBytes, missingBytes: Math.max(0, requiredBytes - freeBytes), permitted: freeBytes >= requiredBytes };
}
export function releasePreflight(manifest, state, history, freeBytes) {
  const report = capacityReport(manifest, state, freeBytes);
  assert(report.permitted, `Insufficient US disk: missing ${report.missingBytes} bytes; require ${report.requiredBytes} including 5 GiB reserve`);
  assert(state.restoreAccepted === true && state.accountSelectionAccepted === true && state.filesVerified === true, "US migration and restore acceptance missing");
  return { ...report, pending: verifyMigrationHistory(manifest, history) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, revision, manifestFile, stateFile, directory, historyFile] = process.argv.slice(2);
  const manifest = validateManifest(JSON.parse(readFileSync(manifestFile, "utf8")), revision);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const fs = statfsSync(directory);
  const free = fs.bavail * fs.bsize;
  assert(command === "capacity" || command === "release");
  console.log(JSON.stringify(command === "capacity" ? capacityReport(manifest, state, free) : releasePreflight(manifest, state, JSON.parse(readFileSync(historyFile, "utf8")), free)));
}
