#!/usr/bin/env bash
# Consistent source snapshot -> archive -> isolated restore -> all-table hashes.
# Only the newly created temporary container and its anonymous volume are removed.
set -Eeuo pipefail
umask 077
database=${1:?existing database container}
destination=${2:?new private backup directory}
[[ "$database" == saydian-global-global-postgres-1 || "$database" == saydianapp-production-postgres-1 ]]
[[ "$destination" == /opt/saydianapp-server/deploy/unified/backups/* && ! -e "$destination" ]]
install -d -m 700 "$destination"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
image=$(docker inspect -f '{{.Image}}' "$database")
temporary="saydian-restore-$(date -u +%Y%m%d%H%M%S)-$RANDOM"
created=false
cleanup() {
  exec 7>&- 8<&-
  if [[ "$created" == true ]]; then docker rm -fv "$temporary" > /dev/null; fi
  for pipe in "$destination/snapshot.in" "$destination/snapshot.out"; do [[ ! -p "$pipe" ]] || rm -- "$pipe"; done
}
trap cleanup EXIT
started=$SECONDS
mkfifo "$destination/snapshot.in" "$destination/snapshot.out"
docker exec -i "$database" sh -ec 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$destination/snapshot.in" > "$destination/snapshot.out" &
snapshot_pid=$!
exec 7>"$destination/snapshot.in" 8<"$destination/snapshot.out"
printf '%s\n' 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT pg_export_snapshot();' >&7
read -r snapshot <&8
[[ "$snapshot" =~ ^[0-9A-Fa-f-]+$ ]]
docker exec -e DUMP_SNAPSHOT="$snapshot" "$database" sh -ec 'exec pg_dump -Fc --no-owner --no-privileges --snapshot="$DUMP_SNAPSHOT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$destination/database.dump"
cat "$script_dir/database-fingerprint.sql" >&7
printf '\nCOMMIT;\n\\q\n' >&7
cat <&8 > "$destination/source.jsonl"
wait "$snapshot_pid"
test -s "$destination/database.dump"
sha256sum "$destination/database.dump" > "$destination/database.dump.sha256"
docker run -d --name "$temporary" --network none --label saydian.restore-drill=true \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore -e POSTGRES_USER=restore \
  --memory 512m --cpus 1 "$image" > /dev/null
created=true
ready=false
for _attempt in {1..30}; do
  if docker exec "$temporary" pg_isready -U restore -d restore > /dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
docker exec -i "$temporary" pg_restore --exit-on-error --no-owner --no-privileges -U restore -d restore < "$destination/database.dump"
docker exec -i "$temporary" psql -X -qAt -v ON_ERROR_STOP=1 -U restore -d restore < "$script_dir/database-fingerprint.sql" > "$destination/restored.jsonl"
cmp "$destination/source.jsonl" "$destination/restored.jsonl"
jq -se 'any(.[]; .invalidConstraints == 0)' "$destination/restored.jsonl" > /dev/null
sha256sum --check "$destination/database.dump.sha256"
jq -n --arg database "$database" --argjson elapsed "$((SECONDS - started))" '{database:$database, verified:true, elapsedSeconds:$elapsed}' > "$destination/restore-accepted.json"
echo "Backup and isolated restore verified for $database ($((SECONDS - started)) seconds)."
