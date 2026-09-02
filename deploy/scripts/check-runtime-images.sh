#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
env_file="$root_dir/deploy/.env.production"
compose_file="$root_dir/deploy/compose.production.yaml"

expected=0
missing=0
for image in $(docker compose --env-file "$env_file" -f "$compose_file" config --images); do
  case "$image" in
    ghcr.io/saydian88-cmyk/saydianapp-server-api:*|\
    ghcr.io/saydian88-cmyk/saydianapp-server-worker:*|\
    ghcr.io/saydian88-cmyk/saydianapp-server-admin:*)
      expected=$((expected + 1))
      if ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "missing preloaded runtime image: $image" >&2
        missing=$((missing + 1))
      fi
      ;;
  esac
done

if [ "$expected" -ne 3 ]; then
  echo "expected three private runtime images, found $expected" >&2
  exit 1
fi
if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "three private runtime images are available locally"
