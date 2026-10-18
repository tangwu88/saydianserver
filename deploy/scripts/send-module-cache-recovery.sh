#!/usr/bin/env bash
# Original accepted artifact only. Ordinary main transport guards are unchanged.
set -Eeuo pipefail
revision=dcc9d2aefeb42b3a0345868a5debc51e8625b213
directory=${1:?}
[[ ${GITHUB_ACTIONS:-} == true && ${GITHUB_REPOSITORY:-} == tangwu88/saydianserver ]]
[[ ${GITHUB_REF:-} == refs/heads/codex/say-ring-module-cache-recovery-20261018 ]]
[[ ${DEPLOY_HOST:-} == 49.232.231.131 && ${DEPLOY_USER:-} =~ ^[a-z_][a-z0-9_-]*$ ]]
test -n "${DEPLOY_SSH_KEY:-}" && test -n "${DEPLOY_KNOWN_HOSTS:-}" && test -n "${GH_TOKEN:-}"
latest() { [[ $(gh api repos/tangwu88/saydianserver/git/ref/heads/codex/say-ring-module-visibility-20261018 --jq .object.sha) == "$revision" ]]; }
latest
archive="$directory/saydianapp-runtime-images-$revision.tar.gz"
[[ $(sha256sum "$archive" | cut -d' ' -f1) == 6d01c4a906e5482da38d9531d2c33116c31638fb39784e7dc273d312602494a0 ]]
[[ $(sha256sum "$directory/release-manifest.json" | cut -d' ' -f1) == 33509f0ba7d54c4e387bc32581d3d3e45d0f95e1ed4a701e2d3e5906f335d61a ]]
node deploy/scripts/release-manifest.mjs verify "$revision" "$directory/release-manifest.json"
scratch=$(mktemp -d)
cleanup() {
  ssh -S "$scratch/control" -O exit "$DEPLOY_USER@$DEPLOY_HOST" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
install -d -m 700 "$scratch/chunks" "$scratch/payload/deploy/scripts"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$scratch/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$scratch/known_hosts"
chmod 600 "$scratch/key" "$scratch/known_hosts"
split -b 8388608 -d -a 3 "$archive" "$scratch/chunks/chunk-"
payload="$scratch/payload/deploy"
cp "$directory/release-manifest.json" "$directory/module-release-scope.json" "$payload/"
cp deploy/scripts/receive-module-cache-recovery.sh "$payload/scripts/deploy-ci.sh"
cp deploy/scripts/receive-offline-images.sh deploy/scripts/offline-image-transfer.mjs \
  deploy/scripts/release-manifest.mjs deploy/scripts/module-release-scope.mjs deploy/scripts/ci-registry-login.sh "$payload/scripts/"
node deploy/scripts/offline-image-transfer.mjs create "$revision" "$payload/release-manifest.json" "$payload/offline-transfer.json" "$archive" "$scratch/chunks"
for chunk in "$scratch"/chunks/chunk-*; do
  latest
  cp "$chunk" "$payload/image-chunk"
  basename "$chunk" > "$payload/chunk-name"
  tar -C "$scratch/payload" -czf "$scratch/bundle.tgz" deploy
  test "$(stat -c %s "$scratch/bundle.tgz")" -le 10485760
  { printf '%s\n' "$GH_TOKEN"; cat "$scratch/bundle.tgz"; } | \
    ssh -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
      -o UserKnownHostsFile="$scratch/known_hosts" -o ConnectTimeout=15 \
      -o ControlMaster=auto -o ControlPath="$scratch/control" -o ControlPersist=30 \
      -o ServerAliveInterval=20 -o ServerAliveCountMax=15 \
      "$DEPLOY_USER@$DEPLOY_HOST" "release $revision"
done
latest
echo 'Original approved module images cached. No application deployed; rerun the original failed deploy job.'
