#!/usr/bin/env bash
set -Eeuo pipefail
revision=${1:?Full revision required}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
prefix=ghcr.io/tangwu88/saydianserver
api_container=saydian-ci-api-$revision
worker_container=saydian-ci-worker-$revision
admin_container=saydian-ci-admin-$revision
gateway_container=saydian-ci-gateway-$revision
gateway_config=$(mktemp)
download_fixture=$(mktemp)
cleanup() { docker rm -f "$api_container" "$worker_container" "$admin_container" "$gateway_container" >/dev/null 2>&1 || true; rm -f -- "$gateway_config" "$download_fixture"; }
trap cleanup EXIT
node -e 'require("node:fs").writeFileSync(process.argv[1], Buffer.alloc(4096, "x"))' "$download_fixture"
chmod 644 "$download_fixture"
docker run -d --name "$api_container" --network host \
  -e NODE_ENV=production -e PORT=18080 -e PUBLIC_BASE_URL=https://app.saydian.cn \
  -e DATABASE_URL -e REDIS_URL -e ACCESS_TOKEN_SECRET -e REFRESH_TOKEN_PEPPER \
  -e APP_REVISION="$revision" -e WORKER_OUTBOUND_PAUSED=true \
  "$prefix-api:sha-$revision"
docker run -d --name "$worker_container" --network host \
  -e DATABASE_URL -e REDIS_URL -e WORKER_OUTBOUND_PAUSED=true \
  "$prefix-worker:sha-$revision"
docker run -d --name "$admin_container" -p 18081:8080 \
  -v "$download_fixture:/usr/share/nginx/html/down/files/health-ci.apk:ro" "$prefix-admin:sha-$revision"
ready=false
for _attempt in {1..45}; do
  if curl -fsS http://127.0.0.1:18080/health/ready | jq -e --arg revision "$revision" '.revision == $revision' >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { docker logs "$api_container"; exit 1; }
for path in /health/ready /global/health/ready; do
  curl -fsS "http://127.0.0.1:18080$path" | jq -e --arg revision "$revision" '.revision == $revision' >/dev/null
done
# Reuse only the sanitized HTTP fixture. Check the actual production image, not
# a second source build, and compare member data through both URL families.
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:18080';
async function request(path, token, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `${path}: ${response.status}`);
  const result = await response.json();
  if ('code' in result) assert.equal(result.code, 200, path);
  return result.data ?? result;
}
const login = prefix => request(prefix + '/api/saydian-app/v2/auth/login', null, { mobile: '19900000002', password: 'local-fixture-password-only' });
const direct = await login(''), alias = await login('/global');
assert.equal(direct.member.id, alias.member.id);
for (const path of ['/api/saydian-app/v2/members/me', '/api/saydian-app/v2/devices', '/api/saydian-app/v2/health/records?metric=heart_rate', '/api/saidian-mall/v1/storefront/orders']) {
  assert.deepEqual(await request(path, direct.accessToken), await request('/global' + path, alias.accessToken), path);
}
console.log('Runtime image: canonical and legacy login/member/device/health/order parity passed.');
NODE
for path in /admin/ /down /say-ring /saidian-mall/ /global/saidian-mall/; do
  curl -fsS "http://127.0.0.1:18081$path" | grep -qi '<html'
done
for path in /down/files/health-ci.apk /global/down/files/health-ci.apk; do
  [[ $(curl -fsS "http://127.0.0.1:18081$path" | wc -c) -eq 4096 ]]
  [[ $(curl -sS -r 0-1023 -o /dev/null -w '%{http_code}' "http://127.0.0.1:18081$path") == 206 ]]
  [[ $(curl -sS -X POST -o /dev/null -w '%{http_code}' "http://127.0.0.1:18081$path") == 403 ]]
done
[[ $(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/global/down/files/missing.apk) == 404 ]]
# Exercise the temporary gateway freeze in real Nginx, with a synthetic handler
# instead of any business service or payment provider.
node --input-type=module - "$gateway_config" <<'NODE'
import {writeFileSync} from 'node:fs';
import {freezeGateway} from './deploy/scripts/unify-gateway.mjs';
const server = `# BEGIN SAYDIAN APP HTTPS app.saydian.cn
server { listen 8080; server_name app.saydian.cn; location / { return 200 'synthetic'; } }
# END SAYDIAN APP HTTPS app.saydian.cn`;
writeFileSync(process.argv[2], 'pid /tmp/nginx.pid; error_log /dev/stderr; events {} http { access_log off; ' + freezeGateway(server) + '\n}');
NODE
chmod 644 "$gateway_config"
docker run -d --name "$gateway_container" -p 18082:8080 -v "$gateway_config:/tmp/freeze.conf:ro" "$prefix-admin:sha-$revision" -c /tmp/freeze.conf -g 'daemon off;'
for _attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:18082/health/ready >/dev/null; then break; fi
  sleep 1
done
for path in /admin/ /down /health/ready /global/health/ready /api/saydian-app/v2/billing/payments/wechat/notify /global/api/saydian-app/v2/billing/payments/wechat/app/notify; do
  [[ $(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:18082$path") == 200 ]]
done
for method in GET POST; do
  for path in /api/v1/member/member/my /API/v1/member/member/my /global/api/saydian-app/v2/devices /global/API/saydian-app/v2/devices /api/saydian-app/v2/billing/payments/wechat/notify/nested; do
    [[ $(curl -sS -X "$method" -o /dev/null -w '%{http_code}' "http://127.0.0.1:18082$path") == 503 ]]
  done
done
for container in "$api_container" "$worker_container" "$admin_container"; do
  [[ $(docker inspect -f '{{.State.Running}}' "$container") == true ]]
done
# Test that pruning retained the generated Prisma client and migration CLI.
docker exec "$api_container" ./node_modules/.bin/prisma migrate status
docker exec "$worker_container" node -e 'const {PrismaClient}=require("@prisma/client"); const client=new PrismaClient(); client.$connect().then(()=>client.$disconnect()).catch(error=>{console.error(error);process.exit(1)});'
