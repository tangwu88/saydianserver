// Explicit one-time gateway addition. Does not reload Nginx, alter other routes,
// touch credentials, start services or select a deployment revision.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync, chmodSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export function withGlobalH5Route(source) {
  const marker = "# global-h5 static route v1";
  const block = `${marker}
location = /global/saidian-mall {
    return 308 /global/saidian-mall/;
}

location ^~ /global/saidian-mall/ {
    access_log off;
    proxy_pass http://global-admin:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    # Referrer-Policy is supplied by the static upstream. Do not add_header
    # here: doing so would suppress inherited gateway security headers.
}

`;
  if (source.includes(marker)) {
    assert(source.split(block).length === 2, "Installed H5 route differs; review before making changes");
    return source;
  }
  assert(!/location[^\n]*\/global\/saidian-mall/.test(source), "An H5 route already exists; review it manually");
  const anchor = "location = /global {";
  assert(source.split(anchor).length === 2, "Expected exactly one global deny route");
  assert(source.includes("proxy_pass http://global-api:8080/api/;"), "Independent global API route is missing");
  assert(source.includes("proxy_pass http://global-admin:8080;"), "Existing international static admin upstream is missing");
  assert(source.includes("server_name app.saydian.cn;"), "Expected domain is missing");
  return source.replace(anchor, block + anchor);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4 && process.argv[2] === "/target/gateway-nginx.conf" && ["--check", "--apply"].includes(process.argv[3]),
    "Mount only the approved gateway config directory at /target; pass its exact filename and --check/--apply");
  const path = process.argv[2];
  const source = readFileSync(path, "utf8");
  const updated = withGlobalH5Route(source);
  if (source === updated) console.log("Independent global H5 route already installed; no change.");
  else if (process.argv[3] === "--check") console.log("Gateway shape verified: one independent global H5 route can be added.");
  else {
    const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const backup = `${path}.before-global-h5-${digest}`;
    copyFileSync(path, backup, 1); // Exclusive backup: never overwrite a previous restore point.
    chmodSync(backup, statSync(path).mode & 0o777);
    // Preserve the bind-mounted inode. Caller must nginx -t, then reload; restore
    // the named backup in place if validation fails.
    writeFileSync(path, updated);
    console.log(`Added only the international H5 route. Backup: ${backup}. Validate Nginx before reloading.`);
  }
}
