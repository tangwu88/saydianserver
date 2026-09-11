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
const adminNginx = readFileSync(resolve(directory, "admin-nginx.conf"), "utf8");
const adminDockerfile = readFileSync(resolve(directory, "admin.Dockerfile"), "utf8");
const example = readFileSync(resolve(directory, "env.example"), "utf8");
const keys = new Set(example.split(/\r?\n/).filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line)).map((line) => line.split("=", 1)[0]));
let checks = 0;
const check = (value, message) => { assert(value, message); checks += 1; };

check(compose.name === "saydian-global", "Independent Compose project name is required");
const names = Object.keys(compose.services).sort();
check(JSON.stringify(names) === JSON.stringify(["global-admin", "global-api", "global-minio", "global-postgres", "global-redis", "global-worker"]), "Only the six global services are permitted");
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
check(compose.services["global-api"].environment.GLOBAL_WECHAT_H5_ENABLED === "${GLOBAL_WECHAT_H5_ENABLED:-false}", "Official-account H5 login must require an explicit independent switch");
check(!compose.services["global-worker"].environment.GLOBAL_WECHAT_H5_ENABLED, "H5 auth must not enable Worker outbound processing");
check(compose.services["global-api"].environment.GLOBAL_WECHAT_PHONE_TEST_ENABLED === "${GLOBAL_WECHAT_PHONE_TEST_ENABLED-true}", "This authorized temporary H5 release must preserve explicit private false and empty overrides");
check(!compose.services["global-worker"].environment.GLOBAL_WECHAT_PHONE_TEST_ENABLED, "Temporary H5 phone entry must not affect Worker");
check(compose.services["global-api"].environment.HEALTH_REPORT_WORKER_ENABLED === "${GLOBAL_HEALTH_REPORT_WORKER_ENABLED-true}", "Admin report readiness must use the independently controlled health worker switch");
check(compose.services["global-worker"].environment.HEALTH_REPORT_WORKER_ENABLED === "${GLOBAL_HEALTH_REPORT_WORKER_ENABLED-true}", "Health reports must have a narrow outbound release switch");
check(compose.services["global-worker"].environment.JUSHUITAN_OUTBOUND_ENABLED === "${GLOBAL_JUSHUITAN_OUTBOUND_ENABLED-true}", "Jushuitan must have a narrow outbound release switch");
check(!compose.services["global-api"].environment.JUSHUITAN_OUTBOUND_ENABLED, "Jushuitan outbound execution belongs only to Worker");
check(/GLOBAL_HEALTH_REPORT_WORKER_ENABLED=false/.test(example) && /GLOBAL_JUSHUITAN_OUTBOUND_ENABLED=false/.test(example), "Fresh deployment examples must keep narrow outbound releases disabled");
const admin = compose.services["global-admin"];
check(admin.image === "ghcr.io/tangwu88/saydianserver-global-admin:${GLOBAL_IMAGE_TAG:?Set a verified full commit SHA}", "Admin must use its independent immutable release image");
check(JSON.stringify(admin.networks) === '{"gateway":{"aliases":["global-admin"]}}', "Admin must only join the gateway network with its own alias");
check(JSON.stringify(admin.expose) === '["8080"]', "Admin only exposes its unprivileged HTTP port to Docker peers");
check(!admin.environment && !admin.secrets && !admin.configs && !admin.volumes, "Static admin must not receive secrets, runtime configuration or data mounts");
check(admin.read_only === true && JSON.stringify(admin.tmpfs) === '["/tmp"]', "Static admin filesystem must be read-only except temporary Nginx state");
check(admin.security_opt?.includes("no-new-privileges:true"), "Static admin must forbid privilege escalation");
check(JSON.stringify(admin.healthcheck?.test) === '["CMD","wget","-qO-","http://127.0.0.1:8080/admin/index.html"]', "Admin health check must verify the built frontend is present");
check(Object.values(compose.volumes).every((volume) => !volume.external && !volume.name), "Volumes must remain scoped to the global Compose project");

const fixed = {
  NODE_ENV: "production", APP_REALM: "global", AUTH_ISSUER: "saydian-global-server",
  AUTH_AUDIENCE: "saydian-global-app", PUBLIC_BASE_URL: "https://app.saydian.cn/global",
  MAINTENANCE_ALLOW_MEMBER_AUTH: "false",
  WORKER_OUTBOUND_PAUSED: "true", CALLBACK_PROCESSING_PAUSED: "true",
  LEGACY_SESSION_BRIDGE_ENABLED: "false", LEGACY_TOKEN_EXCHANGE_ENABLED: "false", ALLOW_TEST_OTP: "false",
  SMS_PROVIDER: "disabled", GLOBAL_EMAIL_PROVIDER: "disabled", GLOBAL_SMS_PROVIDER: "disabled",
  PUSH_PROVIDER: "disabled", AI_PROVIDER: "disabled", ENABLE_HEALTH_REPORT_SALES: "false",
};
const controlledQaSwitches = {
  MAINTENANCE_READ_ONLY: "${GLOBAL_MAINTENANCE_READ_ONLY:-true}",
  BUSINESS_WRITES_PAUSED: "${GLOBAL_BUSINESS_WRITES_PAUSED:-true}",
  GLOBAL_UNVERIFIED_REGISTRATION_ENABLED: "${GLOBAL_UNVERIFIED_REGISTRATION_ENABLED:-false}",
};
const resourceLimits = {
  "global-postgres": { mem_limit: "384m", cpus: 0.5, pids_limit: 150 },
  "global-redis": { mem_limit: "96m", cpus: 0.25, pids_limit: 100 },
  "global-minio": { mem_limit: "256m", cpus: 0.5, pids_limit: 150 },
  "global-api": { mem_limit: "384m", cpus: 0.75, pids_limit: 200 },
  "global-admin": { mem_limit: "64m", cpus: 0.25, pids_limit: 50 },
  "global-worker": { mem_limit: "256m", cpus: 0.5, pids_limit: 150 },
};
for (const name of ["global-api", "global-worker"]) {
  const service = compose.services[name];
  check(JSON.stringify(service.command) === '["node","dist/main.js"]', `${name}: direct entrypoint must override automatic migration/seed CMD`);
  for (const [key, value] of Object.entries(fixed)) {
    check(service.environment[key] === value, `${name}: ${key} must be fixed to ${value}`);
  }
  for (const [key, value] of Object.entries(controlledQaSwitches)) {
    check(service.environment[key] === value, `${name}: ${key} must retain its safe default and require an explicit private-env override`);
  }
  check(service.environment.APP_REVISION === "${GLOBAL_APP_REVISION:?Set the verified full global source commit SHA}", `${name}: runtime revision must be independent from the registry tag`);
  check(service.environment.DATABASE_URL.includes("@global-postgres:5432/saydian_global?schema=public"), `${name}: independent global database`);
  check(service.environment.DATABASE_URL.startsWith("postgresql://global_app:"), `${name}: runtime must not use bootstrap database owner`);
  check(service.environment.REDIS_URL.includes("@global-redis:6379/0"), `${name}: independent global Redis`);
  check(service.environment.OBJECT_STORAGE_ENDPOINT === "http://global-minio:9000", `${name}: independent global object storage`);
  check(service.environment.OBJECT_STORAGE_BUCKET === "saydian-global-private", `${name}: private global bucket`);
  check(!service.environment.OBJECT_STORAGE_ACCESS_KEY.includes("MINIO_ROOT"), `${name}: runtime must not use storage administrator`);
  check(!Object.keys(service.environment).some((key) => /^(LEGACY_DATABASE_URL|MALL_DATABASE_URL|ADMIN_BOOTSTRAP_)/.test(key)), `${name}: no domestic DB or automatic administrator bootstrap`);
}
for (const [name, expected] of Object.entries(resourceLimits)) {
  const service = compose.services[name];
  for (const [key, value] of Object.entries(expected)) {
    check(service[key] === value, `${name}: ${key} must stay within the reviewed host budget`);
  }
  check(service.logging?.driver === "json-file" && service.logging?.options?.["max-size"] === "10m" && service.logging?.options?.["max-file"] === "3", `${name}: bounded container logs are required`);
}
for (const [, key] of composeText.matchAll(/(?<!\$)\$\{(GLOBAL_[A-Z0-9_]+)/g)) {
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
check(adminDockerfile.includes("--filter @saydian/app-contracts build && pnpm --filter @saydian/app-admin-web build"), "Admin image must build contracts and the admin frontend");
check(!/apps\/(?:download-web|api|worker)|COPY\s+\.\s+\./.test(adminDockerfile), "Global static image must not copy unrelated applications or the entire repository");
check(adminDockerfile.includes("RUN VITE_APP_REALM=global VITE_API_BASE=/global/api/saidian-mall/v1 VITE_PUBLIC_BASE=/global/saidian-mall/ pnpm --filter @saydian/app-shop build:h5"), "H5 must use independently scoped build variables without changing admin build configuration");
check(adminDockerfile.includes("COPY --from=build /workspace/apps/shop/dist/build/h5 /usr/share/nginx/html/global/saidian-mall"), "Global H5 must be copied into its own static tree");
check(adminDockerfile.includes("FROM nginxinc/nginx-unprivileged:") && adminDockerfile.includes("ENV VITE_BASE_PATH=/admin/"), "Admin runtime must be unprivileged and use the existing /admin/ public path");
check(adminDockerfile.includes("COPY --from=build /workspace/apps/admin-web/dist /usr/share/nginx/html/admin"), "Admin runtime must contain the compiled frontend only");
check(adminNginx.includes("listen 8080;") && adminNginx.includes("location /admin/ {") && adminNginx.includes("try_files $uri $uri/ /admin/index.html;"), "Admin must serve SPA navigation under /admin/");
check(/location = \/admin\/index\.html\s*\{[^}]*try_files \$uri =404;[^}]*Cache-Control "no-store"/s.test(adminNginx), "Admin HTML must exist and disable caching");
check(/location \^~ \/admin\/assets\/\s*\{[^}]*try_files \$uri =404;/s.test(adminNginx), "Missing static assets must return 404 rather than SPA HTML");
check(!/proxy_pass|fastcgi_pass|uwsgi_pass|scgi_pass/.test(adminNginx), "Static admin must not proxy API requests or receive service credentials");
check(/location \/\s*\{\s*return 404;\s*\}/.test(adminNginx), "Static admin must not serve other application paths");
check(nginx.includes("location ^~ /global/saidian-mall/") && nginx.includes("proxy_pass http://global-admin:8080;"), "Only the fixed global H5 prefix may use the global static upstream");
check(/location \^~ \/global\/saidian-mall\/\s*\{[^}]*access_log off;/s.test(nginx) && !nginx.includes("proxy_hide_header Referrer-Policy;"), "Gateway must not log OAuth query strings or hide the static Referrer-Policy");
check(/location = \/global\/saidian-mall\/oauth\/callback\s*\{[^}]*access_log off;[^}]*try_files \/global\/saidian-mall\/index\.html =404;[^}]*Cache-Control "no-store"[^}]*Referrer-Policy "no-referrer"/s.test(adminNginx), "Callback must serve the real H5 without redirect, logs or referrer leakage");
check(adminNginx.includes("location ~ ^/global/saidian-mall/(assets|static)/ {") && adminNginx.includes("try_files $uri =404;"), "H5 static assets must return real 404s instead of HTML");
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
