#!/usr/bin/env bash
# Only small control files travel over SSH; HTTPS import is an explicit recovery action.
set -Eeuo pipefail
revision=${1:?}
export_dir=${2:?}
artifact_id=${3:?}
action=${4:-probe}
[[ "$action" == probe || "$action" == import ]]
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
gh api "repos/tangwu88/saydianserver/actions/artifacts/$artifact_id" --jq '{artifactId:(.id|tostring),name,sizeBytes:.size_in_bytes,digest,expired}' | jq --arg action "$action" --arg revision "$revision" -e 'select(.name == ("runtime-images-" + $revision) and .expired == false) + {action:$action}' > "$scratch/payload/deploy/runtime-artifact.json"
cp deploy/scripts/ci-registry-login.sh deploy/scripts/runtime-artifact.mjs deploy/scripts/release-manifest.mjs deploy/scripts/offline-image-transfer.mjs deploy/scripts/receive-offline-images.sh deploy/scripts/verify-runtime-artifact.py "$scratch/payload/deploy/scripts/"
cp deploy/scripts/receive-runtime-artifact.sh "$scratch/payload/deploy/scripts/deploy-ci.sh"
tar -C "$scratch/payload" -czf "$scratch/bundle.tgz" deploy
test "$(stat -c %s "$scratch/bundle.tgz")" -le 10485760
{ printf '%s\n' "$GH_TOKEN"; cat "$scratch/bundle.tgz"; } | \
  ssh -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$scratch/known_hosts" -o ConnectTimeout=15 \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=15 \
    "$DEPLOY_USER@$DEPLOY_HOST" "release $revision"
