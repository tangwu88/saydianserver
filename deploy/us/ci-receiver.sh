#!/usr/bin/env bash
# Install root-owned at /usr/local/sbin/saydian-us-ci-receiver.
# Forced SSH command: sudo -n /usr/local/sbin/saydian-us-ci-receiver "$SSH_ORIGINAL_COMMAND"
set -Eeuo pipefail
umask 077
root_dir=/opt/saydian-us
command=${1:-${SSH_ORIGINAL_COMMAND:-}}
if [[ "$command" == status ]]; then
  cat "$root_dir/deployed-revision" 2>/dev/null || echo unversioned
  exit 0
fi
[[ "$command" =~ ^(release|bootstrap)\ ([0-9a-f]{40})$ ]] || { echo 'Only release SHA, bootstrap SHA or status is allowed' >&2; exit 1; }
operation=${BASH_REMATCH[1]}
revision=${BASH_REMATCH[2]}
[[ "$(id -u)" == 0 && -d "$root_dir/private" ]]
mkdir -p "$root_dir/releases"
exec 9>"$root_dir/private/deploy.lock"
flock -n 9 || { echo 'Another release is running' >&2; exit 1; }
stage=$(mktemp -d "$root_dir/releases/ci-XXXXXXXX")
cleanup() {
  unset registry_token
  if [[ "$stage" == "$root_dir"/releases/ci-* ]]; then
    rm -f -- "$stage/docker/config.json"
  fi
}
trap cleanup EXIT
IFS= read -r registry_token
[[ -n "$registry_token" && ${#registry_token} -le 1024 ]]
# A disconnected sender must not leave the shared lock held indefinitely.
timeout --signal=TERM --kill-after=5s 600 head -c 10485761 > "$stage/bundle.tgz"
[[ "$(stat -c %s "$stage/bundle.tgz")" -le 10485760 ]]
tar -tzf "$stage/bundle.tgz" > "$stage/entries.txt"
while IFS= read -r file; do
  [[ "$file" == deploy/* && "$file" != *'..'* && "$file" != *'\\'* && "$file" != *'.env.production' && "$file" != */backups/* ]] || exit 1
done < "$stage/entries.txt"
if tar -tvzf "$stage/bundle.tgz" | grep -qvE '^[-d]'; then exit 1; fi
tar --no-same-owner --no-same-permissions -xzf "$stage/bundle.tgz" -C "$stage"
[[ -f "$stage/deploy/us/deploy.sh" ]]
export DOCKER_CONFIG="$stage/docker"
mkdir -m 700 "$DOCKER_CONFIG"
GITHUB_TOKEN="$registry_token" bash "$stage/deploy/scripts/ci-registry-login.sh" "$stage/deploy" >/dev/null
if [[ "$operation" == bootstrap ]]; then
  RELEASE_SHA="$revision" RELEASE_SOURCE="$stage" python3 "$stage/deploy/us/bootstrap.py"
else
  GITHUB_TOKEN="$registry_token" RELEASE_SHA="$revision" RELEASE_SOURCE="$stage" bash "$stage/deploy/us/deploy.sh"
fi
unset registry_token
