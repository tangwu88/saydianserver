// Explicitly opt-in, loopback-only backup restoration rehearsal. No production use.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { resolve, isAbsolute, join } from "node:path";
import { stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const apiRequire = createRequire(new URL("../apps/api/package.json", import.meta.url));
assert.equal(process.env.RUN_LOCAL_RESTORE_TEST, "1", "Set RUN_LOCAL_RESTORE_TEST=1 only for a disposable local rehearsal");
apiRequire("dotenv").config({ path: new URL("../apps/api/.env", import.meta.url), quiet: true });
const { Client } = createRequire(new URL("../apps/migrator/package.json", import.meta.url))("pg");
let url;
try { url = new URL(process.env.DATABASE_URL ?? ""); }
catch { throw new Error("Invalid local database URL; connection details withheld"); }
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Non-local database refused");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "Expected a PostgreSQL URL");
const backup = process.argv[2];
assert.ok(backup && isAbsolute(backup), "Supply the exact absolute pg_dump archive path");
assert.ok((await stat(backup)).isFile(), "Archive must be a regular file");
const binaryDirectory = process.env.PG_BIN_DIR;
assert.ok(binaryDirectory && isAbsolute(binaryDirectory), "Supply the absolute trusted PostgreSQL binary directory");
const binary = join(binaryDirectory, process.platform === "win32" ? "pg_restore.exe" : "pg_restore");
await stat(binary);
const database = `saydian_restore_test_${randomBytes(10).toString("hex")}`;
assert.match(database, /^saydian_restore_test_[a-f0-9]{20}$/);
const control = new Client({ connectionString: url.toString() });
let created = false;
let restored;
let report;
await control.connect();
try {
  // A fresh random database is the only mutation target, never the running database.
  assert.equal((await control.query("SELECT 1 FROM pg_database WHERE datname = $1", [database])).rowCount, 0);
  await control.query(`CREATE DATABASE "${database}"`);
  created = true;
  const startedAt = Date.now();
  const child = spawnSync(binary, ["--host", url.hostname, "--port", url.port || "5432", "--username", decodeURIComponent(url.username),
    "--dbname", database, "--no-owner", "--no-privileges", "--exit-on-error", resolve(backup)], {
    encoding: "utf8", windowsHide: true, timeout: 120_000,
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  });
  if (child.error || child.status !== 0) throw new Error(`Restore failed (${child.status ?? "not started"}); no production target was touched`);
  const restoredUrl = new URL(url);
  restoredUrl.pathname = `/${database}`;
  restored = new Client({ connectionString: restoredUrl.toString() });
  await restored.connect();
  const tableCount = Number((await restored.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows[0].count);
  assert.ok(tableCount >= 40, "Expected application tables are missing");
  const invalidConstraints = Number((await restored.query("SELECT count(*) FROM pg_constraint WHERE NOT convalidated")).rows[0].count);
  assert.equal(invalidConstraints, 0, "Restored constraints are not validated");
  const counts = {};
  for (const table of ["User", "HealthRecord", "CommerceOrder", "PaymentIntent", "PaymentRefund", "_prisma_migrations"]) {
    counts[table] = Number((await restored.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
  }
  report = { scope: "local-backup-restore-only-not-production-cutover", tableCount, invalidConstraints, counts, elapsedMs: Date.now() - startedAt };
} finally {
  try {
    if (restored) await restored.end();
    // Exact fresh name, no FORCE, no broad termination: unexpected users keep the database intact.
    if (created) await control.query(`DROP DATABASE "${database}"`);
  } finally { await control.end(); }
}
console.log(JSON.stringify({ ...report, temporaryDatabaseRemoved: true }, null, 2));
