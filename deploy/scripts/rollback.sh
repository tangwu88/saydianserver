#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"
previous=$(cat "$root_dir/deploy/.previous-image-tag")
case "$previous" in
  *[!A-Za-z0-9._-]*|'') echo "no valid previous release" >&2; exit 1 ;;
esac
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$previous/" "$env_file"
sed -i "s/^MAINTENANCE_READ_ONLY=.*/MAINTENANCE_READ_ONLY=true/" "$env_file"
docker compose --env-file "$env_file" -f "$compose_file" pull
docker compose --env-file "$env_file" -f "$compose_file" up -d --force-recreate api worker admin
echo "rolled back to $previous in read-only mode"
