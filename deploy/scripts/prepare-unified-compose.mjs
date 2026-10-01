import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  const [input, output] = process.argv.slice(2);
  assert(input && output && input !== output);
  writeFileSync(output, JSON.stringify(prepareUnifiedCompose(JSON.parse(readFileSync(input, "utf8"))), null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
