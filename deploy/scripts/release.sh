#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
cd "$root_dir"
export DEPLOY_ROOT="$root_dir"
export IMAGE_TAG=${IMAGE_TAG:?IMAGE_TAG is required}

deploy/scripts/preflight.sh
if [ "${DRY_RUN:-true}" = "true" ]; then
  echo "dry run complete; no services changed"
  exit 0
fi

env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"
compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}
previous=$(sed -n 's/^IMAGE_TAG=//p' "$env_file" | tail -n 1)
printf '%s\n' "$previous" > "$root_dir/deploy/.previous-image-tag"

if compose ps --status running --services | grep -qx postgres; then
  deploy/scripts/backup.sh
else
  echo "first deployment: no existing application database to back up"
fi
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" "$env_file"
sed -i "s/^MAINTENANCE_READ_ONLY=.*/MAINTENANCE_READ_ONLY=true/" "$env_file"
set -a
. "$env_file"
set +a
if [ "${PRIVATE_IMAGES_PRELOADED:-false}" = "true" ]; then
  echo "using preloaded private runtime images for $IMAGE_TAG"
else
  compose pull api worker admin
fi
compose pull postgres redis database-backup backup
if [ "${LOCAL_OBJECT_STORAGE_ENABLED:-false}" = "true" ]; then
  compose --profile local-storage pull minio minio-init
  compose --profile local-storage up -d --wait minio
  compose --profile local-storage run --rm --no-deps minio-init
fi
compose up -d postgres redis
compose run --rm --no-deps api \
  sh -c './node_modules/.bin/prisma migrate deploy'
compose up -d api worker admin

if [ "${USE_SHARED_GATEWAY:-false}" = "true" ]; then
  sudo APP_DOMAIN="$APP_DOMAIN" \
    GATEWAY_CONTAINER="${GATEWAY_CONTAINER:-saydian-gateway-1}" \
    GATEWAY_CONFIG_PATH="${GATEWAY_CONFIG_PATH:-/opt/saydian/config/gateway-nginx.conf}" \
    DEPLOY_ROOT="$root_dir" \
    deploy/scripts/configure-shared-gateway.sh
else
  compose pull caddy
  compose up -d caddy
fi

compose --profile backups up -d database-backup backup

for attempt in $(seq 1 40); do
  if curl --fail --silent --show-error "https://${APP_DOMAIN}/health/ready" >/dev/null; then break; fi
  if [ "$attempt" -eq 40 ]; then
    deploy/scripts/rollback.sh
    exit 1
  fi
  sleep 3
done

if [ "${OPEN_WRITES:-false}" = "true" ]; then
  sed -i "s/^MAINTENANCE_READ_ONLY=.*/MAINTENANCE_READ_ONLY=false/" "$env_file"
  compose up -d --force-recreate api
fi
echo "release $IMAGE_TAG deployed"
