#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
if [ "$(readlink "/proc/$$/fd/9" 2>/dev/null || true)" != "$root_dir/deploy/.ci-release.lock" ]; then
  exec 9>"$root_dir/deploy/.ci-release.lock"
fi
flock -n 9
bash "$(dirname "$0")/care-privacy-gate.sh" legacy
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"
compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}
previous=$(cat "$root_dir/deploy/.previous-image-tag")
case "$previous" in
  *[!A-Za-z0-9._-]*|'') echo "no valid previous release" >&2; exit 1 ;;
esac
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$previous/" "$env_file"
sed -i "s/^MAINTENANCE_READ_ONLY=.*/MAINTENANCE_READ_ONLY=true/" "$env_file"
set -a
. "$env_file"
set +a
if [ "${PRIVATE_IMAGES_PRELOADED:-false}" = "true" ]; then
  DEPLOY_ROOT="$root_dir" deploy/scripts/check-runtime-images.sh
else
  compose pull api worker admin
fi
compose up -d --force-recreate api worker admin
if [ "${USE_SHARED_GATEWAY:-false}" != "true" ]; then
  compose pull caddy
  compose up -d --force-recreate caddy
fi
echo "rolled back to $previous in read-only mode"
