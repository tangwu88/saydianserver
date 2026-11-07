// Existing synthetic health data -> additive schema -> dump/restore consistency.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readdir, copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)),
  { Client } = createRequire(join(root, "apps/migrator/package.json"))("pg");
const url = new URL(process.env.DATABASE_URL || "");
assert(
  ["localhost", "127.0.0.1"].includes(url.hostname),
  "Loopback DB required",
);
const suffix = randomBytes(6).toString("hex"),
  name = "health_screen_upgrade_" + suffix,
  restore = "health_screen_restore_" + suffix,
  folder = join(tmpdir(), name),
  cutoff = "20261107090000_member_health_screen";
const control = new Client({ connectionString: url.href });
await control.connect();
let db, restored;
const target = new URL(url);
target.pathname = "/" + name;
const restoreUrl = new URL(url);
restoreUrl.pathname = "/" + restore;
const run = (cmd, args, env = {}) =>
  new Promise((done, reject) => {
    const p = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...env, DOTENV_CONFIG_PATH: "/dev/null" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (out += c));
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? done(out) : reject(Error(out))));
  });
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
async function snapshot(client, tables) {
  const result = {};
  for (const table of tables) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(t) - 'memberHealthAnalysisId' - 'screenName' AS row FROM ${quote(table)} t`,
      )
    ).rows
      .map((r) => JSON.stringify(r.row))
      .sort();
    result[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
}
try {
  await control.query(`CREATE DATABASE ${quote(name)}`);
  db = new Client({ connectionString: target.href });
  await db.connect();
  await mkdir(join(folder, "migrations"), { recursive: true });
  const migrations = join(root, "apps/api/prisma/migrations");
  await copyFile(
    join(root, "apps/api/prisma/schema.prisma"),
    join(folder, "schema.prisma"),
  );
  await copyFile(
    join(migrations, "migration_lock.toml"),
    join(folder, "migrations/migration_lock.toml"),
  );
  for (const m of (await readdir(migrations))
    .filter((x) => /^\d/.test(x) && x < cutoff)
    .sort()) {
    await mkdir(join(folder, "migrations", m));
    await copyFile(
      join(migrations, m, "migration.sql"),
      join(folder, "migrations", m, "migration.sql"),
    );
  }
  await run(
    "pnpm",
    [
      "--filter",
      "@saydian/app-api",
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      join(folder, "schema.prisma"),
    ],
    { DATABASE_URL: target.href },
  );
  const user = randomUUID(),
    record = randomUUID(),
    credit = randomUUID();
  await db.query(
    'INSERT INTO "User" (id,nickname,"updatedAt") VALUES ($1,$2,NOW())',
    [user, "HEALTH_UPGRADE_SYNTHETIC"],
  );
  await db.query(
    'INSERT INTO "HealthRecord" (id,"userId","clientRecordId",metric,"observedAt","timezoneOffsetMinutes",values,quality,"sourcePlatform","updatedAt") VALUES ($1,$2,$3,\'HEART_RATE\',NOW(),480,$4,\'UNKNOWN\',\'qa\',NOW())',
    [record, user, record, { bpm: 72 }],
  );
  await db.query(
    'INSERT INTO "ReportCreditLedger" (id,"userId",type,delta,"balanceAfter","sourceType","sourceId","idempotencyKey") VALUES ($1,$2,\'ADMIN_ADJUSTMENT\',2,2,\'qa\',$3,$3)',
    [credit, user, credit],
  );
  await db.query('INSERT INTO "HealthProfile" (id,"userId","updatedAt") VALUES ($1,$2,NOW())',[randomUUID(),user]);
  const tables = (
      await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename),
    before = await snapshot(db, tables);
  const sql = (
    await Promise.all(
      [cutoff, "20261107120000_member_health_references"].map((m) =>
        readFile(join(migrations, m, "migration.sql"), "utf8"),
      ),
    )
  ).join("\n");
  assert(
    !/DROP\s|TRUNCATE\s|DELETE\s+FROM|UPDATE\s+"/i.test(sql),
    "Only additive SQL permitted",
  );
  await db.query("BEGIN");
  await db.query(sql);
  await db.query("COMMIT");
  assert.deepEqual(await snapshot(db, tables), before);
  assert.equal(
    (
      await db.query(
        'SELECT COUNT(*)::int AS n FROM "ReportCreditLedger" WHERE "memberHealthAnalysisId" IS NULL',
      )
    ).rows[0].n,
    1,
  );
  const referenceId = randomUUID();
  await db.query(
    'INSERT INTO "MemberHealthReference" (id,"userId",metric,"observedAt",unit,values,method,context,"actorType","actorId","requestKey","inputDigest","updatedAt") VALUES ($1,$2,\'BLOOD_GLUCOSE\',NOW(),\'mmol/L\',$3,\'GLUCOSE_METER\',\'FASTING\',\'ADMIN\',$4,$5,\'synthetic\',NOW())',
    [referenceId, user, { value: 5.8 }, randomUUID(), randomUUID()],
  );
  const legacyReference = await snapshot(db, ["MemberHealthReference"]);
  await db.query(
    await readFile(
      join(
        migrations,
        "20261107150000_reference_metabolic_metrics/migration.sql",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    await snapshot(db, ["MemberHealthReference"]),
    legacyReference,
  );
  assert.deepEqual(await snapshot(db, tables), before);
  for (const [metric, unit, values] of [
    ["URIC_ACID", "μmol/L", { value: 360 }],
    ["BLOOD_LIPIDS", "mmol/L", { totalCholesterol: 4.5, hdl: 1.3 }],
  ]) {
    await db.query(
      'INSERT INTO "MemberHealthReference" (id,"userId",metric,"observedAt",unit,values,method,context,"actorType","actorId","requestKey","inputDigest","updatedAt") VALUES ($1,$2,$3,NOW(),$4,$5,\'LAB_REPORT\',\'FASTING\',\'ADMIN\',$6,$7,\'synthetic\',NOW())',
      [randomUUID(), user, metric, unit, values, randomUUID(), randomUUID()],
    );
  }
  const accessMigration = await readFile(join(migrations,"20261107190000_health_screen_member_access","migration.sql"),"utf8");
  assert(!/DROP\s|TRUNCATE\s|DELETE\s+FROM|UPDATE\s+"/i.test(accessMigration));
  await db.query(accessMigration);
  assert.equal((await db.query('SELECT "screenName" FROM "HealthProfile" WHERE "userId"=$1',[user])).rows[0].screenName,null);
  await db.query('INSERT INTO "HealthScreenLogin" ("scanHash","pollHash","expiresAt") VALUES ($1,$2,NOW())',["synthetic-scan","synthetic-poll"]);
  const referenceBefore = await snapshot(db, ["MemberHealthReference"]);
  const dump = process.env.PG_DUMP_BIN,
    restoreBin = process.env.PG_RESTORE_BIN;
  assert(
    dump && restoreBin,
    "Explicit pg_dump and pg_restore binaries required",
  );
  const backup = join(folder, "backup.dump");
  await run(dump, [
    "--format=custom",
    "--no-owner",
    "--file",
    backup,
    target.href,
  ]);
  await control.query(`CREATE DATABASE ${quote(restore)}`);
  await run(restoreBin, [
    "--exit-on-error",
    "--no-owner",
    "--dbname",
    restoreUrl.href,
    backup,
  ]);
  restored = new Client({ connectionString: restoreUrl.href });
  await restored.connect();
  assert.deepEqual(await snapshot(restored, tables), before);
  assert.equal((await restored.query('SELECT "screenName" FROM "HealthProfile" WHERE "userId"=$1',[user])).rows[0].screenName,null);
  assert.equal((await restored.query('SELECT COUNT(*)::int AS count FROM "HealthScreenLogin" WHERE "scanHash"=$1',["synthetic-scan"])).rows[0].count,1);
  assert.deepEqual(
    await snapshot(restored, ["MemberHealthReference"]),
    referenceBefore,
  );
  assert.equal(
    (
      await restored.query(
        'SELECT COUNT(*)::int AS n FROM "MemberHealthAnalysis"',
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await restored.query(
        'SELECT COUNT(*)::int AS n FROM "HealthScoreRuleVersion"',
      )
    ).rows[0].n,
    0,
  );
  console.log(
    JSON.stringify({
      upgrade: "passed",
      backupRestore: "passed",
      existingTablesPreserved: tables.length,
      oldHealthRecordsPreserved: 1,
      oldCreditsPreserved: 1,
      newAnalysisAndRulesEmpty: true,
      manualReferencesRestored: referenceBefore.MemberHealthReference.count,
    }),
  );
} finally {
  await db?.end();
  await restored?.end();
  for (const n of [name, restore])
    await control.query(`DROP DATABASE IF EXISTS ${quote(n)}`);
  await control.end();
  await rm(folder, { recursive: true, force: true });
}
