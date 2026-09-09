import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Inspection only: no containers, migrations, network calls or generated files.
const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
assert(args.every((arg) => arg === "--require-docker"), "Only --require-docker is supported");
const composeText = readFileSync(resolve(directory, "compose.json"), "utf8");
const compose = JSON.parse(composeText);
const nginx = readFileSync(resolve(directory, "nginx.locations.conf"), "utf8");
const example = readFileSync(resolve(directory, "env.example"), "utf8");
const keys = new Set(example.split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => line.split("=", 1)[0]));
let checks = 0;
const check = (value, message) => { assert(value, message); checks += 1; };

check(compose.name === "saydian-global", "Independent Compose project name is required");
const names = Object.keys(compose.services).sort();
check(JSON.stringify(names) === JSON.stringify(["global-api", "global-minio", "global-postgres", "global-redis", "global-worker"]), "Only the five global services are permitted");
for (const name of names) {
  const service = compose.services[name];
  check(!service.ports && !service.network_mode && !service.container_name, `${name}: no host port/network or cross-project container name`);
  check(!service.env_file, `${name}: runtime values must be explicitly mapped, not imported from domestic env`);
  for (const mount of service.volumes ?? []) {
    check(/^global_(postgres|redis|minio)_data:/.test(mount), `${name}: only project-scoped global data volumes`);
  }
}
for (const name of ["global-postgres", "global-redis", "global-minio"]) {
  check(JSON.stringify(compose.services[name].networks) === '["global_private"]', `${name}: data service must stay off the gateway/egress networks`);
}
check(compose.networks.global_private.internal === true, "Data network must be internal");
check(compose.networks.gateway.external === true, "Gateway must use an explicitly selected existing network");
check(compose.services["global-api"].networks.gateway.aliases.includes("global-api"), "Gateway upstream alias must be global-api");
check(!compose.services["global-worker"].networks.includes("gateway"), "Worker must not join gateway network");
check(Object.values(compose.volumes).every((volume) => !volume.external && !volume.name), "Volumes must remain scoped to the global Compose project");

const fixed = {
  NODE_ENV: "production", APP_REALM: "global", AUTH_ISSUER: "saydian-global-server",
  AUTH_AUDIENCE: "saydian-global-app", PUBLIC_BASE_URL: "https://app.saydian.cn/global",
  MAINTENANCE_READ_ONLY: "true", MAINTENANCE_ALLOW_MEMBER_AUTH: "false",
  BUSINESS_WRITES_PAUSED: "true", WORKER_OUTBOUND_PAUSED: "true", CALLBACK_PROCESSING_PAUSED: "true",
  LEGACY_SESSION_BRIDGE_ENABLED: "false", LEGACY_TOKEN_EXCHANGE_ENABLED: "false", ALLOW_TEST_OTP: "false",
  SMS_PROVIDER: "disabled", GLOBAL_EMAIL_PROVIDER: "disabled", GLOBAL_SMS_PROVIDER: "disabled",
  PUSH_PROVIDER: "disabled", AI_PROVIDER: "disabled", ENABLE_HEALTH_REPORT_SALES: "false",
};
for (const name of ["global-api", "global-worker"]) {
  const service = compose.services[name];
  check(JSON.stringify(service.command) === '["node","dist/main.js"]', `${name}: direct entrypoint must override automatic migration/seed CMD`);
  for (const [key, value] of Object.entries(fixed)) {
    check(service.environment[key] === value, `${name}: ${key} must be fixed to ${value}`);
  }
  check(service.environment.DATABASE_URL.includes("@global-postgres:5432/saydian_global?schema=public"), `${name}: independent global database`);
  check(service.environment.DATABASE_URL.startsWith("postgresql://global_app:"), `${name}: runtime must not use bootstrap database owner`);
  check(service.environment.REDIS_URL.includes("@global-redis:6379/0"), `${name}: independent global Redis`);
  check(service.environment.OBJECT_STORAGE_ENDPOINT === "http://global-minio:9000", `${name}: independent global object storage`);
  check(service.environment.OBJECT_STORAGE_BUCKET === "saydian-global-private", `${name}: private global bucket`);
  check(!service.environment.OBJECT_STORAGE_ACCESS_KEY.includes("MINIO_ROOT"), `${name}: runtime must not use storage administrator`);
  check(!Object.keys(service.environment).some((key) => /^(LEGACY_DATABASE_URL|MALL_DATABASE_URL|ADMIN_BOOTSTRAP_)/.test(key)), `${name}: no domestic DB or automatic administrator bootstrap`);
}
for (const [, key] of composeText.matchAll(/(?<!\$)\$\{(GLOBAL_[A-Z_]+)/g)) {
  check(keys.has(key), `env.example must document ${key}`);
}
check(!/migrate|seed|docker\.sock|\/opt\/saydianapp-server/i.test(composeText), "Compose must not run migration/seed or mount domestic deployment");
check(nginx.includes("location ^~ /global/api/") && nginx.includes("proxy_pass http://global-api:8080/api/;"), "API must strip the fixed global prefix");
check(nginx.includes("location = /global/health") && nginx.includes("proxy_pass http://global-api:8080/health/ready;"), "Global health alias must target global readiness");
check(nginx.includes("proxy_pass http://global-api:8080/health/;"), "Global health paths must strip the prefix");
check(!/proxy_pass[^;]*\$/.test(nginx), "No client-controlled upstream selection");
check(/proxy_set_header X-App-Realm "";/.test(nginx) && /proxy_set_header X-Realm "";/.test(nginx), "Untrusted realm headers must be removed");
check(/location \^~ \/global\/\s*\{\s*return 404;\s*\}/.test(nginx), "Unpublished global pages must not fall through to domestic routes");
check(!/saydianapp-api|saydianapp-admin/.test(nginx), "Global routes must not target domestic services");
console.log(`Global deployment structural checks passed (${checks}). No runtime operations performed.`);

const docker = spawnSync("docker", ["compose", "version", "--short"], { encoding: "utf8", timeout: 10_000 });
if (docker.error || docker.status !== 0) {
  if (args.includes("--require-docker")) throw new Error("Docker Compose v2 is unavailable; configuration parsing cannot be verified");
  console.log("Docker Compose is unavailable: native compose config and nginx runtime checks remain unverified.");
} else {
  const config = spawnSync("docker", ["compose", "--env-file", resolve(directory, "env.example"), "-f", resolve(directory, "compose.json"), "config", "--quiet"], { encoding: "utf8", timeout: 30_000 });
  assert(!config.error && config.status === 0, "docker compose config --quiet failed; inspect configuration locally without printing real secrets");
  console.log("Docker Compose parsed the template successfully. No image pull, service start or deployment performed.");
}
