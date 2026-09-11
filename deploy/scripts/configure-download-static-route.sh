#!/usr/bin/env bash

set -euo pipefail

GATEWAY_CONFIG="${GATEWAY_CONFIG:-/opt/saydian/config/gateway-nginx.conf}"
GATEWAY_CONTAINER="${GATEWAY_CONTAINER:-saydian-gateway-1}"
DOWNLOAD_UPSTREAM="${DOWNLOAD_UPSTREAM:-saydianapp-production-download-1}"

if [[ ! -f "$GATEWAY_CONFIG" ]]; then
  echo "Gateway config not found: $GATEWAY_CONFIG" >&2
  exit 1
fi

backup="${GATEWAY_CONFIG}.before-download-$(date -u +%Y%m%dT%H%M%SZ)"
staged="$(mktemp)"
cp "$GATEWAY_CONFIG" "$backup"

restore_gateway() {
  cp "$backup" "$GATEWAY_CONFIG"
  docker exec "$GATEWAY_CONTAINER" nginx -t >/dev/null
  docker exec "$GATEWAY_CONTAINER" nginx -s reload >/dev/null
}

trap 'rm -f "$staged"' EXIT

awk -v upstream="$DOWNLOAD_UPSTREAM" '
  /^# BEGIN SAYDIAN APP HTTPS / { in_app = 1 }
  /^# END SAYDIAN APP HTTPS / { in_app = 0 }

  in_app && /^  # BEGIN SAYDIAN DOWNLOAD STATIC ROUTE$/ {
    in_download = 1
    next
  }

  in_download && /^  # END SAYDIAN DOWNLOAD STATIC ROUTE$/ {
    in_download = 0
    next
  }

  in_download { next }

  in_app && !inserted && /^  location \/admin\/ \{$/ {
    print "  # BEGIN SAYDIAN DOWNLOAD STATIC ROUTE"
    print "  location = /down {"
    print "    proxy_pass http://" upstream ";"
    print "    proxy_http_version 1.1;"
    print "    proxy_set_header Host $host;"
    print "    proxy_set_header X-Real-IP $remote_addr;"
    print "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    print "    proxy_set_header X-Forwarded-Proto https;"
    print "  }"
    print ""
    print "  location ^~ /down/ {"
    print "    proxy_pass http://" upstream ";"
    print "    proxy_http_version 1.1;"
    print "    proxy_set_header Host $host;"
    print "    proxy_set_header X-Real-IP $remote_addr;"
    print "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
    print "    proxy_set_header X-Forwarded-Proto https;"
    print "  }"
    print "  # END SAYDIAN DOWNLOAD STATIC ROUTE"
    print ""
    inserted = 1
  }

  { print }

  END {
    if (inserted != 1 || in_download) {
      exit 42
    }
  }
' "$GATEWAY_CONFIG" >"$staged"

cp "$staged" "$GATEWAY_CONFIG"

if ! docker exec "$GATEWAY_CONTAINER" nginx -t; then
  restore_gateway
  echo "Gateway syntax check failed; restored $backup" >&2
  exit 1
fi

if ! docker exec "$GATEWAY_CONTAINER" nginx -s reload; then
  restore_gateway
  echo "Gateway reload failed; restored $backup" >&2
  exit 1
fi

echo "Download route installed; backup: $backup"
