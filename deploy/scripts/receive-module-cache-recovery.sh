#!/usr/bin/env bash
# Exact one-time cache import; never deploys an application or changes a setting.
set -Eeuo pipefail
revision=dcc9d2aefeb42b3a0345868a5debc51e8625b213
root=/opt/saydianapp-server
[[ ${RELEASE_SHA:-} == "$revision" && ${RELEASE_SOURCE:-} == "$root"/releases/ci-* ]]
[[ $(readlink /proc/$$/fd/9) == "$root/deploy/.ci-release.lock" ]]
flock -n 9
payload="$RELEASE_SOURCE/deploy"
[[ $(sha256sum "$payload/release-manifest.json" | cut -d' ' -f1) == 33509f0ba7d54c4e387bc32581d3d3e45d0f95e1ed4a701e2d3e5906f335d61a ]]
jq -e '.artifactId == "12140071512" and .action == "import" and .sizeBytes == 368019130 and .digest == "sha256:eb32f72523215dfd6df79ee4aada0395cd62b26cdd81986ab0f52fdd137a7db1"' "$payload/runtime-artifact.json" > /dev/null
runtime=$(docker inspect -f '{{.Image}}' saydian-global-global-api-1)
docker run --rm --user 0:0 --network none --read-only --entrypoint node \
  -v "$payload:/release:ro" -v "$root/deploy/unified:/state:ro" "$runtime" \
  /release/scripts/module-release-scope.mjs approval "$revision" /state/module-release-approval.json /release/module-release-scope.json
for name in api worker admin; do
  [[ $(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "saydian-global-global-$name-1") == aeb9afcb8bbd8b4168c38e489c827790c448bf7a ]]
done
exec bash "$payload/scripts/receive-runtime-artifact.sh"
