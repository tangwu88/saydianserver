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
[[ $(sha256sum "$directory/release-manifest.json" | cut -d' ' -f1) == 33509f0ba7d54c4e387bc32581d3d3e45d0f95e1ed4a701e2d3e5906f335d61a ]]
node deploy/scripts/release-manifest.mjs verify "$revision" "$directory/release-manifest.json"
scratch=$(mktemp -d)
cleanup() {
  rm -rf -- "$scratch"
}
trap cleanup EXIT
install -d -m 700 "$scratch/payload/deploy/scripts"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$scratch/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$scratch/known_hosts"
chmod 600 "$scratch/key" "$scratch/known_hosts"
payload="$scratch/payload/deploy"
cp "$directory/release-manifest.json" "$directory/module-release-scope.json" "$payload/"
printf '%s\n' '{"artifactId":"12140071512","action":"import","sizeBytes":368019130,"digest":"sha256:eb32f72523215dfd6df79ee4aada0395cd62b26cdd81986ab0f52fdd137a7db1"}' > "$payload/runtime-artifact.json"
cp deploy/scripts/receive-module-cache-recovery.sh "$payload/scripts/deploy-ci.sh"
cp deploy/scripts/receive-runtime-artifact.sh deploy/scripts/runtime-artifact.mjs deploy/scripts/verify-runtime-artifact.py \
  deploy/scripts/receive-offline-images.sh deploy/scripts/offline-image-transfer.mjs \
  deploy/scripts/release-manifest.mjs deploy/scripts/module-release-scope.mjs deploy/scripts/ci-registry-login.sh "$payload/scripts/"
tar -C "$scratch/payload" -czf "$scratch/bundle.tgz" deploy
test "$(stat -c %s "$scratch/bundle.tgz")" -le 10485760
{ printf '%s\n' "$GH_TOKEN"; cat "$scratch/bundle.tgz"; } | \
  ssh -i "$scratch/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
    -o UserKnownHostsFile="$scratch/known_hosts" -o ConnectTimeout=15 \
    -o ServerAliveInterval=20 -o ServerAliveCountMax=15 \
    "$DEPLOY_USER@$DEPLOY_HOST" "release $revision"
latest
echo 'Original approved module images cached. No application deployed; rerun the original failed deploy job.'
