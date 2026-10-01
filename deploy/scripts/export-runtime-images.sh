#!/usr/bin/env bash
# Export the original immutable release, never rebuild a deployment retry.
set -Eeuo pipefail
revision=${1:?}
export_dir=${2:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
manifest="$export_dir/release-manifest.json"
node deploy/scripts/release-manifest.mjs verify "$revision" "$manifest"
images=()
for component in api worker admin; do
  image=$(jq -r --arg component "$component" '.images[$component].ref' "$manifest")
  expected=$(jq -r --arg component "$component" '.images[$component].imageId' "$manifest")
  docker pull "$image"
  [[ $(docker image inspect -f '{{.Id}}' "$image") == "$expected" ]]
  # Named entries prevent Docker's OCI index from collapsing untagged exports.
  tag="ghcr.io/tangwu88/saydianserver-$component:sha-$revision"
  docker tag "$image" "$tag"
  images+=("$tag")
done
archive="$export_dir/saydianapp-runtime-images-$revision.tar.gz"
docker save "${images[@]}" | gzip -1 > "$archive"
tar -xOzf "$archive" index.json | jq -e '.manifests | length == 3' > /dev/null
sha256sum "$archive" > "$archive.sha256"
