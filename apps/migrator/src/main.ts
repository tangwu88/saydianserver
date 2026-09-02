import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createConnection } from "mysql2/promise";
import { loadMigrationMap } from "./config";
import { LegacyMigrator } from "./migrator";

async function main(): Promise<void> {
  const rawCommand = process.argv[2];
  if (!rawCommand || !new Set(["inspect", "migrate", "verify"]).has(rawCommand)) {
    throw new Error("Usage: migrator <inspect|migrate|verify> [runId]");
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

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Migration command failed"}\n`,
  );
  process.exitCode = 1;
});
