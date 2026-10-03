#!/usr/bin/env bash
set -Eeuo pipefail
root_dir=/opt/saydianapp-server
source_dir=${RELEASE_SOURCE:?}
revision=${RELEASE_SHA:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$source_dir" == "$root_dir"/releases/ci-* ]]
[[ "$(readlink /proc/$$/fd/9)" == "$root_dir/deploy/.ci-release.lock" ]]
flock -n 9
payload="$source_dir/deploy"
artifact_id=$(jq -er .artifactId "$payload/runtime-artifact.json")
action=$(jq -er .action "$payload/runtime-artifact.json")
[[ "$artifact_id" =~ ^[1-9][0-9]*$ ]]
[[ "$action" == probe || "$action" == import ]]
runtime=$(docker inspect -f '{{.Image}}' saydian-global-global-api-1)
if [[ "$action" == probe ]]; then
docker run --rm --read-only --network bridge --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges=true --memory 128m --cpus 1 --entrypoint node \
  -e GITHUB_TOKEN -e PROBE_REVISION="$revision" -e PROBE_ARTIFACT_ID="$artifact_id" \
  -v "$payload:/release:ro" "$runtime" /release/scripts/runtime-artifact.mjs
exit 0
fi
command -v python3 >/dev/null
docker run --rm --read-only --network none --user 0:0 --entrypoint node \
  -v "$payload:/release:ro" "$runtime" /release/scripts/release-manifest.mjs verify "$revision" /release/release-manifest.json
ready=true
for name in api worker admin; do
  id=$(jq -r --arg name "$name" '.images[$name].imageId' "$payload/release-manifest.json")
  [[ $(docker image inspect -f '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$id" 2>/dev/null) == "$id $revision" ]] || ready=false
done
if [[ "$ready" == true ]]; then echo "Original images already verified: $revision; no applications restarted."; exit 0; fi
archive_bytes=$(jq -er .sizeBytes "$payload/runtime-artifact.json")
[[ "$archive_bytes" =~ ^[0-9]+$ ]] && ((archive_bytes >= 8388608 && archive_bytes <= 2147483648))
image_bytes=$(jq '[.images[].sizeBytes] | add' "$payload/release-manifest.json")
free_bytes=$(df -PB1 "$source_dir" | awk 'NR==2 {print $4}')
((free_bytes >= archive_bytes * 6 + image_bytes + 5 * 1024 ** 3)) || { echo 'Insufficient disk for HTTPS recovery and 5 GiB reserve.' >&2; exit 1; }
downloads="$source_dir/artifact-download"
install -d -m 700 "$downloads" "$downloads/chunks"
timeout --signal=TERM --kill-after=10s 3300 docker run --rm --read-only --network bridge --user 0:0 --cap-drop ALL \
  --security-opt no-new-privileges=true --memory 256m --cpus 1 --entrypoint node \
  -e GITHUB_TOKEN -e PROBE_REVISION="$revision" -e PROBE_ARTIFACT_ID="$artifact_id" \
  -v "$payload:/release:ro" -v "$downloads:/downloads" "$runtime" /release/scripts/runtime-artifact.mjs download
python3 "$payload/scripts/verify-runtime-artifact.py" "$revision" "$payload" "$downloads"
split -b 8388608 -d -a 3 "$downloads/images.tar.gz" "$downloads/chunks/chunk-"
docker run --rm --read-only --network none --user 0:0 --entrypoint node \
  -v "$payload:/release:ro" -v "$downloads:/downloads" "$runtime" /release/scripts/offline-image-transfer.mjs create \
  "$revision" /release/release-manifest.json /downloads/offline-transfer.json /downloads/images.tar.gz /downloads/chunks
cp "$downloads/offline-transfer.json" "$payload/"
# Reuse the already rehearsed hash/disk/OCI-ID import gate; no application restart.
for chunk in "$downloads"/chunks/chunk-*; do
  cp "$chunk" "$payload/image-chunk"
  basename "$chunk" > "$payload/chunk-name"
  bash "$payload/scripts/receive-offline-images.sh"
done
# Only successful recovery removes this invocation's generated download copies.
for chunk in "$downloads"/chunks/chunk-*; do
  [[ "${chunk##*/}" =~ ^chunk-[0-9]{3}$ ]]
  rm -f -- "$chunk"
done
rm -f -- "$downloads/runtime.zip" "$downloads/images.tar.gz" "$downloads/offline-transfer.json"
echo "HTTPS recovery imported the original verified images for $revision; no applications restarted."
