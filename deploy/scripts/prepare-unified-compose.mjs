import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateComposeSources(files, runtime, readJson) {
  const paths = files.split(",");
  if (/^\/opt\/saydian-global\/releases\/[a-f0-9]{40}\/deploy\/global\/compose\.json$/.test(paths[0])) {
    assert(paths.length === 1 || paths.length === 2 && paths[1] === "/opt/saydian-global/private/payment-live.override.json", "Unexpected original Compose override");
    return;
  }
  // A pre-write rollback pins the old services to these private snapshots.
  // Accept only that exact pair, with restore evidence and the running image.
  const match = paths[0].match(/^(\/opt\/saydianapp-server\/deploy\/unified\/backups\/\d{8}T\d{6}Z-[a-f0-9]{12}-\d+)\/global-live\.json$/);
  assert(match && paths.length === 2 && paths[1] === `${match[1]}/images.json`, "Unexpected rollback Compose sources");
  assert(readJson(`${match[1]}/cutover-global/restore-accepted.json`).verified === true, "Rollback restore evidence missing");
  assert(readJson(paths[1]).services?.["global-api"]?.image === runtime, "Rollback snapshot differs from the running image");
}

// Input is a root-only `docker compose config --format json` snapshot of the
// running global stack, including its private overrides. Never print this data.
export function prepareUnifiedCompose(input) {
  const config = structuredClone(input);
  assert(config.name === "saydian-global", "Unexpected existing project");
  const api = config.services?.["global-api"], worker = config.services?.["global-worker"], admin = config.services?.["global-admin"];
  assert(api && worker && admin, "Running application services missing");
  const database = new URL(api.environment.DATABASE_URL);
  assert(database.hostname === "global-postgres" && database.pathname === "/saydian_global", "Must retain existing member database");
  assert(worker.environment.DATABASE_URL === api.environment.DATABASE_URL, "Worker database differs");
  for (const key of ["ACCESS_TOKEN_SECRET", "REFRESH_TOKEN_PEPPER", "FIELD_ENCRYPTION_KEY", "INTEGRATION_MASTER_KEY"]) assert(api.environment[key], `Missing retained ${key}`);
  for (const service of [api, worker]) {
    delete service.environment.APP_REALM;
    service.environment.PUBLIC_BASE_URL = "https://app.saydian.cn";
    service.command = ["node", "dist/main.js"];
    delete service.build;
  }
  assert(api.environment.AUTH_ISSUER === "saydian-global-server" && api.environment.AUTH_AUDIENCE === "saydian-global-app", "Existing session claims must be retained");
  api.networks.gateway.aliases = [...new Set([...(api.networks.gateway.aliases ?? []), "unified-api"])];
  admin.volumes ??= [];
  const downloadTarget = "/usr/share/nginx/html/down/files";
  assert(!admin.volumes.some(volume => volume.target === downloadTarget), "Review existing download mount before merging");
  admin.volumes.push({ type: "bind", source: "/opt/saydianapp-server/deploy/downloads", target: downloadTarget, read_only: true, bind: { create_host_path: false } });
  delete admin.build;
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === "validate-sources") {
    validateComposeSources(process.argv[3], process.argv[4], file => JSON.parse(readFileSync(file.replace("/opt/saydianapp-server/deploy/unified", "/state"), "utf8")));
    process.exit(0);
  }
  const [input, output] = process.argv.slice(2);
  assert(input && output && input !== output);
  writeFileSync(output, JSON.stringify(prepareUnifiedCompose(JSON.parse(readFileSync(input, "utf8"))), null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
