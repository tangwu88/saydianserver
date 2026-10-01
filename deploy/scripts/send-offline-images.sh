#!/usr/bin/env bash
# GitHub-hosted runner only: send verified original images through the existing receiver.
set -Eeuo pipefail
revision=${1:?}
export_dir=${2:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ && "${GITHUB_ACTIONS:-}" == true ]]
[[ "${DEPLOY_HOST:-}" == 49.232.231.131 && "${DEPLOY_USER:-}" =~ ^[a-z_][a-z0-9_-]*$ ]]
test -n "${DEPLOY_SSH_KEY:-}" && test -n "${DEPLOY_KNOWN_HOSTS:-}" && test -n "${GH_TOKEN:-}"
test "$(gh api repos/tangwu88/saydianserver/git/ref/heads/main --jq .object.sha)" = "$revision"
archive="$export_dir/saydianapp-runtime-images-$revision.tar.gz"
sha256sum --check "$archive.sha256"
node deploy/scripts/release-manifest.mjs verify "$revision" "$export_dir/release-manifest.json"
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
mkdir "$scratch/chunks" "$scratch/payload" "$scratch/payload/deploy" "$scratch/payload/deploy/scripts"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$scratch/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$scratch/known_hosts"
chmod 600 "$scratch/key" "$scratch/known_hosts"
split -b 8388608 -d -a 3 "$archive" "$scratch/chunks/chunk-"
payload="$scratch/payload/deploy"
cp "$export_dir/release-manifest.json" "$payload/release-manifest.json"
cp deploy/scripts/receive-offline-images.sh "$payload/scripts/deploy-ci.sh"
cp deploy/scripts/offline-image-transfer.mjs deploy/scripts/release-manifest.mjs "$payload/scripts/"
node deploy/scripts/offline-image-transfer.mjs create "$revision" "$payload/release-manifest.json" "$payload/offline-transfer.json" "$archive" "$scratch/chunks"
for chunk in "$scratch"/chunks/chunk-*; do
  cp "$chunk" "$payload/image-chunk"
  basename "$chunk" > "$payload/chunk-name"
  tar -C "$scratch/payload" -czf "$scratch/bundle.tgz" deploy
  test "$(stat -c %s "$scratch/bundle.tgz")" -le 10485760
  { printf '%s\n' "$GH_TOKEN"; cat "$scratch/bundle.tgz"; } | \
    ssh -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile="$scratch/known_hosts" -o ConnectTimeout=15 \
      -o ServerAliveInterval=20 -o ServerAliveCountMax=15 \
      "$DEPLOY_USER@$DEPLOY_HOST" "release $revision"
done
test "$(gh api repos/tangwu88/saydianserver/git/ref/heads/main --jq .object.sha)" = "$revision"
echo 'Verified original images are loaded. Run Deploy production with offline_images=true.'
