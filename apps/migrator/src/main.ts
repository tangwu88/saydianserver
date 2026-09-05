import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createConnection } from "mysql2/promise";
import { Pool } from "pg";
import { loadMigrationMap } from "./config";
import { LegacyMigrator } from "./migrator";
import { MallMigrator } from "./mall-migrator";

async function main(): Promise<void> {
  const rawCommand = process.argv[2];
  const supported = new Set([
    "inspect", "migrate", "verify", "mall-inspect", "mall-migrate", "mall-verify",
  ]);
  if (!rawCommand || !supported.has(rawCommand)) {
    throw new Error("Usage: migrator <inspect|migrate|verify|mall-inspect|mall-migrate|mall-verify> [runId]");
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
    const migrator = new LegacyMigrator(source, target, map);
    const report =
      command === "inspect"
        ? await migrator.inspect()
        : command === "migrate"
          ? await migrator.migrate()
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
    await source.end();
    await target.$disconnect();
  }
}

async function runMall(command: "inspect" | "migrate" | "verify") {
  const sourceUrl = process.env.MALL_DATABASE_URL?.trim();
  if (!sourceUrl) throw new Error("MALL_DATABASE_URL is unconfigured");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  const source = new Pool({ connectionString: sourceUrl, max: 2 });
  const target = new PrismaClient();
  try {
    const migrator = new MallMigrator(source, target);
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
