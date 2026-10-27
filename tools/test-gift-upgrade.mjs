// Rehearse the pre-gift schema -> current migrations with existing synthetic orders.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const { Client } = createRequire(
  new URL("../apps/migrator/package.json", import.meta.url),
)("pg");
const root = fileURLToPath(new URL("../", import.meta.url)),
  url = new URL(process.env.DATABASE_URL || "");
assert.ok(
  ["127.0.0.1", "localhost"].includes(url.hostname),
  "Upgrade rehearsal accepts only loopback PostgreSQL",
);
const name = "saydian_gift_upgrade_test_" + randomBytes(8).toString("hex"),
  target = new URL(url);
target.pathname = "/" + name;
const control = new Client({ connectionString: url.href });
await control.connect();
const directory = await mkdtemp(join(tmpdir(), "saydian-gift-upgrade-"));
let created = false,
  db;
const migrations = join(root, "apps/api/prisma/migrations"),
  cutoff = "20261027090000_gift_redemption_channel";
const files = (await readdir(migrations))
  .filter((name) => /^\d/.test(name))
  .sort();
async function run(schema) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "--filter",
        "@saydian/app-api",
        "exec",
        "prisma",
        "migrate",
        "deploy",
        "--schema",
        schema,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: target.href,
          DOTENV_CONFIG_PATH: "/dev/null",
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Upgrade migration failed")),
    );
  });
}
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
async function snapshot(columns) {
  const result = {};
  for (const [table, names] of Object.entries(columns)) {
    const rows = (
      await db.query(
        "SELECT " + names.map(quote).join(",") + " FROM " + quote(table),
      )
    ).rows;
    const values = rows.map((row) => JSON.stringify(row)).sort();
    result[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(values)).digest("hex"),
    };
  }
  return result;
}
try {
  await control.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = new Client({ connectionString: target.href });
  await db.connect();
  await mkdir(join(directory, "migrations"));
  await copyFile(
    join(root, "apps/api/prisma/schema.prisma"),
    join(directory, "schema.prisma"),
  );
  await copyFile(
    join(migrations, "migration_lock.toml"),
    join(directory, "migrations/migration_lock.toml"),
  );
  for (const file of files.filter((file) => file < cutoff)) {
    await mkdir(join(directory, "migrations", file));
    await copyFile(
      join(migrations, file, "migration.sql"),
      join(directory, "migrations", file, "migration.sql"),
    );
  }
  await run(join(directory, "schema.prisma"));
  const user = randomUUID(),
    product = randomUUID(),
    sku = randomUUID(),
    order = randomUUID(),
    item = randomUUID(),
    payment = randomUUID();
  await db.query(
    'INSERT INTO "User" (id,nickname,"updatedAt") VALUES ($1,\'合成升级会员\',NOW())',
    [user],
  );
  await db.query(
    "INSERT INTO \"CommerceProduct\" (id,\"erpItemId\",name,gallery,tags,\"updatedAt\") VALUES ($1,$2,'原商城合成商品','{}','{}',NOW())",
    [product, "upgrade-" + product],
  );
  await db.query(
    'INSERT INTO "CommerceSku" (id,"productId","erpSkuId","erpItemId","salePriceCents",stock,"updatedAt") VALUES ($1,$2,$3,$4,12345,7,NOW())',
    [sku, product, "upgrade-" + sku, "upgrade-" + product],
  );
  await db.query(
    'INSERT INTO "CommerceOrder" (id,"orderNo","userId",status,"subtotalCents","payableCents","recipientName","recipientMobile",province,city,district,"addressDetail","idempotencyKey","paidAt","updatedAt") VALUES ($1,$2,$3,\'PAID\',12345,12345,\'原收货人\',\'13800000000\',\'广东省\',\'深圳市\',\'南山区\',\'合成升级地址\',$4,NOW(),NOW())',
    [order, "UPGRADE-" + order, user, "upgrade-" + order],
  );
  await db.query(
    'INSERT INTO "CommerceOrderItem" (id,"orderId","productId","skuId","erpSkuIdSnapshot","nameSnapshot","unitPriceCents",quantity,"totalCents") VALUES ($1,$2,$3,$4,$5,\'原商城合成商品\',12345,1,12345)',
    [item, order, product, sku, "upgrade-" + sku],
  );
  await db.query(
    'INSERT INTO "PaymentIntent" (id,"paymentNo","userId","businessType","businessId","commerceOrderId",channel,status,"amountCents",description,"idempotencyKey","updatedAt") VALUES ($1,$2,$3,\'COMMERCE_ORDER\',$4::text,$4::uuid,\'WECHAT_JSAPI\',\'SUCCEEDED\',12345,\'合成原支付\',$5,NOW())',
    [payment, "UPGRADE-" + payment, user, order, "upgrade-" + payment],
  );
  const fields = (
      await db.query(
        "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position",
      )
    ).rows,
    columns = {};
  for (const field of fields)
    (columns[field.table_name] ??= []).push(field.column_name);
  const before = await snapshot(columns),
    started = Date.now();
  await run(resolve(root, "apps/api/prisma/schema.prisma"));
  const elapsedMs = Date.now() - started,
    after = await snapshot(columns);
  assert.deepEqual(
    after,
    before,
    "Existing rows or columns changed during gift migration",
  );
  const checked = await db.query(
    'SELECT "giftCardSerial","giftDiscountCents","payableCents" FROM "CommerceOrder" WHERE id=$1',
    [order],
  );
  assert.deepEqual(checked.rows[0], {
    giftCardSerial: null,
    giftDiscountCents: 0,
    payableCents: 12345,
  });
  const constraints = await db.query(
    "SELECT count(*)::int AS count FROM pg_constraint WHERE NOT convalidated",
  );
  assert.equal(constraints.rows[0].count, 0);
  console.log(
    JSON.stringify({
      scope: "isolated-local-gift-upgrade",
      existingTablesCompared: Object.keys(columns).length,
      existingSyntheticRows: 6,
      oldOrderAndPaymentUnchanged: true,
      allConstraintsValidated: true,
      migrationCommandElapsedMs: elapsedMs,
      fromMigration: files.filter((file) => file < cutoff).at(-1),
      toMigration: files.at(-1),
    }),
  );
} finally {
  if (db) await db.end();
  if (created) await control.query(`DROP DATABASE "${name}"`);
  await control.end();
  await rm(directory, { recursive: true });
}
