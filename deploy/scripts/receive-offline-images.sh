#!/usr/bin/env bash
# Invoked only by the existing constrained receiver. Imports images; never starts apps.
set -Eeuo pipefail
umask 077
root_dir=/opt/saydianapp-server
source_dir=${RELEASE_SOURCE:?}
revision=${RELEASE_SHA:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$source_dir" == "$root_dir"/releases/ci-* ]]
[[ "$(readlink /proc/$$/fd/9)" == "$root_dir/deploy/.ci-release.lock" ]]
flock -n 9
payload="$source_dir/deploy"
read -r chunk_name < "$payload/chunk-name"
[[ "$chunk_name" =~ ^chunk-[0-9]{3}$ ]]
runtime=$(docker inspect -f '{{.Image}}' saydian-global-global-api-1)
docker run --rm --user 0:0 --network none --read-only --entrypoint node -v "$payload:/release:ro" "$runtime" \
  /release/scripts/offline-image-transfer.mjs verify "$revision" /release/release-manifest.json /release/offline-transfer.json /release/image-chunk "$chunk_name"
archive_hash=$(jq -r .archive.sha256 "$payload/offline-transfer.json")
destination="$root_dir/deploy/unified/offline/$revision/$archive_hash"
install -d -m 700 "$destination"
images_ready() {
  local name id
  for name in api worker admin; do
    id=$(jq -r --arg name "$name" '.images[$name].imageId' "$payload/release-manifest.json")
    [[ $(docker image inspect -f '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$id" 2>/dev/null) == "$id $revision" ]] || return 1
  done
}
# These two files are created by this receiver invocation, not business files.
cleanup_incoming() { rm -f -- "$payload/image-chunk" "$source_dir/bundle.tgz"; }
archive_bytes=$(jq -r .archive.sizeBytes "$payload/offline-transfer.json")
image_bytes=$(jq '[.images[].sizeBytes] | add' "$payload/release-manifest.json")
require_space() {
  local free_bytes
  free_bytes=$(df -PB1 "$destination" | awk 'NR==2 {print $4}')
  if ((free_bytes < $1 + 5 * 1024 ** 3)); then
    echo 'Insufficient disk for offline import and 5 GiB reserve.' >&2; exit 1
  fi
}
if [[ ! -f "$destination/offline-transfer.json" ]]; then
  # Includes retained receiver bundles/chunks, assembled archive, runtime images and reserve.
  require_space "$((archive_bytes * 4 + image_bytes))"
  cp "$payload/offline-transfer.json" "$payload/release-manifest.json" "$destination/"
else
  cmp "$payload/offline-transfer.json" "$destination/offline-transfer.json"
  cmp "$payload/release-manifest.json" "$destination/release-manifest.json"
fi
if images_ready; then
  cleanup_incoming
  printf '%s\n' "$revision" > "$destination/imported"
  echo "Original images already verified: $revision."; exit 0
fi
if [[ -f "$destination/$chunk_name" ]]; then
  cmp "$payload/image-chunk" "$destination/$chunk_name"
else
  require_space 8388608
  cp "$payload/image-chunk" "$destination/$chunk_name"
fi
cleanup_incoming
while read -r name; do
  if [[ ! -f "$destination/$name" ]]; then echo "Verified $chunk_name; waiting for remaining chunks."; exit 0; fi
done < <(jq -r '.chunks[].name' "$destination/offline-transfer.json")
if [[ ! -f "$destination/images.tar.gz" ]]; then
  require_space "$((archive_bytes + image_bytes))"
  while read -r name; do cat "$destination/$name"; done < <(jq -r '.chunks[].name' "$destination/offline-transfer.json") > "$destination/images.tar.gz.partial"
  [[ $(sha256sum "$destination/images.tar.gz.partial" | cut -d' ' -f1) == "$archive_hash" ]]
  mv "$destination/images.tar.gz.partial" "$destination/images.tar.gz"
fi
[[ $(sha256sum "$destination/images.tar.gz" | cut -d' ' -f1) == "$archive_hash" ]]
if ! images_ready; then require_space "$image_bytes"; docker load --input "$destination/images.tar.gz"; fi
images_ready
printf '%s\n' "$revision" > "$destination/imported"
while read -r name; do rm -f -- "$destination/$name"; done < <(jq -r '.chunks[].name' "$destination/offline-transfer.json")
rm -f -- "$destination/images.tar.gz"
echo "Original images imported and verified: $revision. No applications restarted."
