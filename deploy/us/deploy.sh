#!/usr/bin/env bash
# Invoked only by the independent, root-owned US receiver after successful CI.
set -Eeuo pipefail
umask 077
root_dir=/opt/saydian-us
revision=${RELEASE_SHA:?Verified revision required}
source_dir=${RELEASE_SOURCE:?Receiver staging directory required}
[[ $(id -u) == 0 && "$revision" =~ ^[a-f0-9]{40}$ ]]
[[ "$source_dir" == "$root_dir"/releases/ci-* && -d "$source_dir" ]]
state="$root_dir/private/accepted-state.json"
env_file="$root_dir/private/runtime.env"
[[ -f "$state" && -f "$env_file" ]]
python3 "$source_dir/deploy/us/capacity.py" "$revision" "$source_dir/deploy/release-manifest.json" "$state" "$root_dir"
python3 - "$state" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
assert all(s.get(k) is True for k in ['restoreAccepted','accountSelectionAccepted','filesVerified']), 'US migration and restore acceptance missing'
PY
next="$source_dir/deploy/us/images.env"
python3 - "$source_dir/deploy/release-manifest.json" "$next" <<'PY'
import json,sys
m=json.load(open(sys.argv[1]))
with open(sys.argv[2],'x') as f:
 f.write('US_REVISION='+m['revision']+'\n')
 for name,image in m['images'].items(): f.write('US_'+name.upper()+'_IMAGE='+image['ref']+'\n')
PY
compose=(docker compose --project-name saydian-us --env-file "$env_file" --env-file "$next" -f "$source_dir/deploy/us/compose.json")
"${compose[@]}" config --quiet
"${compose[@]}" pull us-api us-worker us-admin
# Validate schema history with the exact API image. Do not apply unreviewed SQL.
docker exec -i saydian-us-us-postgres-1 psql -U us_owner -d saydian_us -At > "$source_dir/history.json" <<'SQL'
SELECT coalesce(json_agg(t), '[]'::json)::text FROM (SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations") t;
SQL
api_image=$(sed -n 's/^US_API_IMAGE=//p' "$next")
docker run --rm --network none --read-only --memory 128m -v "$source_dir:/release:ro" --entrypoint node "$api_image" --input-type=module -e '
import {readFileSync} from "node:fs";
import {validateManifest,verifyMigrationHistory} from "/release/deploy/scripts/release-manifest.mjs";
const m=validateManifest(JSON.parse(readFileSync("/release/deploy/release-manifest.json")),process.argv[1]);
if(verifyMigrationHistory(m,JSON.parse(readFileSync("/release/history.json"))).length) throw Error("US schema update requires separate reviewed execution");
' "$revision"
python3 - "$root_dir" <<'PY'
import os,sys
s=os.statvfs(sys.argv[1])
assert s.f_bavail*s.f_frsize>=5*1024**3, 'Post-pull 5GiB reserve breached'
PY
previous=$(readlink -f "$root_dir/current" || true)
rollback() {
  if [[ "$previous" == "$root_dir"/releases/* && -f "$previous/deploy/us/images.env" ]]; then
    docker compose --project-name saydian-us --env-file "$env_file" --env-file "$previous/deploy/us/images.env" -f "$previous/deploy/us/compose.json" up -d --no-deps us-api us-worker us-admin
  fi
}
trap 'rollback' ERR
"${compose[@]}" up -d --no-deps --wait --wait-timeout 180 us-api us-worker us-admin
for path in /health/ready /global/health/ready; do
  curl --fail --silent --max-time 15 "https://app.saydian.com$path" | python3 -c 'import json,sys; assert json.load(sys.stdin)["revision"]==sys.argv[1]' "$revision"
done
ln -s "$source_dir" "$root_dir/current.next"
mv -Tf "$root_dir/current.next" "$root_dir/current"
printf '%s\n' "$revision" > "$root_dir/deployed-revision"
trap - ERR
echo "US program deployed; database and files retained"
