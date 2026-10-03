#!/usr/bin/env bash
# Small diagnostic bundle only; never sends, imports or deploys runtime images.
set -Eeuo pipefail
revision=${1:?}
export_dir=${2:?}
artifact_id=${3:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$artifact_id" =~ ^[1-9][0-9]*$ && "${GITHUB_ACTIONS:-}" == true ]]
[[ "${DEPLOY_HOST:-}" == 49.232.231.131 && "${DEPLOY_USER:-}" =~ ^[a-z_][a-z0-9_-]*$ ]]
test -n "${DEPLOY_SSH_KEY:-}" && test -n "${DEPLOY_KNOWN_HOSTS:-}" && test -n "${GH_TOKEN:-}"
test "$(gh api repos/tangwu88/saydianserver/git/ref/heads/main --jq .object.sha)" = "$revision"
node deploy/scripts/release-manifest.mjs verify "$revision" "$export_dir/release-manifest.json"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir -p "$scratch/payload/deploy/scripts"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$scratch/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$scratch/known_hosts"
chmod 600 "$scratch/key" "$scratch/known_hosts"
cp "$export_dir/release-manifest.json" "$scratch/payload/deploy/"
printf '{"artifactId":"%s"}\n' "$artifact_id" > "$scratch/payload/deploy/artifact-probe.json"
cp deploy/scripts/ci-registry-login.sh deploy/scripts/probe-runtime-artifact.mjs "$scratch/payload/deploy/scripts/"
cp deploy/scripts/receive-artifact-probe.sh "$scratch/payload/deploy/scripts/deploy-ci.sh"
tar -C "$scratch/payload" -czf "$scratch/bundle.tgz" deploy
test "$(stat -c %s "$scratch/bundle.tgz")" -le 10485760
{ printf '%s\n' "$GH_TOKEN"; cat "$scratch/bundle.tgz"; } | \
  ssh -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$scratch/known_hosts" -o ConnectTimeout=15 \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=15 \
    "$DEPLOY_USER@$DEPLOY_HOST" "release $revision"
