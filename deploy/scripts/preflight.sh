#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"

test -f "$env_file"
test -f "$compose_file"
command -v docker >/dev/null 2>&1
docker compose version >/dev/null

required="IMAGE_TAG APP_DOMAIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL REDIS_PASSWORD REDIS_URL ACCESS_TOKEN_SECRET REFRESH_TOKEN_PEPPER ADMIN_BOOTSTRAP_PASSWORD OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY RESTIC_REPOSITORY RESTIC_PASSWORD BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY"
for key in $required; do
  value=$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)
  if [ -z "$value" ]; then
    echo "missing required production setting: $key" >&2
    exit 1
  fi
done

set -a
. "$env_file"
set +a

if [ "${USE_SHARED_GATEWAY:-false}" = "true" ]; then
  gateway_network=${GATEWAY_NETWORK:-saidian_default}
  gateway_container=${GATEWAY_CONTAINER:-saydian-gateway-1}
  gateway_config=${GATEWAY_CONFIG_PATH:-/opt/saydian/config/gateway-nginx.conf}
  docker network inspect "$gateway_network" >/dev/null
  test -r "$gateway_config"
  test "$(docker inspect -f '{{.State.Running}}' "$gateway_container")" = "true"
fi

case "${IMAGE_TAG:-}" in
  *[!A-Za-z0-9._-]*|'') echo "invalid IMAGE_TAG" >&2; exit 1 ;;
esac
case "${PRIVATE_IMAGES_PRELOADED:-false}" in
  true|false) ;;
  *) echo "PRIVATE_IMAGES_PRELOADED must be true or false" >&2; exit 1 ;;
esac
case "${LOCAL_OBJECT_STORAGE_ENABLED:-false}" in
  true|false) ;;
  *) echo "LOCAL_OBJECT_STORAGE_ENABLED must be true or false" >&2; exit 1 ;;
esac

if [ "${LOCAL_OBJECT_STORAGE_ENABLED:-false}" = "true" ]; then
  test "${OBJECT_STORAGE_ENDPOINT:-}" = "http://minio:9000" || {
    echo "local object storage requires OBJECT_STORAGE_ENDPOINT=http://minio:9000" >&2
    exit 1
  }
  test "${OBJECT_STORAGE_FORCE_PATH_STYLE:-false}" = "true" || {
    echo "local object storage requires OBJECT_STORAGE_FORCE_PATH_STYLE=true" >&2
    exit 1
  }
  case "${RESTIC_REPOSITORY:-}" in
    s3:http://minio:9000/*) ;;
    *) echo "local object storage requires a MinIO RESTIC_REPOSITORY" >&2; exit 1 ;;
  esac
  test -n "${LOCAL_BACKUP_BUCKET:-}" || {
    echo "missing required production setting: LOCAL_BACKUP_BUCKET" >&2
    exit 1
  }
fi

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
if [ "${PRIVATE_IMAGES_PRELOADED:-false}" = "true" ]; then
  DEPLOY_ROOT="$root_dir" deploy/scripts/check-runtime-images.sh
fi
echo "preflight ok"
