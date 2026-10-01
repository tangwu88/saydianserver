import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function missingSettings(source, target) {
  const current = new Map(target.map(row => [row.key, row]));
  const allowed = new Set(["app_update", "support"]);
  const retained = [], inserted = [];
  for (const row of source) {
    assert(allowed.has(row.key) && typeof row.public === "boolean", "Only public download/support configuration may be imported");
    if (current.has(row.key)) retained.push({ key: row.key, source: row, retained: current.get(row.key) });
    else inserted.push(row);
  }
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const statements = inserted.map(row => `INSERT INTO "AppSetting" (key,value,public,"updatedAt") VALUES (${quote(row.key)},${quote(JSON.stringify(row.value))}::jsonb,${row.public},${quote(row.updatedAt)}::timestamp) ON CONFLICT (key) DO NOTHING;`);
  return { sql: ["BEGIN;", ...statements, "COMMIT;"].join("\n") + "\n", audit: { inserted: inserted.map(row => row.key), retained } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, target, output] = process.argv.slice(2);
  const result = missingSettings(JSON.parse(readFileSync(source, "utf8")), JSON.parse(readFileSync(target, "utf8")));
  writeFileSync(output + ".sql", result.sql, { flag: "wx", mode: 0o600 });
  writeFileSync(output + ".audit.json", JSON.stringify(result.audit, null, 2), { flag: "wx", mode: 0o600 });
}
