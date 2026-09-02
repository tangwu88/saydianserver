#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"
backup_dir="$root_dir/deploy/backups"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_dir"

set -a
. "$env_file"
set +a
target="/backups/saydian-app-${timestamp}.dump"
docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --file "$target"
sha256sum "$backup_dir/saydian-app-${timestamp}.dump" > "$backup_dir/saydian-app-${timestamp}.dump.sha256"
find "$backup_dir" -maxdepth 1 -type f -mtime +30 -name 'saydian-app-*.dump*' -delete
echo "$backup_dir/saydian-app-${timestamp}.dump"
