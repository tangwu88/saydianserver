#!/usr/bin/env bash
# Manual-only follow-up to a verified domestic deployment. Never edits the
# installed international service, timer, credentials, configuration or database.
set -Eeuo pipefail
set +x
expected_global=${1:-}
expected_domestic=${2:-}
[[ $# -eq 2 && "$expected_global" =~ ^[0-9a-f]{40}$ && "$expected_domestic" =~ ^[0-9a-f]{40}$ ]] || {
  echo 'Two complete verified domestic/global revisions are required.' >&2; exit 1;
}
[[ "$(id -u)" == 0 ]] || { echo 'The constrained deployment receiver must invoke this helper.' >&2; exit 1; }
service=saydian-global-auto-deploy.service
timer=saydian-global-auto-deploy.timer
# Historical records establish the timer, not its on-disk unit/config paths.
# Discover the installed relationship and reject any unexpected target.
[[ "$(timeout 15s systemctl show "$timer" --property=Unit --value)" == "$service" ]] || {
  echo 'The installed global timer does not select the expected deployment service.' >&2; exit 1;
}
[[ "$(timeout 15s systemctl show "$service" --property=LoadState --value)" == loaded ]] || {
  echo 'The existing international deployment service is not loaded.' >&2; exit 1;
}
latest=$(timeout 30s git ls-remote https://github.com/tangwu88/saydianserver.git refs/heads/codex/global-api-foundation | awk '{print $1}')
[[ "$latest" == "$expected_global" ]] || { echo 'The international branch changed; no deployment requested.' >&2; exit 1; }

readiness_revision() {
  local response revision
  response=$(curl --fail --silent --max-time 15 --max-filesize 4096 "$1") || return 1
  grep -Eq '"status"[[:space:]]*:[[:space:]]*"ready"' <<< "$response" || return 1
  grep -Eq '"database"[[:space:]]*:[[:space:]]*"ok"' <<< "$response" || return 1
  revision=$(sed -nE 's/.*"revision"[[:space:]]*:[[:space:]]*"([0-9a-f]{40})".*/\1/p' <<< "$response")
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || return 1
  printf '%s\n' "$revision"
}
runtime_flags() {
  local project=$1 component=$2 container flags maintenance
  container=$(timeout 15s docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$component") || return 1
  [[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || return 1
  # Filter in the pipe before returning data. Never print the full environment.
  flags=$(timeout 15s docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | sed -nE '/^(MAINTENANCE_READ_ONLY|BUSINESS_WRITES_PAUSED)=(true|false)$/p' | sort) || return 1
  maintenance=$(sed -n 's/^MAINTENANCE_READ_ONLY=//p' <<< "$flags")
  [[ "$maintenance" == true || "$maintenance" == false ]] || return 1
  printf '%s\n' "$flags"
}
snapshot_flags() {
  local pair
  for pair in 'saydianapp-production api' 'saydianapp-production worker' 'saydian-global global-api' 'saydian-global global-worker'; do
    # Values are fixed literals declared immediately above, never external input.
    read -r project component <<< "$pair"
    printf '%s/%s\n' "$project" "$component"
    runtime_flags "$project" "$component" || return 1
  done
}
show_service_state() {
  # Restrict output to state and numeric exit metadata; no journal or environment.
  timeout 15s systemctl show "$service" --property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus
}
domestic_before=$(readiness_revision https://app.saydian.cn/health/ready)
[[ "$domestic_before" == "$expected_domestic" ]] || { echo 'Domestic revision changed before the international operation.' >&2; exit 1; }
global_before=$(readiness_revision https://app.saydian.cn/global/health/ready)
flags_before=$(snapshot_flags) || { echo 'Cannot establish both realms runtime maintenance flags.' >&2; exit 1; }
finish() {
  local code=$1 flags_after domestic_after
  trap - EXIT
  show_service_state || code=1
  flags_after=$(snapshot_flags) || code=1
  domestic_after=$(readiness_revision https://app.saydian.cn/health/ready) || code=1
  if [[ "$flags_after" != "$flags_before" || "$domestic_after" != "$domestic_before" ]]; then
    echo 'International operation did not preserve domestic revision or runtime maintenance flags; inspect the retained server release state.' >&2
    code=1
  fi
  exit "$code"
}
trap 'finish $?' EXIT
if [[ "$global_before" == "$expected_global" ]]; then
  echo "International revision already verified: $expected_global; no service start needed."
  exit 0
fi
started_before=$(timeout 15s systemctl show "$service" --property=ExecMainStartTimestampMonotonic --value)
[[ "$started_before" =~ ^[0-9]+$ ]] || exit 1
state_before=$(timeout 15s systemctl show "$service" --property=ActiveState --value)
if [[ "$state_before" != activating && "$state_before" != active ]]; then
  # --no-block queues only this existing unit; waiting below is bounded and never
  # cancels a deployment that may still be safely building when the wait expires.
  timeout 15s systemctl start --no-block "$service"
fi
deadline=$((SECONDS + 840))
while (( SECONDS < deadline )); do
  state=$(timeout 15s systemctl show "$service" --property=ActiveState --value)
  substate=$(timeout 15s systemctl show "$service" --property=SubState --value)
  started=$(timeout 15s systemctl show "$service" --property=ExecMainStartTimestampMonotonic --value)
  if [[ "$state" == failed && "$(timeout 15s systemctl show "$service" --property=Result --value)" == start-limit-hit ]]; then
    echo 'The installed international deployer reached its start limit; no reset or service changes were attempted.' >&2; exit 1
  fi
  if [[ "$started" != "$started_before" || "$state_before" == activating || "$state_before" == active ]]; then
    if [[ "$state" == failed ]]; then
      echo 'The installed international deployer failed; domestic deployment remains committed.' >&2; exit 1
    fi
    if [[ "$state" == inactive || ( "$state" == active && "$substate" == exited ) ]]; then
      [[ "$(timeout 15s systemctl show "$service" --property=Result --value)" == success ]]
      [[ "$(timeout 15s systemctl show "$service" --property=ExecMainStatus --value)" == 0 ]]
      [[ "$(readiness_revision https://app.saydian.cn/global/health/ready)" == "$expected_global" ]] || {
        echo 'International service finished but its public revision differs from the requested source.' >&2; exit 1;
      }
      echo "Verified international revision: $expected_global; domestic revision and maintenance flags will be rechecked."
      exit 0
    fi
  fi
  sleep 5
done
echo 'International verification timed out after 14 minutes; the existing service was left running. Do not claim deployment until its public revision matches.' >&2
exit 124
