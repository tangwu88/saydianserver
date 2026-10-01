#!/usr/bin/env bash
# One release lock, one tested artifact, no server build, seed or database rollback.
set -Eeuo pipefail
umask 077
root_dir=/opt/saydianapp-server
source_dir=${RELEASE_SOURCE:?}
revision=${RELEASE_SHA:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$source_dir" == "$root_dir"/releases/ci-* ]]
[[ "$(readlink /proc/$$/fd/9)" == "$root_dir/deploy/.ci-release.lock" ]]
flock -n 9
state_dir="$root_dir/deploy/unified"
install -d -m 700 "$state_dir"
first=false
if [[ -e "$source_dir/deploy/.first-unified-cutover" ]]; then
  [[ -f "$source_dir/deploy/.first-unified-cutover" && ! -s "$source_dir/deploy/.first-unified-cutover" ]]
  [[ ! -e "$state_dir/accepted.json" && ! -e "$state_dir/writes-opened.json" ]]
  first=true
else
  [[ -s "$state_dir/accepted.json" && -s "$state_dir/compose.json" ]] || { echo 'First cutover has not been accepted; services unchanged.' >&2; exit 1; }
fi
manifest="$source_dir/deploy/release-manifest.json"
database=saydian-global-global-postgres-1
domestic_database=saydianapp-production-postgres-1
current_api=saydian-global-global-api-1
runtime=$(docker inspect -f '{{.Image}}' "$current_api")
node_tool() {
  docker run --rm --user 0:0 --network none --read-only --entrypoint node \
    -v "$source_dir/deploy:/release:ro" -v "$state_dir:/state:ro" \
    -v "$source_dir:/work" "$runtime" "$@"
}
sql() { docker exec -i "$1" sh -ec 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
pin_images() {
  local prefix=$1 project=$2 result='{"services":{}}' name id
  for name in api worker admin; do
    id=$(docker inspect -f '{{.Image}}' "$project-$prefix$name-1")
    result=$(jq --arg name "$prefix$name" --arg image "$id" '.services[$name]={image:$image}' <<< "$result")
  done
  printf '%s\n' "$result"
}
wait_ready() {
  local expected=$1
  for _attempt in {1..60}; do
    if docker exec "$current_api" wget -qO- http://127.0.0.1:8080/health/ready | jq -e --arg revision "$expected" '.status == "ready" and .revision == $revision' > /dev/null; then return; fi
    sleep 2
  done
  return 1
}
public_checks() {
  local path
  for path in /health/ready /global/health/ready; do
    curl --fail --silent --show-error --max-time 30 "https://app.saydian.cn$path" | jq -e --arg revision "$revision" '.status == "ready" and .revision == $revision' > /dev/null
  done
  for path in /admin/ /down /say-ring /saidian-mall/ /global/saidian-mall/; do
    curl --fail --silent --show-error --max-time 30 "https://app.saydian.cn$path" > "$source_dir/page.html"
    grep -qi '<html' "$source_dir/page.html"
  done
}
node_tool /release/scripts/release-manifest.mjs verify "$revision" /release/release-manifest.json
base_compose="$state_dir/compose.json"
if [[ "$first" == true ]]; then
  for unit in saydian-global-auto-deploy.timer saydian-global-auto-deploy.service; do
    if systemctl is-active --quiet "$unit"; then echo "Legacy publisher is active: $unit" >&2; exit 1; fi
  done
  # Resolve the actual running release and private override, never a new env template.
  files=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$current_api")
  IFS=, read -ra paths <<< "$files"
  args=()
  for path in "${paths[@]}"; do
    [[ "$path" == /opt/saydian-global/releases/*/deploy/global/compose.json || "$path" == /opt/saydian-global/private/payment-live.override.json ]]
    args+=(-f "$path")
  done
  docker compose --env-file /opt/saydian-global/private/global.env "${args[@]}" config --format json > "$source_dir/global-live.json"
  docker compose --env-file "$root_dir/deploy/.env.production" -f "$root_dir/deploy/compose.production.yaml" config --format json > "$source_dir/domestic-live.json"
  [[ $(jq -r .name "$source_dir/domestic-live.json") == saydianapp-production ]]
  node_tool /release/scripts/prepare-unified-compose.mjs /work/global-live.json /work/compose.json
  base_compose="$source_dir/compose.json"
  global_bytes=$(sql "$database" <<< 'SELECT pg_database_size(current_database());')
  domestic_bytes=$(sql "$domestic_database" <<< 'SELECT pg_database_size(current_database());')
  postgres_image=$(docker inspect -f '{{.Image}}' "$database")
  object_kb=$(docker run --rm --network none --volumes-from saydian-global-global-minio-1:ro --entrypoint sh "$postgres_image" -ec 'du -sk /data' | cut -f1)
  avatar_kb=$(docker run --rm --network none --volumes-from "$current_api":ro --entrypoint sh "$postgres_image" -ec 'du -sk /var/lib/saydian/say-ring-avatars' | cut -f1)
  [[ "$object_kb" =~ ^[0-9]+$ && "$avatar_kb" =~ ^[0-9]+$ ]]
  jq -n --argjson size "$((global_bytes + domestic_bytes))" --argjson files "$(((object_kb + avatar_kb) * 1024))" '{schemaVersion:1,cutoverCompleted:false,databaseContainer:"saydian-global-global-postgres-1",restoreBytes:($size * 2),backupBytes:($size * 4 + $files * 2)}' > "$source_dir/preflight.json"
else
  cp "$state_dir/accepted.json" "$source_dir/preflight.json"
fi
sql "$database" <<< 'SELECT coalesce(json_agg(t), '\''[]'\''::json) FROM (SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations") t;' > "$source_dir/history.json"
node_tool /release/scripts/unified-preflight.mjs "$revision" /release/release-manifest.json /work/history.json /work/preflight.json /state "$([[ "$first" == true ]] && echo first-cutover || echo routine)"
mode=compose
[[ ! -f "$source_dir/deploy/.offline-images" ]] || mode=compose-offline
node_tool /release/scripts/release-manifest.mjs "$mode" "$revision" /release/release-manifest.json > "$source_dir/images.json"
compose() { docker compose -f "$base_compose" -f "$source_dir/images.json" "$@"; }
compose config --quiet
deadline=$((SECONDS + 1200))
for name in api worker admin; do
  image=$(jq -r --arg name "$name" '.images[$name].ref' "$manifest")
  expected_id=$(jq -r --arg name "$name" '.images[$name].imageId' "$manifest")
  if [[ "$mode" == compose ]]; then
    remaining=$((deadline - SECONDS)); ((remaining > 0))
    timeout --signal=TERM --kill-after=10s "$remaining" docker pull --quiet "$image"
    [[ $(docker image inspect -f '{{.Id}}' "$image") == "$expected_id" ]]
  fi
  [[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$expected_id") == "$revision" ]]
done
# Older installed receivers already store this same short-lived job token in their
# private temporary Docker config. Reuse it in memory only; never print or persist it.
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  [[ "${DOCKER_CONFIG:-}" == "$source_dir/docker" ]]
  GITHUB_TOKEN=$(jq -er '.auths["ghcr.io"].auth | @base64d | sub("^[^:]+:";"")' "$DOCKER_CONFIG/config.json")
fi
check_latest() {
  local latest
  latest=$(curl --fail --silent --show-error --max-time 30 -H "Authorization: Bearer $GITHUB_TOKEN" -H 'Accept: application/vnd.github+json' https://api.github.com/repos/tangwu88/saydianserver/git/ref/heads/main | jq -er .object.sha)
  [[ "$latest" == "$revision" ]] || { echo 'Superseded release; existing services unchanged.' >&2; return 1; }
}
check_latest
stamp=$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}-$RANDOM
backup="$state_dir/backups/$stamp"
install -d -m 700 "$backup"
cp -p "$base_compose" "$backup/compose.json"
pin_images global- saydian-global > "$backup/images.json"
gateway=/opt/saydian/config/gateway-nginx.conf
changed=false
gateway_changed=false
writes_opened=false
rollback() {
  status=$?; trap - ERR INT TERM
  if [[ "$first" == true && "$writes_opened" == true ]]; then
    echo 'Writes may have resumed: no legacy-route or database rollback. Forward repair required.' >&2
  elif [[ "$changed" == true ]]; then
    if [[ "$first" == true ]]; then
      docker compose -f "$backup/global-live.json" -f "$backup/images.json" up -d --no-build --pull never --no-deps global-api global-worker global-admin || true
      docker compose -f "$backup/domestic-live.json" -f "$backup/domestic-images.json" up -d --no-build --pull never --no-deps api worker admin || true
    else
      docker compose -f "$backup/compose.json" -f "$backup/images.json" up -d --no-build --pull never --no-deps global-api global-worker global-admin || true
    fi
    if [[ "$gateway_changed" == true ]]; then cp -p "$backup/gateway.conf" "$gateway"; fi
    docker exec saydian-gateway-1 nginx -t && docker exec saydian-gateway-1 nginx -s reload || true
    echo 'Image rollback attempted; readiness requires verification.' >&2
  fi
  echo "Release failed. Private evidence retained: $backup. No database restore was attempted." >&2
  exit "$status"
}
trap rollback ERR
trap 'false' INT TERM
if [[ "$first" == true ]]; then
  # Drill before the write freeze; the measured duration is recorded for operators.
  bash "$source_dir/deploy/scripts/backup-restore.sh" "$domestic_database" "$backup/rehearsal-domestic"
  bash "$source_dir/deploy/scripts/backup-restore.sh" "$database" "$backup/rehearsal-global"
  check_latest
  cp "$source_dir/global-live.json" "$backup/global-live.json"
  # Explicit node commands prevent the previous domestic image's seed-bearing CMD.
  jq '.services.api.command=["node","dist/main.js"] | .services.worker.command=["node","dist/main.js"]' "$source_dir/domestic-live.json" > "$backup/domestic-live.json"
  pin_images "" saydianapp-production > "$backup/domestic-images.json"
  cp -p "$gateway" "$backup/gateway.conf"
  cp "$gateway" "$source_dir/gateway.conf"
  node_tool /release/scripts/unify-gateway.mjs /work/gateway.conf /work/gateway-candidate.conf
  node_tool /release/scripts/unify-gateway.mjs /work/gateway.conf /work/gateway-frozen.conf freeze
  node_tool /release/scripts/unify-gateway.mjs /work/gateway-candidate.conf /work/gateway-candidate-frozen.conf freeze
  freeze='{"MAINTENANCE_READ_ONLY":"true","BUSINESS_WRITES_PAUSED":"true","MAINTENANCE_ALLOW_MEMBER_AUTH":"false","WORKER_OUTBOUND_PAUSED":"true","CALLBACK_PROCESSING_PAUSED":"true","HEALTH_REPORT_WORKER_ENABLED":"false","JUSHUITAN_OUTBOUND_ENABLED":"false"}'
  jq -n --argjson env "$freeze" '{services:{"global-api":{environment:$env},"global-worker":{environment:$env}}}' > "$source_dir/freeze.json"
  jq -n --argjson env "$freeze" '{services:{api:{environment:$env},worker:{environment:$env}}}' > "$source_dir/domestic-freeze.json"
  changed=true
  gateway_changed=true
  cp "$source_dir/gateway-frozen.conf" "$gateway"
  docker exec saydian-gateway-1 nginx -t
  docker exec saydian-gateway-1 nginx -s reload
  docker compose -f "$backup/global-live.json" -f "$backup/images.json" stop -t 180 global-worker
  docker compose -f "$backup/domestic-live.json" -f "$backup/domestic-images.json" stop -t 180 worker
  docker compose -f "$backup/global-live.json" -f "$backup/images.json" -f "$source_dir/freeze.json" up -d --no-build --pull never --no-deps global-api
  docker compose -f "$backup/domestic-live.json" -f "$backup/domestic-images.json" -f "$source_dir/domestic-freeze.json" up -d --no-build --pull never --no-deps api
  for container in "$current_api" saydianapp-production-api-1; do
    docker inspect -f '{{json .Config.Env}}' "$container" | jq -e 'index("MAINTENANCE_READ_ONLY=true") != null and index("BUSINESS_WRITES_PAUSED=true") != null and index("CALLBACK_PROCESSING_PAUSED=true") != null' > /dev/null
    ready=false
    for _attempt in {1..60}; do
      if docker exec "$container" wget -qO- http://127.0.0.1:8080/health/ready | jq -e '.status == "ready"' > /dev/null; then ready=true; break; fi
      sleep 2
    done
    [[ "$ready" == true ]]
  done
  docker exec saydian-gateway-1 nginx -t
  docker exec saydian-gateway-1 nginx -s reload
  sql "$domestic_database" <<< 'SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "HealthRecord") + (SELECT count(*) FROM "DeviceBinding") + (SELECT count(*) FROM "CommerceOrder") + (SELECT count(*) FROM "PaymentIntent") + (SELECT count(*) FROM "FileObject");' | grep -qx 0
  sql "$database" <<< 'SELECT (SELECT count(*) FROM "OutboxEvent" WHERE status = '\''PROCESSING'\'') + (SELECT count(*) FROM "CommerceIntegrationJob" WHERE status = '\''RUNNING'\'');' | grep -qx 0
  sql "$database" <<< 'SELECT count(*) FROM "User" WHERE (mobile IS NOT NULL AND mobile !~ '\''^\+[1-9][0-9]{6,14}$'\'') OR (email IS NOT NULL AND email <> lower(trim(email)));' | grep -qx 0
  # Final consistent backups after writes stop; callbacks remain durable/deferred.
  bash "$source_dir/deploy/scripts/backup-restore.sh" "$domestic_database" "$backup/cutover-domestic"
  bash "$source_dir/deploy/scripts/backup-restore.sh" "$database" "$backup/cutover-global"
  docker run --rm --network none --volumes-from saydian-global-global-minio-1:ro --entrypoint sh "$postgres_image" -ec 'tar -czf - -C /data .' > "$backup/object-storage.tar.gz"
  docker run --rm --network none --volumes-from "$current_api":ro --entrypoint sh "$postgres_image" -ec 'tar -czf - -C /var/lib/saydian/say-ring-avatars .' > "$backup/avatars.tar.gz"
  sha256sum "$backup/object-storage.tar.gz" "$backup/avatars.tar.gz" > "$backup/files.sha256"
  sha256sum --check "$backup/files.sha256"
  sql "$domestic_database" <<< 'SELECT coalesce(json_agg(t), '\''[]'\''::json) FROM (SELECT * FROM "AppSetting" WHERE key IN ('\''app_update'\'','\''support'\'')) t;' > "$source_dir/domestic-settings.json"
  sql "$database" <<< 'SELECT coalesce(json_agg(t), '\''[]'\''::json) FROM (SELECT * FROM "AppSetting") t;' > "$source_dir/target-settings.json"
  node_tool /release/scripts/import-missing-settings.mjs /work/domestic-settings.json /work/target-settings.json /work/settings-import
  cp "$source_dir/settings-import.audit.json" "$backup/settings-import.audit.json"
else
  docker exec "$database" sh -ec 'pg_dump -Fc --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup/database.dump"
  test -s "$backup/database.dump"
  sha256sum "$backup/database.dump" > "$backup/database.dump.sha256"
  docker exec -i "$database" pg_restore --list < "$backup/database.dump" > /dev/null
fi
check_latest
unset GITHUB_TOKEN
# Owner credentials exist only in a root-readable private file; runtime stays global_app.
docker inspect -f '{{json .Config.Env}}' "$database" | jq 'map(split("=") | {key:.[0],value:.[1:]|join("=")}) | from_entries | {services:{"global-api":{environment:{DATABASE_URL:("postgresql://" + (.POSTGRES_USER|@uri) + ":" + (.POSTGRES_PASSWORD|@uri) + "@global-postgres:5432/" + (.POSTGRES_DB|@uri) + "?schema=public")}}}}' > "$backup/migration-owner.json"
docker compose -f "$base_compose" -f "$source_dir/images.json" -f "$backup/migration-owner.json" run --rm -T --no-deps global-api ./node_modules/.bin/prisma migrate deploy
compose run --rm -T --no-deps global-api ./node_modules/.bin/prisma migrate status
changed=true
if [[ "$first" == true ]]; then
  sql "$database" < "$source_dir/settings-import.sql"
  compose -f "$source_dir/freeze.json" up -d --no-build --pull never --no-deps global-api global-worker global-admin
else
  compose up -d --no-build --pull never --no-deps global-api global-worker global-admin
fi
wait_ready "$revision"
if [[ "$first" == true ]]; then
  gateway_changed=true
  cp "$source_dir/gateway-candidate-frozen.conf" "$gateway"
fi
docker exec saydian-gateway-1 nginx -t
docker exec saydian-gateway-1 nginx -s reload
public_checks
for name in api worker admin; do
  expected=$(jq -r --arg name "$name" '.images[$name].imageId' "$manifest")
  [[ $(docker inspect -f '{{.Image}}' "saydian-global-global-$name-1") == "$expected" ]]
done
if [[ "$first" == true ]]; then
  sql "$database" < "$source_dir/deploy/scripts/database-fingerprint.sql" > "$source_dir/after.jsonl"
  node_tool /release/scripts/verify-cutover-data.mjs "/state/backups/$stamp/cutover-global/source.jsonl" /work/after.jsonl
  cp "$base_compose" "$state_dir/compose.json"
  cp "$manifest" "$state_dir/release-manifest.json"
  cp "$source_dir/images.json" "$state_dir/images.json"
  # Set the irreversible boundary before the first operation capable of reopening writes.
  jq -n --arg revision "$revision" '{revision:$revision,writesMayHaveResumed:true}' > "$state_dir/writes-opened.json"
  writes_opened=true
  compose up -d --no-build --pull never --no-deps global-api global-worker
  wait_ready "$revision"
  cp "$source_dir/gateway-candidate.conf" "$gateway"
  docker exec saydian-gateway-1 nginx -t
  docker exec saydian-gateway-1 nginx -s reload
  public_checks
  jq --arg revision "$revision" --arg evidence "$backup" '.cutoverCompleted=true | .revision=$revision | .evidence=$evidence' "$source_dir/preflight.json" > "$state_dir/accepted.json"
  # Old infrastructure/data stay intact; only superseded application processes stop.
  docker compose -f "$backup/domestic-live.json" -f "$backup/domestic-images.json" stop -t 180 api worker admin
  systemctl disable --now saydian-global-auto-deploy.timer
else
  cp "$manifest" "$state_dir/release-manifest.json"
  cp "$source_dir/images.json" "$state_dir/images.json"
fi
printf '%s\n' "$revision" > "$root_dir/deploy/.deployed-revision"
changed=false
trap - ERR INT TERM
echo "Unified release verified: $revision. Existing business switches preserved; backups: $backup"
