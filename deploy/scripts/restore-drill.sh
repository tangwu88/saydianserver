#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: restore-drill.sh /absolute/path/to/backup.dump" >&2
  exit 2
fi
backup=$1
test -f "$backup"
command -v docker >/dev/null 2>&1

container="saydian-restore-drill-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" -e POSTGRES_PASSWORD=restore-drill postgres:16-alpine >/dev/null
for attempt in $(seq 1 30); do
  docker exec "$container" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker cp "$backup" "$container:/tmp/restore.dump"
docker exec "$container" createdb -U postgres restored
docker exec "$container" pg_restore -U postgres -d restored --no-owner --no-privileges /tmp/restore.dump
docker exec "$container" psql -U postgres -d restored -Atc 'SELECT COUNT(*) FROM "User";'
echo "restore drill completed"
