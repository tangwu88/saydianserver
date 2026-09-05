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
http_begin="# BEGIN SAYDIAN APP HTTP $app_domain"
http_end="# END SAYDIAN APP HTTP $app_domain"
https_begin="# BEGIN SAYDIAN APP HTTPS $app_domain"
https_end="# END SAYDIAN APP HTTPS $app_domain"

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
sed "s/__APP_DOMAIN__/$app_domain/g" "$https_template" >> "$candidate"
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
