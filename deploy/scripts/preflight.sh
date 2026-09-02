#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"

test -f "$env_file"
test -f "$compose_file"
command -v docker >/dev/null 2>&1
docker compose version >/dev/null

required="IMAGE_TAG APP_DOMAIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL REDIS_PASSWORD REDIS_URL ACCESS_TOKEN_SECRET REFRESH_TOKEN_PEPPER ADMIN_BOOTSTRAP_PASSWORD OBJECT_STORAGE_ENDPOINT OBJECT_STORAGE_BUCKET OBJECT_STORAGE_ACCESS_KEY OBJECT_STORAGE_SECRET_KEY MALL_SERVICE_TOKEN RESTIC_REPOSITORY RESTIC_PASSWORD BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY"
for key in $required; do
  value=$(sed -n "s/^${key}=//p" "$env_file" | tail -n 1)
  if [ -z "$value" ]; then
    echo "missing required production setting: $key" >&2
    exit 1
  fi
done

case "${IMAGE_TAG:-}" in
  *[!A-Za-z0-9._-]*|'') echo "invalid IMAGE_TAG" >&2; exit 1 ;;
esac

docker compose --env-file "$env_file" -f "$compose_file" config --quiet
echo "preflight ok"
