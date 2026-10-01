#!/usr/bin/env bash
# The receiver's one release entry point. Package links are edited in Admin.
set -Eeuo pipefail
exec bash "$(dirname -- "${BASH_SOURCE[0]}")/deploy-unified.sh"
