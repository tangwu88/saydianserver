#!/usr/bin/env bash
# Sourced only by the locked unified publisher. No override/compatibility env bit.
care_active=false
care_seen=false
care_uncertain=false
care_legacy_entry=false
care_schema=unknown
care_metadata() {
  docker run --rm -i --user 0:0 --network none --read-only --entrypoint node \
    -v "$source_dir/deploy:/release:ro" "$runtime" /release/scripts/care-privacy-topology.mjs "$1"
}
care_read_schema() {
  local value
  if [[ "${care_legacy_entry:-false}" != true ]]; then
    if ! docker inspect "$current_api" "$database" | care_metadata sanitize > "$source_dir/care-database-scope.json" ||
      ! node_tool /release/scripts/care-privacy-topology.mjs database-scope /work/care-database-scope.json >/dev/null; then
      care_uncertain=true; echo 'Care privacy database scope cannot be proven.' >&2; return 1
    fi
  fi
  if ! value=$(sql "$database" < "$source_dir/deploy/scripts/care-privacy-schema.sql"); then
    care_uncertain=true; echo 'Care privacy schema query failed; restart refused.' >&2; return 1
  fi
  if [[ "$value" != legacy && "$value" != protected ]] || [[ "$care_seen" == true && "$value" != protected ]]; then
    care_uncertain=true; echo 'Care privacy schema is unknown; restart refused.' >&2; return 1
  fi
  care_schema=$value
  if [[ "$value" == protected ]]; then care_seen=true; fi
}
care_prove_image() {
  local image=$1 role=$2 result
  [[ "$image" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  result=$(timeout --signal=TERM --kill-after=5s 45 docker run --rm --user 0:0 --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --entrypoint node -v "$source_dir/deploy:/release:ro" "$image" /release/scripts/care-privacy-proof.cjs "$role") || return 1
  [[ "$result" == "care-privacy-proof:$role" ]]
}
care_prove_images() {
  local images=$1 role image
  for role in api worker; do
    image=$(jq -er --arg role "global-$role" '.services[$role].image' "$images") || return 1
    # The deployment file must pin actual identities, not a mutable tag/label.
    if [[ "$image" != sha256:* ]]; then
      [[ "$image" =~ ^ghcr\.io/tangwu88/saydianserver-$role@sha256:[a-f0-9]{64}$ ]] || return 1
      image=$(docker image inspect -f '{{.Id}}' "$image") || return 1
    fi
    care_prove_image "$image" "$role" || { echo 'Care privacy image proof failed; restart refused.' >&2; return 1; }
  done
}
care_one_publisher() {
  local unit state
  for unit in saydian-global-auto-deploy.timer saydian-global-auto-deploy.service; do
    state=$(systemctl show "$unit" -p LoadState -p ActiveState -p UnitFileState) || return 1
    if grep -Fxq 'LoadState=not-found' <<< "$state"; then continue; fi
    grep -Fxq 'LoadState=loaded' <<< "$state" && grep -Fxq 'ActiveState=inactive' <<< "$state" || return 1
    if [[ "$unit" == *.timer ]]; then grep -Eq '^UnitFileState=(disabled|masked)$' <<< "$state" || return 1; fi
  done
}
care_topology() {
  local phase=$1 config=$2 images=$3 ids role running
  ids=$(docker ps -aq --no-trunc) || return 1
  [[ -n "$ids" && "$ids" =~ ^[a-f0-9[:space:]]+$ ]] || return 1
  # Only validated hexadecimal container IDs are split here. Evidence is private.
  docker inspect $ids | care_metadata sanitize > "$source_dir/care-inventory.json" || return 1
  docker compose -f "$config" -f "$images" config --format json | care_metadata sanitize-compose > "$source_dir/care-compose.json" || return 1
  for role in api worker; do
    : > "$source_dir/care-$role-processes.txt"
    running=$(docker inspect -f '{{.State.Running}}' "saydian-global-global-$role-1") || return 1
    [[ "$running" == true || "$running" == false ]] || return 1
    if [[ "$running" == true ]]; then docker top "saydian-global-global-$role-1" -eo pid,args | awk '/(^|[[:space:]\/])node(js)?[[:space:]]/ {print "node"}' > "$source_dir/care-$role-processes.txt" || return 1; fi
  done
  node_tool /release/scripts/care-privacy-topology.mjs "$phase" /work/care-inventory.json /work/care-compose.json /work/care-api-processes.txt /work/care-worker-processes.txt
}
care_quiesce() {
  local config=$1 images=$2
  care_one_publisher || return 1
  care_topology present "$config" "$images" || return 1
  # A stop waits for the managed processes to exit, rather than only changing a
  # flag while requests/transactions are still in flight. Never stop other apps.
  changed=true
  docker compose -f "$config" -f "$images" stop -t 180 global-api global-worker || return 1
  care_topology stopped "$config" "$images" || return 1
  care_drained
}
care_drained() {
  local sessions
  sessions=$(sql "$database" <<< "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';") || return 1
  [[ "$sessions" == 0 ]] || { care_uncertain=true; echo 'Care privacy database sessions have not drained.' >&2; return 1; }
}
care_prepare() {
  care_read_schema || return 1
  local planned
  planned=$(jq -er 'any(.migrations[]; .name == "20261018070000_care_identity_disclosure")' "$manifest") || [[ "$planned" == false ]] || return 1
  if [[ "$care_schema" == protected || "$planned" == true ]]; then
    care_active=true
    [[ "$first" == false ]] || { echo 'Care privacy requires an accepted single-stack cutover.' >&2; return 1; }
    care_prove_images "$source_dir/images.json" || return 1
    care_one_publisher || { care_uncertain=true; echo 'Care privacy single publisher cannot be proven.' >&2; return 1; }
    care_topology present "$base_compose" "$source_dir/images.json" || { care_uncertain=true; return 1; }
  fi
}
care_before_migration() {
  care_read_schema || return 1
  if [[ "$care_schema" == protected && "$care_active" != true ]]; then
    care_active=true
    [[ "$first" == false ]] || return 1
    care_prove_images "$source_dir/images.json" || return 1
  fi
  if [[ "$care_active" == true ]]; then
    care_quiesce "$base_compose" "$source_dir/images.json" || { care_uncertain=true; return 1; }
  fi
}
care_before_start() {
  care_read_schema || return 1
  if [[ "$care_active" == true ]]; then
    [[ "$care_schema" == protected ]] || { care_uncertain=true; return 1; }
    care_one_publisher && care_drained || { care_uncertain=true; return 1; }
    care_topology stopped "$base_compose" "$source_dir/images.json" || { care_uncertain=true; return 1; }
  fi
}
care_after_start() {
  if [[ "$care_active" == true ]]; then
    care_verify_running "$base_compose" "$source_dir/images.json" || { care_uncertain=true; return 1; }
  fi
}
care_verify_running() {
  local config=$1 images=$2 role expected actual
  care_read_schema && [[ "$care_schema" == protected ]] && care_topology running "$config" "$images" || return 1
  for role in api worker; do
    expected=$(jq -er --arg role "global-$role" '.services[$role].image' "$images") || return 1
    if [[ "$expected" != sha256:* ]]; then
      [[ "$expected" =~ ^ghcr\.io/tangwu88/saydianserver-$role@sha256:[a-f0-9]{64}$ ]] || return 1
      expected=$(docker image inspect -f '{{.Id}}' "$expected") || return 1
    fi
    actual=$(docker inspect -f '{{.Image}}' "saydian-global-global-$role-1") || return 1
    [[ "$expected" == "$actual" ]] || return 1
  done
}
care_allow_rollback() {
  [[ "$care_uncertain" == false ]] || return 1
  care_read_schema || return 1
  if [[ "$care_schema" == protected ]]; then
    [[ "$first" == false ]] || return 1
    care_prove_images "$backup/images.json" || return 1
    care_quiesce "$backup/compose.json" "$backup/images.json" || return 1
    # Recheck after the stop; a row-count snapshot is deliberately insufficient.
    care_read_schema && [[ "$care_schema" == protected ]] || return 1
    care_one_publisher || return 1
  fi
}

# Obsolete domestic entrypoints must not bypass the unified publisher's lock,
# topology and behavioral checks after this schema boundary. Legacy DBs retain
# their old path; a known-absent database is allowed only before first setup.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  [[ "${1:-}" == legacy ]] || exit 1
  source_dir=$(cd "$(dirname "$0")/../.." && pwd)
  care_legacy_entry=true
  sql() { docker exec -i "$1" sh -ec 'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
  containers=$(docker ps -a --format '{{.Names}}') || exit 1
  for database in saydian-global-global-postgres-1 saydianapp-production-postgres-1; do
    if grep -Fxq "$database" <<< "$containers"; then
      care_read_schema && [[ "$care_schema" == legacy ]] || { echo 'Care privacy requires the locked unified publisher; legacy entry refused.' >&2; exit 1; }
    fi
  done
fi
