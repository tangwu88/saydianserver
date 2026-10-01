#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
template_root=${DEPLOY_SOURCE_DIR:-$root_dir/deploy}
app_domain=${APP_DOMAIN:?APP_DOMAIN is required}
gateway_container=${GATEWAY_CONTAINER:-saydian-gateway-1}
gateway_config=${GATEWAY_CONFIG_PATH:-/opt/saydian/config/gateway-nginx.conf}
certbot_email=${CERTBOT_EMAIL:-}
http_template="$template_root/nginx/app-http.conf.template"
https_template="$template_root/nginx/app-https.conf.template"
backup_dir="$root_dir/deploy/gateway-backups"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$backup_dir/gateway-nginx.conf.$timestamp"

test -f "$gateway_config"
test -f "$http_template"
test -f "$https_template"
install -d -m 750 "$backup_dir"
cp -p "$gateway_config" "$backup_path"

restore_gateway() {
  cp -p "$backup_path" "$gateway_config"
  docker exec "$gateway_container" nginx -t
  docker exec "$gateway_container" nginx -s reload
}

if [ ! -s "/etc/letsencrypt/live/$app_domain/fullchain.pem" ]; then
  if [ -n "$certbot_email" ]; then
    certbot certonly --webroot --webroot-path /var/www/certbot \
      --domain "$app_domain" --non-interactive --agree-tos \
      --email "$certbot_email"
  else
    certbot certonly --webroot --webroot-path /var/www/certbot \
      --domain "$app_domain" --non-interactive --agree-tos \
      --register-unsafely-without-email
  fi
fi

temporary_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_dir"' EXIT
candidate="$temporary_dir/gateway-nginx.conf"
preserved_global_routes="$temporary_dir/global-routes.conf"
preserved_admin_upstream="$temporary_dir/admin-upstream.txt"
http_begin="# BEGIN SAYDIAN APP HTTP $app_domain"
http_end="# END SAYDIAN APP HTTP $app_domain"
https_begin="# BEGIN SAYDIAN APP HTTPS $app_domain"
https_end="# END SAYDIAN APP HTTPS $app_domain"
global_begin="  # BEGIN SAYDIAN GLOBAL ROUTES"
global_end="  # END SAYDIAN GLOBAL ROUTES"

# Preserve the intentionally selected public admin upstream when the domestic
# managed block is regenerated. Fresh installs without an admin block continue
# to use the domestic template default.
if ! awk \
  -v https_begin="$https_begin" -v https_end="$https_end" '
  $0 == https_begin { in_https = 1 }
  in_https && $0 == "  location /admin/ {" {
    if (in_admin || seen_admin) exit 51
    in_admin = 1
    seen_admin = 1
    next
  }
  in_admin && $0 ~ /^[[:space:]]*proxy_pass[[:space:]]/ {
    passes++
    if ($0 == "    proxy_pass http://global-admin:8080;") upstream = "global-admin"
    else if ($0 == "    proxy_pass http://saydianapp-admin:8080;") upstream = "saydianapp-admin"
    else exit 52
  }
  in_admin && $0 == "  }" { in_admin = 0; closed_admin = 1 }
  $0 == https_end {
    if (in_admin) exit 53
    in_https = 0
  }
  END {
    if (in_admin || seen_admin != closed_admin || (seen_admin && passes != 1)) exit 54
    if (upstream) print upstream
  }
' "$gateway_config" > "$preserved_admin_upstream"; then
  echo "Cannot safely identify the existing /admin/ upstream" >&2
  exit 1
fi
admin_upstream=$(cat "$preserved_admin_upstream")

# The independently deployed international routes live inside the managed TLS
# server block. Preserve that explicitly marked block when this script rebuilds
# the domestic routes; do not create international routes on installations that
# do not already have them.
awk \
  -v https_begin="$https_begin" -v https_end="$https_end" \
  -v global_begin="$global_begin" -v global_end="$global_end" '
  $0 == https_begin { in_https = 1 }
  $0 == global_begin {
    if (!in_https || seen || capture) exit 42
    seen = 1
    capture = 1
  }
  capture { print }
  $0 == global_end {
    if (!capture) exit 43
    capture = 0
    closed = 1
  }
  $0 == https_end {
    if (capture) exit 44
    in_https = 0
  }
  END {
    if (capture || seen != closed) exit 45
  }
' "$gateway_config" > "$preserved_global_routes"

awk \
  -v http_begin="$http_begin" -v http_end="$http_end" \
  -v https_begin="$https_begin" -v https_end="$https_end" '
  $0 == http_begin || $0 == https_begin { managed = 1; next }
  managed && ($0 == http_end || $0 == https_end) { managed = 0; next }
  !managed { print }
  END { if (managed) exit 2 }
' "$gateway_config" > "$candidate"
printf '\n' >> "$candidate"
sed "s/__APP_DOMAIN__/$app_domain/g" "$http_template" >> "$candidate"
printf '\n' >> "$candidate"
awk \
  -v app_domain="$app_domain" \
  -v admin_upstream="$admin_upstream" \
  -v placeholder="  __SAYDIAN_GLOBAL_ROUTES__" \
  -v routes_file="$preserved_global_routes" '
  {
    gsub(/__APP_DOMAIN__/, app_domain)
    if ($0 == "  location /admin/ {") {
      in_admin = 1
      admin_blocks++
    } else if (in_admin && $0 == "    proxy_pass http://saydianapp-admin:8080;" && admin_upstream == "global-admin") {
      $0 = "    proxy_pass http://global-admin:8080;"
      admin_replacements++
    }
    if ($0 == placeholder) {
      while ((getline route < routes_file) > 0) print route
      close(routes_file)
      placeholders++
      next
    }
    print
    if (in_admin && $0 == "  }") in_admin = 0
  }
  END {
    if (placeholders != 1 || admin_blocks != 1) exit 46
    if (admin_upstream == "global-admin" && admin_replacements != 1) exit 47
  }
' "$https_template" >> "$candidate"
cp "$candidate" "$gateway_config"
if ! docker exec "$gateway_container" nginx -t; then
  restore_gateway
  exit 1
fi
if ! docker exec "$gateway_container" nginx -s reload; then
  restore_gateway
  exit 1
fi
echo "shared gateway configured; backup: $backup_path"
