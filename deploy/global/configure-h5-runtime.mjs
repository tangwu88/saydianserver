// Changes only the opt-in H5 switch in the independent private environment.
// No secrets are printed; does not start/reload services or change other gates.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync, chmodSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export function withH5Switch(source, enabled) {
  assert(typeof enabled === "boolean", "An explicit boolean is required");
  const matches = source.match(/^GLOBAL_WECHAT_H5_ENABLED=.*$/gm) ?? [];
  assert(matches.length <= 1 && matches.every(line => /^GLOBAL_WECHAT_H5_ENABLED=(true|false)\r?$/.test(line)), "Unexpected H5 switch; review privately");
  const line = `GLOBAL_WECHAT_H5_ENABLED=${enabled}`;
  return matches.length ? source.replace(/^GLOBAL_WECHAT_H5_ENABLED=.*$/m, line)
    : source + (source.endsWith("\n") ? "" : "\n") + line + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4 && process.argv[2] === "/target/global.env" && ["--enable", "--disable"].includes(process.argv[3]), "Mount only the global private directory at /target and choose --enable/--disable");
  const path = process.argv[2];
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, "Private env must be a restricted regular file");
  const source = readFileSync(path, "utf8");
  const updated = withH5Switch(source, process.argv[3] === "--enable");
  if (updated === source) console.log("H5 runtime switch already has the requested value; no change.");
  else {
    const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const backup = `${path}.before-h5-${digest}`;
    copyFileSync(path, backup, 1);
    chmodSync(backup, 0o600);
    writeFileSync(path, updated, { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log("Only GLOBAL_WECHAT_H5_ENABLED was changed. Restricted recovery copy retained. Apply via the global release workflow.");
  }
}
