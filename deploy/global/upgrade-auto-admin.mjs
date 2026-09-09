// One-time, idempotent upgrade of the already-installed global deployment runner.
// No credentials, gateway edits, database changes or service starts occur here.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";

const path = process.argv[2];
assert(path === "/target/auto-deploy.sh", "Mount only the global deployment bin directory at /target");
const source = readFileSync(path, "utf8");
if (source.includes("# global-admin deployment v1")) {
  console.log("International admin deployment support is already installed.");
  process.exit(0);
}
let updated = source;
function replaceOnce(from, to) {
  assert(updated.split(from).length === 2, `Unexpected installed runner shape: ${from}`);
  updated = updated.replace(from, to);
}
replaceOnce('worker_image="$worker_repo:sha-$target"', 'worker_image="$worker_repo:sha-$target"\n# global-admin deployment v1\nadmin_image="ghcr.io/tangwu88/saydianserver-global-admin:sha-$target"');
replaceOnce('nice -n 10 docker build -f "$release/docker/worker.Dockerfile" -t "$worker_image" "$release"', 'nice -n 10 docker build -f "$release/docker/worker.Dockerfile" -t "$worker_image" "$release"\nnice -n 10 docker build -f "$release/deploy/global/admin.Dockerfile" -t "$admin_image" "$release"');
replaceOnce('up -d --no-deps global-api global-worker || true', 'up -d --no-deps $(docker compose --env-file "$env_file" -f "$base/releases/$current/$compose_name" config --services | grep -E "^global-(api|worker|admin)$") || true');
replaceOnce('up -d --no-deps global-worker; then', 'up -d --no-deps global-worker global-admin; then');
const finalProbe = 'docker exec saydian-global-global-api-1 wget -qO- http://127.0.0.1:8080/health/ready';
assert(updated.split(finalProbe).length === 2, "Final API revision check must remain unique");
updated = updated.replace(finalProbe, `admin_ready=false
for _ in $(seq 1 24); do
  if [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' saydian-global-global-admin-1 2>/dev/null || true)" == healthy ]]; then
    admin_ready=true
    break
  fi
  sleep 5
done
if [[ "$admin_ready" != true ]]; then
  rollback
  exit 1
fi
${finalProbe}`);
copyFileSync(path, `${path}.before-admin`);
chmodSync(`${path}.before-admin`, 0o750);
writeFileSync(path, updated);
chmodSync(path, 0o750);
console.log("International admin build, release health gate and rollback were added to the global runner.");
