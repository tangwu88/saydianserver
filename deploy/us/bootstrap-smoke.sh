#!/usr/bin/env bash
set -Eeuo pipefail
revision=6522ab9808803ac652412a0ed810c8addb473101
[[ "${GITHUB_ACTIONS:-}" == true ]]
root=$(mktemp -d /tmp/saydian-us-ci-XXXXXXXX)
source_dir=$root/releases/ci-rehearsal
cleanup() {
  for id in $(docker ps -aq --filter label=com.docker.compose.project=saydian-us); do docker rm -f "$id" >/dev/null; done
  for volume in us_postgres us_redis us_files; do docker volume rm "saydian-us_$volume" >/dev/null 2>&1 || true; done
  docker network rm saydian-us_us_private saydian-us_us_egress >/dev/null 2>&1 || true
  sudo rm -rf -- "$root"
}
trap cleanup EXIT
test -z "$(docker ps -aq --filter label=com.docker.compose.project=saydian-us)"
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
mkdir -p "$source_dir"
cp -R deploy "$source_dir/"
cp verified-release/release-manifest.json "$source_dir/deploy/release-manifest.json"
cp verified-storage/us-storage-manifest.json "$source_dir/deploy/us/storage-manifest.json"
python3 - "$source_dir/deploy/us/compose.json" "$root" <<'PY'
import json,sys
p=sys.argv[1];c=json.load(open(p))
c['services']['us-admin']['volumes']=[sys.argv[2]+'/downloads:/usr/share/nginx/html/down/files:ro']
json.dump(c,open(p,'w'),indent=2)
PY
sudo env GITHUB_ACTIONS=true US_BOOTSTRAP_CI_ROOT="$root" python3 deploy/us/create-private-environment.py
sudo env GITHUB_ACTIONS=true US_BOOTSTRAP_CI_ROOT="$root" DOCKER_CONFIG="$HOME/.docker" \
  RELEASE_SHA="$revision" RELEASE_SOURCE="$source_dir" python3 "$source_dir/deploy/us/bootstrap.py" || {
    # Only CI-generated synthetic secrets exist on this isolated runner. Redact them before diagnostics.
    sudo python3 - "$root/private" <<'PY'
import sys
from pathlib import Path
p=Path(sys.argv[1]);f=p/'bootstrap-error.log'
text=f.read_text() if f.exists() else 'No subprocess diagnostic'
for line in (p/'runtime.env').read_text().splitlines():
    if '=' in line:
        _,value=line.split('=',1)
        if len(value)>10:text=text.replace(value,'[REDACTED]')
print(text[-12000:])
PY
    exit 1
  }
sudo python3 - "$root" <<'PY'
import json,sys
from pathlib import Path
p=Path(sys.argv[1])/'private'
s=json.load(open(p/'accepted-state.json'))
assert s['dataMode']=='fresh-independent' and s['restoreAccepted'] and s['filesVerified'] and s['publicAcceptance'] is False
r=json.load(open(p/'bootstrap-restore-proof.json'))
assert len(r['tables'])>30
print('Actual isolated CI bootstrap, complete restore row digests and restricted S3 passed')
PY
# A second bootstrap must refuse the accepted system, preserving its DB and secrets.
if sudo env GITHUB_ACTIONS=true US_BOOTSTRAP_CI_ROOT="$root" DOCKER_CONFIG="$HOME/.docker" \
  RELEASE_SHA="$revision" RELEASE_SOURCE="$source_dir" python3 "$source_dir/deploy/us/bootstrap.py"; then exit 1; fi
