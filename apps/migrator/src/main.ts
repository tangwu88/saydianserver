import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createConnection } from "mysql2/promise";
import { Pool } from "pg";
import { loadMigrationMap } from "./config";
import { LegacyMigrator } from "./migrator";
import { MallMigrator } from "./mall-migrator";
import { activateTakeover, checkTakeover, type TakeoverManifest } from "./takeover";

async function main(): Promise<void> {
  const rawCommand = process.argv[2];
  const supported = new Set([
    "inspect", "migrate", "verify", "mall-inspect", "mall-migrate", "mall-verify",
    "takeover-check", "takeover-activate",
  ]);
  if (!rawCommand || !supported.has(rawCommand)) {
    throw new Error("Usage: migrator <inspect|migrate|verify|mall-inspect|mall-migrate|mall-verify|takeover-check|takeover-activate> [runId]");
  }
  if (rawCommand.startsWith("takeover-")) {
    const path = process.env.MIGRATION_TAKEOVER_MANIFEST_PATH?.trim();
    if (!path) throw new Error("MIGRATION_TAKEOVER_MANIFEST_PATH is required");
    const manifest = JSON.parse(await readFile(path, "utf8")) as TakeoverManifest;
    const target = new PrismaClient();
    try {
      const report = rawCommand === "takeover-check" ? await checkTakeover(target, manifest) : await activateTakeover(target, manifest);
      const output = resolve(process.env.MIGRATION_REPORT_PATH?.trim() || `artifacts/${rawCommand}-${Date.now()}.json`);
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
      process.stdout.write(`${JSON.stringify({ command: rawCommand, output, report })}\n`);
      if (!report.ready) process.exitCode = 2;
    } finally { await target.$disconnect(); }
    return;
  }
  if (rawCommand.startsWith("mall-")) {
    await runMall(rawCommand.slice(5) as "inspect" | "migrate" | "verify");
    return;
  }
  const command = rawCommand as "inspect" | "migrate" | "verify";
  const legacyUrl = process.env.LEGACY_DATABASE_URL?.trim();
  if (!legacyUrl) throw new Error("LEGACY_DATABASE_URL is unconfigured");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  const map = await loadMigrationMap();
  const source = await createConnection(legacyUrl);
  const target = new PrismaClient();
  try {
    await source.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await source.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const migrator = new LegacyMigrator(source, target, map);
    const report =
      command === "inspect"
        ? await migrator.inspect()
        : command === "migrate"
          ? await migrator.migrate(process.argv[3])
          : await migrator.verify(process.argv[3]);
    const output = resolve(
      process.env.MIGRATION_REPORT_PATH?.trim() ||
        `artifacts/migration-${command}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(`${JSON.stringify({ command, output, report })}\n`);
  } finally {
    await source.query("ROLLBACK");
    await source.end();
    await target.$disconnect();
  }
}

async function runMall(command: "inspect" | "migrate" | "verify") {
  const sourceUrl = process.env.MALL_DATABASE_URL?.trim();
  if (!sourceUrl) throw new Error("MALL_DATABASE_URL is unconfigured");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  const source = new Pool({ connectionString: sourceUrl, max: 2 });
  const connection = await source.connect();
  const target = new PrismaClient();
  try {
    await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const migrator = new MallMigrator(connection, target);
    const report = command === "inspect"
      ? await migrator.inspect()
      : command === "migrate"
        ? await migrator.migrate()
        : await migrator.verify(process.argv[3]);
    const output = resolve(
      process.env.MIGRATION_REPORT_PATH?.trim() ||
        `artifacts/mall-migration-${command}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    process.stdout.write(`${JSON.stringify({ command: `mall-${command}`, output, report })}\n`);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    await source.end();
    await target.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Migration command failed"}\n`,
  );
  process.exitCode = 1;
});
