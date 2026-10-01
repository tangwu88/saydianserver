#!/usr/bin/env bash
# Disposable GitHub-hosted runner only; never point this fixture at production.
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
source_container=saydianapp-production-postgres-1
if docker container inspect "$source_container" >/dev/null 2>&1; then echo 'Fixture container already exists; refusing to reuse it.' >&2; exit 1; fi
created=false
cleanup() { if [[ "$created" == true ]]; then docker rm -fv "$source_container" >/dev/null; fi; }
trap cleanup EXIT
docker run -d --name "$source_container" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=fixture -e POSTGRES_USER=fixture \
  postgres:16-alpine >/dev/null
created=true
ready=false
for _attempt in {1..30}; do
  if docker exec "$source_container" psql -X -qAt -h 127.0.0.1 -U fixture -d fixture -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
# Only the runner's sanitized migrated database is copied into the fixture.
docker run --rm --network host -e PGPASSWORD=local-ci-password postgres:16-alpine \
  pg_dump -Fc --no-owner --no-privileges -h 127.0.0.1 -U saydian -d saydian_app_test |
  docker exec -i "$source_container" pg_restore --exit-on-error --no-owner --no-privileges -U fixture -d fixture
backup_root=/opt/saydianapp-server/deploy/unified/backups
sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" "$backup_root"
bash deploy/scripts/backup-restore.sh "$source_container" "$backup_root/ci-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
