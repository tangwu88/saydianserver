#!/usr/bin/env sh
set -eu

gateway_container=${GATEWAY_CONTAINER:-saydian-gateway-1}
gateway_config=${GATEWAY_CONFIG_PATH:-/opt/saydian/config/gateway-nginx.conf}
target=${ADMIN_UPSTREAM:-global-admin}
backup_dir=${GATEWAY_BACKUP_DIR:-/opt/saydian/config/backups}

case "$target" in
  global-admin|saydianapp-admin) ;;
  *) echo "ADMIN_UPSTREAM must be global-admin or saydianapp-admin" >&2; exit 2 ;;
esac
test -f "$gateway_config"
install -d -m 750 "$backup_dir"
temporary_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_dir"' EXIT
candidate="$temporary_dir/gateway-nginx.conf"

if ! awk -v target="$target" '
  $0 == "  location /admin/ {" {
    if (in_admin || seen_admin) exit 61
    in_admin = 1
    seen_admin = 1
    print
    next
  }
  in_admin && $0 ~ /^[[:space:]]*proxy_pass[[:space:]]/ {
    passes++
    if ($0 != "    proxy_pass http://global-admin:8080;" &&
        $0 != "    proxy_pass http://saydianapp-admin:8080;") exit 62
    print "    proxy_pass http://" target ":8080;"
    next
  }
  in_admin && $0 == "  }" { in_admin = 0; closed_admin = 1 }
  { print }
  END {
    if (in_admin || seen_admin != 1 || closed_admin != 1 || passes != 1) exit 63
  }
' "$gateway_config" > "$candidate"; then
  echo "Cannot safely replace the unique /admin/ upstream" >&2
  exit 1
fi

if cmp -s "$gateway_config" "$candidate"; then
  echo "/admin/ already uses $target"
  exit 0
fi

backup_path=$(mktemp "$backup_dir/gateway-nginx.conf.before-admin-switch.XXXXXX")
cp -p "$gateway_config" "$backup_path"

restore_gateway() {
  cat "$backup_path" > "$gateway_config"
  docker exec "$gateway_container" nginx -t
  docker exec "$gateway_container" nginx -s reload
}

cat "$candidate" > "$gateway_config"
if ! docker exec "$gateway_container" nginx -t; then
  restore_gateway
  echo "Gateway syntax check failed; restored $backup_path" >&2
  exit 1
fi
if ! docker exec "$gateway_container" nginx -s reload; then
  restore_gateway
  echo "Gateway reload failed; restored $backup_path" >&2
  exit 1
fi
echo "/admin/ now uses $target; backup: $backup_path"
