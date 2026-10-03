#!/usr/bin/env bash
set -Eeuo pipefail
payload=${1:?}
if [[ -f "$payload/artifact-probe.json" && -f "$payload/release-manifest.json" ]]; then
  exit 0
fi
if [[ -f "$payload/chunk-name" && -f "$payload/image-chunk" && -f "$payload/offline-transfer.json" && -f "$payload/release-manifest.json" ]]; then
  exit 0
fi
printf '%s' "${GITHUB_TOKEN:?}" | docker login ghcr.io -u tangwu88 --password-stdin
