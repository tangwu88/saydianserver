#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"

test -f "$env_file"
test -f "$compose_file"
command -v docker >/dev/null 2>&1
docker compose version >/dev/null

disk_used_percent=$(df -Pk "$root_dir" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
case "$disk_used_percent" in
  ''|*[!0-9]*) echo "unable to determine deployment disk usage" >&2; exit 1 ;;
esac
if [ "$disk_used_percent" -ge 85 ]; then
  echo "deployment disk usage is ${disk_used_percent}% (hard limit 85%)" >&2
  exit 1
fi
if [ "$disk_used_percent" -ge 70 ]; then
  echo "warning: deployment disk usage is ${disk_used_percent}% (warning 70%)" >&2
fi

required="IMAGE_TAG APP_DOMAIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL REDIS_PASSWORD REDIS_URL ACCESS_TOKEN_SECRET EMPLOYEE_TOKEN_SECRET REFRESH_TOKEN_PEPPER INTEGRATION_MASTER_KEY ADMIN_BOOTSTRAP_PASSWORD OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY RESTIC_REPOSITORY RESTIC_PASSWORD BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY"
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

if printf '%s' "$INTEGRATION_MASTER_KEY" | grep -Eq '^[0-9A-Fa-f]{64}$'; then
  :
else
  decoded_key_bytes=$(printf '%s' "$INTEGRATION_MASTER_KEY" | base64 -d 2>/dev/null | wc -c | tr -d ' ')
  if [ "$decoded_key_bytes" != "32" ]; then
    echo "INTEGRATION_MASTER_KEY must be 32 bytes encoded as base64 or 64 hex characters" >&2
    exit 1
  fi
fi

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
case "${COMMERCE_MODE:-integrated}" in
  integrated) ;;
  *) echo "COMMERCE_MODE must remain integrated after the single-system cutover" >&2; exit 1 ;;
esac
case "${ENABLE_HEALTH_REPORT_SALES:-false}" in
  true|false) ;;
  *) echo "ENABLE_HEALTH_REPORT_SALES must be true or false" >&2; exit 1 ;;
esac
if [ "${ENABLE_HEALTH_REPORT_SALES:-false}" = "true" ]; then
  test -n "${HEALTH_REPORT_SINGLE_PRICE_CENTS:-}" || {
    echo "health report sales require HEALTH_REPORT_SINGLE_PRICE_CENTS" >&2
    exit 1
  }
  test -n "${HEALTH_MEMBERSHIP_30D_PRICE_CENTS:-}" || {
    echo "health report sales require HEALTH_MEMBERSHIP_30D_PRICE_CENTS" >&2
    exit 1
  }
fi
case "${DATABASE_URL:-}" in
  postgresql://*@saydianapp-postgres:5432/*) ;;
  *) echo "DATABASE_URL must use the isolated host saydianapp-postgres" >&2; exit 1 ;;
esac
case "${REDIS_URL:-}" in
  redis://*@saydianapp-redis:6379*) ;;
  *) echo "REDIS_URL must use the isolated host saydianapp-redis" >&2; exit 1 ;;
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
