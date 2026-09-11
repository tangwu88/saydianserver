// Opt-in for phone-entry testing after real WeChat authorization. No SMS is sent.
// Only this switch is changed; secrets and all other production gates are preserved.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync, chmodSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export function withPhoneTestSwitch(source, enabled) {
  assert(typeof enabled === "boolean", "An explicit boolean is required");
  const matches = source.match(/^GLOBAL_WECHAT_PHONE_TEST_ENABLED=.*$/gm) ?? [];
  assert(matches.length <= 1 && matches.every(line => /^GLOBAL_WECHAT_PHONE_TEST_ENABLED=(true|false)\r?$/.test(line)), "Unexpected phone-test switch; review privately");
  if (enabled) assert(/^GLOBAL_WECHAT_H5_ENABLED=true\r?$/m.test(source), "Real WeChat H5 authorization must already be enabled");
  const line = `GLOBAL_WECHAT_PHONE_TEST_ENABLED=${enabled}`;
  return matches.length ? source.replace(/^GLOBAL_WECHAT_PHONE_TEST_ENABLED=.*$/m, line)
    : source + (source.endsWith("\n") ? "" : "\n") + line + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4 && process.argv[2] === "/target/global.env" && ["--enable", "--disable"].includes(process.argv[3]), "Mount only the global private directory at /target and choose --enable/--disable");
  const path = process.argv[2];
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, "Private env must be a restricted regular file");
  const source = readFileSync(path, "utf8");
  const updated = withPhoneTestSwitch(source, process.argv[3] === "--enable");
  if (updated === source) console.log("Phone-test switch already has the requested value; no change.");
  else {
    const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const backup = `${path}.before-phone-test-${digest}`;
    copyFileSync(path, backup, 1);
    chmodSync(backup, 0o600);
    writeFileSync(path, updated, { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log("Only GLOBAL_WECHAT_PHONE_TEST_ENABLED was changed. Restricted recovery copy retained. Recreate the global API to apply.");
  }
}
