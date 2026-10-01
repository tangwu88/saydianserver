import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyCutoverData(before, after) {
  const rows = new Map(after.filter(row => row.table).map(row => [row.table, row]));
  const receipts = new Set(after.filter(row => row.providerEventId).map(row => row.providerEventId));
  for (const row of before) if (row.providerEventId) assert(receipts.has(row.providerEventId), "Existing callback receipt missing");
  // Only these intentionally change: reviewed migration history, imported
  // settings, durable payment callbacks, and admin login sessions during freeze.
  const permitted = new Set(["_prisma_migrations", "AppSetting", "ProviderEvent", "AdminSession", "AuditLog"]);
  assert(before.length > 40 && after.length >= before.length, "Incomplete database fingerprint");
  for (const row of before) {
    if (!row.table) continue;
    const actual = rows.get(row.table);
    assert(actual, `Missing table ${row.table}`);
    if (!permitted.has(row.table)) assert.deepEqual(actual, row, `Unexpected cutover data change: ${row.table}`);
    if (row.table === "ProviderEvent") assert(actual.count >= row.count, "Callback receipts were lost");
  }
  assert(after.some(row => row.invalidConstraints === 0), "Invalid restored relationships");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const read = file => readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
  verifyCutoverData(read(process.argv[2]), read(process.argv[3]));
  console.log("Unchanged member identities, credentials, business records, permissions and provider settings verified.");
}
