#!/usr/bin/env bash
# Invoked by the receiver after archive validation and locking. No database migration is applied.
set -Eeuo pipefail
umask 077
root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
[[ "$root_dir" == /opt/saydianapp-server ]] || { echo 'Unexpected deployment root' >&2; exit 1; }
revision=${RELEASE_SHA:?}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || exit 1
source_dir=${RELEASE_SOURCE:?}
[[ "$source_dir" == "$root_dir"/releases/ci-* && -d "$source_dir/deploy" ]] || exit 1
cd "$root_dir"
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"
[[ -f "$env_file" && -f "$compose_file" ]]
compose() { docker compose --env-file "$env_file" -f "$compose_file" "$@"; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}
rollback_dir="$root_dir/releases/rollback-$stamp"
mkdir -m 700 "$rollback_dir"
cp -p "$env_file" "$rollback_dir/env.production"
cp -p "$compose_file" "$rollback_dir/compose.production.yaml"
read_only=$(sed -n 's/^MAINTENANCE_READ_ONLY=//p' "$env_file" | tail -n 1)
[[ "$read_only" == true || "$read_only" == false ]] || { echo 'Maintenance mode must be explicit' >&2; exit 1; }
# Pin actual running images, including earlier hotfix layers. Do not pull during rollback.
printf 'services:\n' > "$rollback_dir/images.yaml"
for service in api worker admin; do
  container=$(compose ps -q "$service")
  [[ -n "$container" ]] || { echo "Existing $service container is required" >&2; exit 1; }
  image_id=$(docker inspect -f '{{.Image}}' "$container")
  printf '  %s:\n    image: %s\n' "$service" "$image_id" >> "$rollback_dir/images.yaml"
done
changed=false
containers_changed=false
reload_gateway() {
  local gateway
  gateway=$(sed -n 's/^GATEWAY_CONTAINER=//p' "$env_file" | tail -n 1)
  [[ -n "$gateway" ]] || gateway=saidian-gateway-1
  if grep -qx 'USE_SHARED_GATEWAY=true' "$env_file"; then
    docker exec "$gateway" nginx -t
    docker exec "$gateway" nginx -s reload
  fi
}
configure_gateway() {
  local domain gateway gateway_config
  if ! grep -qx 'USE_SHARED_GATEWAY=true' "$env_file"; then return; fi
  domain=$(sed -n 's/^APP_DOMAIN=//p' "$env_file" | tail -n 1)
  gateway=$(sed -n 's/^GATEWAY_CONTAINER=//p' "$env_file" | tail -n 1)
  gateway_config=$(sed -n 's/^GATEWAY_CONFIG_PATH=//p' "$env_file" | tail -n 1)
  [[ -n "$gateway" ]] || gateway=saidian-gateway-1
  [[ -n "$gateway_config" ]] || gateway_config=/opt/saydian/config/gateway-nginx.conf
  APP_DOMAIN="$domain" GATEWAY_CONTAINER="$gateway" GATEWAY_CONFIG_PATH="$gateway_config" \
    DEPLOY_ROOT="$root_dir" DEPLOY_SOURCE_DIR="$source_dir/deploy" \
    bash "$source_dir/deploy/scripts/configure-shared-gateway.sh"
}
rollback() {
  local status=${1:-1}
  trap - ERR INT TERM
  if [[ "$changed" == true ]]; then
    cp -p "$rollback_dir/env.production" "$env_file"
    cp -p "$rollback_dir/compose.production.yaml" "$compose_file"
    if [[ "$containers_changed" == true ]]; then
      if docker compose --env-file "$env_file" -f "$compose_file" -f "$rollback_dir/images.yaml" up -d --no-deps api worker admin && reload_gateway; then
        echo 'Previous application images restored; inspect readiness before further release.' >&2
      else
        echo 'ROLLBACK FAILED: operator intervention required; backups retained.' >&2
      fi
    fi
    echo "Deployment failed; state saved at $rollback_dir" >&2
  fi
  exit "$status"
}
trap 'rollback $?' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
mkdir -p "$root_dir/deploy/backups"
compose exec -T postgres sh -c 'exec pg_dump --format=custom --no-owner --no-privileges --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"' > "$root_dir/deploy/backups/saydian-ci-$stamp.dump"
test -s "$root_dir/deploy/backups/saydian-ci-$stamp.dump"
sha256sum "$root_dir/deploy/backups/saydian-ci-$stamp.dump" > "$root_dir/deploy/backups/saydian-ci-$stamp.dump.sha256"
changed=true
install -d -m 755 "$root_dir/deploy/downloads"
cp "$source_dir/deploy/compose.production.yaml" "$compose_file"
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=sha-$revision/" "$env_file"
if grep -q '^APP_REVISION=' "$env_file"; then
  sed -i "s/^APP_REVISION=.*/APP_REVISION=$revision/" "$env_file"
else
  printf '\nAPP_REVISION=%s\n' "$revision" >> "$env_file"
fi
compose config --quiet
compose pull api worker admin
# Stop on pending or failed schema migration. Existing API image startup only reapplies already-completed migrations.
compose run --rm --no-deps api ./node_modules/.bin/prisma migrate status
containers_changed=true
compose up -d --no-deps api worker admin
compose up -d --no-deps --wait --wait-timeout 150 api
configure_gateway
domain=$(sed -n 's/^APP_DOMAIN=//p' "$env_file" | tail -n 1)
[[ "$domain" == app.saydian.cn ]] || { echo 'Unexpected domain' >&2; false; }
ready=false
for attempt in $(seq 1 20); do
  response=$(curl --max-time 10 --fail --silent "https://$domain/health/ready") || response=''
  if printf '%s' "$response" | grep -q '"revision":"'"$revision"'"'; then ready=true; break; fi
  sleep 3
done
[[ "$ready" == true ]]
for page in admin down; do
  page_ready=false
  for attempt in $(seq 1 20); do
    if curl --max-time 15 --fail --silent "https://$domain/$page/" > "$rollback_dir/$page-smoke.html" \
      && grep -qi '<html' "$rollback_dir/$page-smoke.html"; then
      page_ready=true; break
    fi
    sleep 3
  done
  [[ "$page_ready" == true ]]
done
for service in api worker admin; do
  container=$(compose ps -q "$service")
  [[ "$(docker inspect -f '{{.State.Running}}' "$container")" == true ]]
done
[[ "$(sed -n 's/^MAINTENANCE_READ_ONLY=//p' "$env_file" | tail -n 1)" == "$read_only" ]]
printf '%s\n' "$revision" > "$root_dir/deploy/.deployed-revision"
changed=false
trap - ERR INT TERM
echo "Deployed $revision; maintenance mode preserved ($read_only); database changes not applied."
