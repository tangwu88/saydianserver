#!/usr/bin/env bash
# Real Docker import rehearsal of tiny synthetic images, on GitHub-hosted CI only.
set -Eeuo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted ]]
revision=${1:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
helper=saydian-global-global-api-1
if docker inspect "$helper" >/dev/null 2>&1; then echo 'Refusing an existing helper container' >&2; exit 1; fi
scratch=$(mktemp -d)
fixture_images=()
cleanup() { docker rm -f "$helper" >/dev/null 2>&1 || true; for id in "${fixture_images[@]}"; do docker image rm "$id" >/dev/null 2>&1 || true; done; rm -rf -- "$scratch"; }
trap cleanup EXIT
mkdir -p "$scratch/empty" "$scratch/chunks" "$scratch/releases/ci-fixture/deploy/scripts" "$scratch/deploy"
payload="$scratch/releases/ci-fixture/deploy"
docker create --name "$helper" "ghcr.io/tangwu88/saydianserver-api:sha-$revision" >/dev/null
for name in api worker admin; do
  id=$(tar -c -C "$scratch/empty" . | docker import --change "LABEL org.opencontainers.image.revision=$revision" --change "LABEL fixture.component=$name" - "saydian-offline-fixture-$name:$revision")
  fixture_images+=("$id")
done
docker save "${fixture_images[@]}" | gzip -1 > "$scratch/images.tar.gz"
node --input-type=module - "$revision" "$payload/release-manifest.json" "${fixture_images[@]}" <<'NODE'
import {writeFileSync} from 'node:fs';
const [revision, output, ...ids] = process.argv.slice(2);
// These local-only synthetic refs are never published or used for application deployment.
writeFileSync(output, JSON.stringify({schemaVersion:1, revision, images:Object.fromEntries(['api','worker','admin'].map((name,index)=>[name,{ref:`ghcr.io/tangwu88/saydianserver-${name}@${ids[index]}`,imageId:ids[index],sizeBytes:4096}])), migrations:[{name:'20261002000000_ci_fixture',sha256:'0'.repeat(64),automatic:false}]}));
NODE
for name in api worker admin; do docker image rm "saydian-offline-fixture-$name:$revision" >/dev/null; done
split -b 1024 -d -a 3 "$scratch/images.tar.gz" "$scratch/chunks/chunk-"
node deploy/scripts/offline-image-transfer.mjs create "$revision" "$payload/release-manifest.json" "$payload/offline-transfer.json" "$scratch/images.tar.gz" "$scratch/chunks"
cp deploy/scripts/offline-image-transfer.mjs deploy/scripts/release-manifest.mjs "$payload/scripts/"
node --input-type=module - "$scratch" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';
const root=process.argv[2];
writeFileSync(root+'/receiver.sh',readFileSync('deploy/scripts/receive-offline-images.sh','utf8').replaceAll('/opt/saydianapp-server',root));
NODE
exec 9>"$scratch/deploy/.ci-release.lock"
for chunk in "$scratch"/chunks/chunk-*; do
  cp "$chunk" "$payload/image-chunk"
  basename "$chunk" > "$payload/chunk-name"
  RELEASE_SOURCE="$scratch/releases/ci-fixture" RELEASE_SHA="$revision" bash "$scratch/receiver.sh"
done
echo 'Real Docker offline import and image revision verification passed; no applications started.'
