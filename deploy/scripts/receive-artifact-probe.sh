#!/usr/bin/env bash
set -Eeuo pipefail
root_dir=/opt/saydianapp-server
source_dir=${RELEASE_SOURCE:?}
revision=${RELEASE_SHA:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$source_dir" == "$root_dir"/releases/ci-* ]]
[[ "$(readlink /proc/$$/fd/9)" == "$root_dir/deploy/.ci-release.lock" ]]
flock -n 9
artifact_id=$(jq -er .artifactId "$source_dir/deploy/artifact-probe.json")
[[ "$artifact_id" =~ ^[1-9][0-9]*$ ]]
runtime=$(docker inspect -f '{{.Image}}' saydian-global-global-api-1)
docker run --rm --read-only --network bridge --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges=true --memory 128m --cpus 1 --entrypoint node \
  -e GITHUB_TOKEN -e PROBE_REVISION="$revision" -e PROBE_ARTIFACT_ID="$artifact_id" \
  -v "$source_dir/deploy:/release:ro" "$runtime" /release/scripts/probe-runtime-artifact.mjs
