#!/usr/bin/env bash
# Install root-owned at /usr/local/sbin/saydianapp-ci-receiver.
# Forced SSH command: sudo -n /usr/local/sbin/saydianapp-ci-receiver "$SSH_ORIGINAL_COMMAND"
set -Eeuo pipefail
umask 077
root_dir=/opt/saydianapp-server
command=${1:-${SSH_ORIGINAL_COMMAND:-}}
if [[ "$command" == status ]]; then
  cat "$root_dir/deploy/.deployed-revision" 2>/dev/null || echo unversioned
  exit 0
fi
[[ "$command" =~ ^release\ ([0-9a-f]{40})$ ]] || { echo 'Only release SHA or status is allowed' >&2; exit 1; }
revision=${BASH_REMATCH[1]}
[[ "$(id -u)" == 0 && -d "$root_dir/deploy" ]]
mkdir -p "$root_dir/releases"
exec 9>"$root_dir/deploy/.ci-release.lock"
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
head -c 10485761 > "$stage/bundle.tgz"
[[ "$(stat -c %s "$stage/bundle.tgz")" -le 10485760 ]]
tar -tzf "$stage/bundle.tgz" > "$stage/entries.txt"
while IFS= read -r file; do
  [[ "$file" == deploy/* && "$file" != *'..'* && "$file" != *'\\'* && "$file" != *'.env.production' && "$file" != */backups/* ]] || exit 1
done < "$stage/entries.txt"
if tar -tvzf "$stage/bundle.tgz" | grep -qvE '^[-d]'; then exit 1; fi
tar --no-same-owner --no-same-permissions -xzf "$stage/bundle.tgz" -C "$stage"
[[ -f "$stage/deploy/scripts/deploy-ci.sh" ]]
export DOCKER_CONFIG="$stage/docker"
mkdir -m 700 "$DOCKER_CONFIG"
printf '%s' "$registry_token" | docker login ghcr.io -u saydian88-cmyk --password-stdin >/dev/null
unset registry_token
DEPLOY_ROOT="$root_dir" RELEASE_SHA="$revision" RELEASE_SOURCE="$stage" bash "$stage/deploy/scripts/deploy-ci.sh"
