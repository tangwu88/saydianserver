// Disposable GitHub-hosted runner ONLY. No production URLs, data or credentials.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";

assert(
  process.env.GITHUB_ACTIONS === "true" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.NODE_ENV === "test",
  "Disposable hosted CI only",
);
const revision = process.argv[2];
assert(/^[a-f0-9]{40}$/.test(revision));
const root = resolve("."),
  scratch = mkdtempSync(join(tmpdir(), "care-privacy-smoke-"));
const pg = `saydian-ci-care-${revision.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
const docker = (args, options = {}) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 45000,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
const image = (role) => {
  const id = docker([
    "image",
    "inspect",
    "-f",
    "{{.Id}}",
    `ghcr.io/tangwu88/saydianserver-${role}:sha-${revision}`,
  ]).trim();
  assert(/^sha256:[a-f0-9]{64}$/.test(id));
  return id;
};
const api = image("api"),
  worker = image("worker");
const probe = (id, role, mounts = []) =>
  docker([
    "run",
    "--rm",
    "--user",
    "0:0",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--entrypoint",
    "node",
    "-v",
    `${root}/deploy:/release:ro`,
    ...mounts,
    id,
    "/release/scripts/care-privacy-proof.cjs",
    role,
  ]);
let created = false;
try {
  assert.equal(probe(api, "api").trim(), "care-privacy-proof:api");
  assert.equal(probe(worker, "worker").trim(), "care-privacy-proof:worker");
  // Real historical source, transpiled once as a negative control, NOT another
  // image build. A version/env claim cannot rescue an old API or old V1 mapper.
  const ts = createRequire(resolve("package.json"))("typescript");
  try {
    execFileSync(
      "git",
      ["cat-file", "-e", "0aeb6fadfd557f75f5884c0e71462e840d288433^{commit}"],
      { stdio: "ignore" },
    );
  } catch {
    execFileSync(
      "git",
      [
        "fetch",
        "--no-tags",
        "--depth=1",
        "origin",
        "0aeb6fadfd557f75f5884c0e71462e840d288433",
      ],
      { stdio: "pipe", timeout: 60000 },
    );
  }
  for (const [name, path] of [
    ["old-api", "care/care.service"],
    ["old-v1", "legacy/legacy.service"],
  ]) {
    const old = execFileSync(
      "git",
      [
        "show",
        `0aeb6fadfd557f75f5884c0e71462e840d288433:apps/api/src/${path}.ts`,
      ],
      { encoding: "utf8" },
    );
    const file = join(scratch, `${name}.js`);
    writeFileSync(
      file,
      ts.transpileModule(old, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
        },
      }).outputText,
      { mode: 0o644 },
    );
    assert.throws(
      () =>
        probe(api, "api", [
          "-e",
          "CARE_PRIVACY_COMPATIBLE=true",
          "-e",
          `APP_REVISION=${revision}`,
          "-v",
          `${file}:/workspace/apps/api/dist/${path}.js:ro`,
        ]),
      `Historical ${name} must fail the actual-image behavioral probe`,
    );
  }
  console.log(
    "Care privacy actual-image behavioral proof passed; historical API/V1 negative controls rejected.",
  );

  // This tiny owned PostgreSQL fixture tests populated CONTACT upgrade/restore,
  // partial DDL and in-flight sessions, without touching the other CI database.
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    pg,
    "--network",
    "none",
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-e",
    "POSTGRES_DB=care_privacy_test",
    "-e",
    "POSTGRES_USER=fixture",
    "postgres:16-alpine",
  ]);
  created = true;
  const sql = (input, db = "care_privacy_test") =>
    docker(
      [
        "exec",
        "-i",
        pg,
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "fixture",
        "-d",
        db,
      ],
      { input },
    ).trim();
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      ready = sql("SELECT 1;") === "1";
    } catch {}
    if (ready) break;
    await setTimeout(500);
  }
  assert(ready, "Temporary PostgreSQL did not become ready");
  sql(`CREATE TABLE "_prisma_migrations" (migration_name text PRIMARY KEY,checksum text,finished_at timestamptz,rolled_back_at timestamptz);
    CREATE TABLE fixture_member (id integer PRIMARY KEY,nickname text);
    INSERT INTO fixture_member VALUES (1,'Synthetic A'),(2,'Synthetic B'),(3,'Synthetic C');
    CREATE TABLE "CareRelationship" (id integer PRIMARY KEY,"inviterId" integer REFERENCES fixture_member(id),"recipientId" integer REFERENCES fixture_member(id),status text);
    INSERT INTO "CareRelationship" VALUES (1,1,2,'ACTIVE'),(2,2,3,'PENDING');
    CREATE TABLE "CarePermission" ("relationshipId" integer REFERENCES "CareRelationship"(id),metric text);
    INSERT INTO "CarePermission" VALUES (1,'HEART_RATE');`);
  const schema = readFileSync("deploy/scripts/care-privacy-schema.sql", "utf8");
  const snapshot = `SELECT jsonb_build_object('members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM fixture_member m),'relationships',(SELECT jsonb_agg(to_jsonb(r)-'identityDisclosure' ORDER BY id) FROM "CareRelationship" r),'permissions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY metric) FROM "CarePermission" p))::text;`;
  const before = sql(snapshot);
  assert.equal(sql(schema), "legacy");
  const migration = readFileSync(
    "apps/api/prisma/migrations/20261018070000_care_identity_disclosure/migration.sql",
    "utf8",
  );
  const hash = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    hash,
    "e089194340cb328121788dfd9b308ca72dbd87c96c5d0c82dfd9a299cfb0c2ab",
  );
  sql(migration);
  assert.equal(
    sql(schema),
    "unknown",
    "Column without completed migration is not legacy",
  );
  sql(
    `INSERT INTO "_prisma_migrations" VALUES ('20261018070000_care_identity_disclosure','${hash}',now(),NULL);`,
  );
  assert.equal(sql(schema), "protected");
  assert.equal(sql(snapshot), before);
  assert.equal(
    sql(
      `SELECT count(*) FROM "CareRelationship" WHERE "identityDisclosure"::text='CONTACT';`,
    ),
    "2",
  );
  assert.equal(
    sql(
      'BEGIN; ALTER TABLE "CareRelationship" DROP COLUMN "identityDisclosure";' +
        schema +
        " ROLLBACK;",
    ),
    "unknown",
  );
  assert.throws(() =>
    sql(
      'BEGIN; ALTER TABLE "_prisma_migrations" RENAME TO unavailable;' +
        schema +
        " ROLLBACK;",
    ),
  );
  sql(
    `INSERT INTO "CareRelationship" VALUES (3,1,3,'PENDING','MEMBER_NO_PENDING');`,
  );
  assert.equal(sql(schema), "protected");
  const dump = docker(
    [
      "exec",
      pg,
      "pg_dump",
      "-Fc",
      "--no-owner",
      "--no-privileges",
      "-U",
      "fixture",
      "-d",
      "care_privacy_test",
    ],
    { encoding: null },
  );
  sql("CREATE DATABASE care_privacy_restore;");
  docker(
    [
      "exec",
      "-i",
      pg,
      "pg_restore",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "-U",
      "fixture",
      "-d",
      "care_privacy_restore",
    ],
    { input: dump },
  );
  assert.equal(sql(schema, "care_privacy_restore"), "protected");
  assert.equal(sql(snapshot, "care_privacy_restore"), sql(snapshot));
  assert.equal(
    sql(
      `SELECT count(*) FROM "CareRelationship" WHERE "identityDisclosure"::text='MEMBER_NO_PENDING';`,
      "care_privacy_restore",
    ),
    "1",
  );
  const count =
    "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';";
  const pending = spawn(
    "docker",
    [
      "exec",
      "-e",
      "PGAPPNAME=care_privacy_fixture_inflight",
      pg,
      "psql",
      "-X",
      "-qAt",
      "-U",
      "fixture",
      "-d",
      "care_privacy_test",
      "-c",
      "SELECT pg_sleep(20);",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 40 && sql(count) === "0"; i++) await setTimeout(100);
  assert.notEqual(
    sql(count),
    "0",
    "In-flight client must prevent drain acceptance",
  );
  sql(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='care_privacy_fixture_inflight';",
  );
  await new Promise((resolve) =>
    pending.exitCode === null ? pending.once("exit", resolve) : resolve(),
  );
  assert.equal(sql(count), "0");
  console.log(
    "Care privacy PostgreSQL populated upgrade/isolated restore, partial-schema rejection and in-flight/drained-session gates passed.",
  );
} finally {
  if (created) docker(["rm", "-fv", pg]);
  rmSync(scratch, { recursive: true, force: true });
}
