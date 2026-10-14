#!/usr/bin/env bash
set -Eeuo pipefail
revision=${1:?}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
network=saydian-us-storage-ci
container=saydian-us-storage-ci
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
docker run -d --name "$container" --network "$network" --network-alias storage \
  --memory 192m --cpus 0.5 --read-only --pids-limit 100 \
  --tmpfs /data:uid=1000,gid=1000,size=64m --tmpfs /tmp:size=16m \
  -e MINIO_ROOT_USER=ci-us-owner -e MINIO_ROOT_PASSWORD=synthetic-ci-us-owner-password \
  "ghcr.io/tangwu88/saydianserver-us-minio:sha-$revision" server /data --console-address :9001 >/dev/null
ready=false
for attempt in {1..45}; do
  if docker exec "$container" wget -qO- http://127.0.0.1:9000/minio/health/ready >/dev/null; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]]
docker run --rm --network "$network" --memory 64m --read-only --pids-limit 60 \
  --tmpfs /tmp:size=8m --tmpfs /root/.mc:size=8m \
  --entrypoint /bin/sh "ghcr.io/tangwu88/saydianserver-us-mc:sha-$revision" -ec '
    mc alias set local http://storage:9000 ci-us-owner synthetic-ci-us-owner-password >/dev/null
    mc mb local/saydian-us-private >/dev/null
    mc anonymous set none local/saydian-us-private >/dev/null
    printf "synthetic US private storage fixture" > /tmp/probe
    mc cp /tmp/probe local/saydian-us-private/probe >/dev/null
    mc cat local/saydian-us-private/probe | cmp /tmp/probe -
    wget -S -O /dev/null http://storage:9000/saydian-us-private/probe 2>/tmp/denied || true
    grep -q 403 /tmp/denied
    mc rm local/saydian-us-private/probe >/dev/null
  '
[[ $(docker inspect "$container" --format '{{.State.OOMKilled}} {{.RestartCount}}') == 'false 0' ]]
docker run --rm "ghcr.io/tangwu88/saydianserver-us-minio:sha-$revision" --version | grep -F 'RELEASE.2024-08-17T01-24-54Z'
docker run --rm "ghcr.io/tangwu88/saydianserver-us-mc:sha-$revision" --version | grep -F 'RELEASE.2024-08-17T11-33-50Z'
