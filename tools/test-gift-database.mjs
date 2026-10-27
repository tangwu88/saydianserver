// Each run owns a new random loopback database; existing databases are never cleared.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const { Client } = createRequire(
  new URL("../apps/migrator/package.json", import.meta.url),
)("pg");
const root = fileURLToPath(new URL("../", import.meta.url)),
  url = new URL(process.env.DATABASE_URL || "");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname),
  "Only a loopback PostgreSQL control database is allowed",
);
const database = "saydian_gift_test_" + randomBytes(8).toString("hex"),
  control = new Client({ connectionString: url.href });
await control.connect();
let created = false;
async function run(args) {
  await new Promise((resolve, reject) => {
    const target = new URL(url);
    target.pathname = "/" + database;
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      args,
      {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: target.href,
          RUN_GIFT_DATABASE_TESTS: "1",
          RUN_LOCAL_DATABASE_TESTS: "0",
          DOTENV_CONFIG_PATH: "/dev/null",
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Gift database check failed")),
    );
  });
}
try {
  await control.query(`CREATE DATABASE "${database}"`);
  created = true;
  // Exercise timestamp-without-time-zone comparisons outside the usual CI UTC zone.
  await control.query(
    `ALTER DATABASE "${database}" SET TimeZone TO 'Asia/Shanghai'`,
  );
  await run([
    "--filter",
    "@saydian/app-api",
    "exec",
    "prisma",
    "migrate",
    "deploy",
  ]);
  await run([
    "--filter",
    "@saydian/app-api",
    "exec",
    "vitest",
    "run",
    "src/gifts/gift-database.test.ts",
    "--maxWorkers=1",
    "--testTimeout=30000",
  ]);
} finally {
  if (created) await control.query(`DROP DATABASE "${database}"`);
  await control.end();
}
console.log(
  JSON.stringify({
    scope: "isolated-gift-database-tests",
    temporaryDatabaseRemoved: true,
  }),
);
