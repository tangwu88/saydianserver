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
previous=$(sed -n 's/^IMAGE_TAG=//p' "$env_file" | tail -n 1)
printf '%s\n' "$previous" > "$root_dir/deploy/.previous-image-tag"

deploy/scripts/backup.sh
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$IMAGE_TAG/" "$env_file"
sed -i "s/^MAINTENANCE_READ_ONLY=.*/MAINTENANCE_READ_ONLY=true/" "$env_file"
set -a
. "$env_file"
set +a
docker compose --env-file "$env_file" -f "$compose_file" pull
docker compose --env-file "$env_file" -f "$compose_file" up -d postgres redis
docker compose --env-file "$env_file" -f "$compose_file" run --rm --no-deps api \
  sh -c './node_modules/.bin/prisma migrate deploy'
docker compose --env-file "$env_file" -f "$compose_file" up -d api worker admin caddy
docker compose --env-file "$env_file" -f "$compose_file" --profile backups up -d database-backup backup

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
  docker compose --env-file "$env_file" -f "$compose_file" up -d --force-recreate api
fi
echo "release $IMAGE_TAG deployed"
