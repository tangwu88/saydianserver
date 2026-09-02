#!/usr/bin/env sh
set -eu

root_dir=${DEPLOY_ROOT:-/opt/saydianapp-server}
app_domain=${APP_DOMAIN:?APP_DOMAIN is required}
gateway_container=${GATEWAY_CONTAINER:-saydian-gateway-1}
gateway_config=${GATEWAY_CONFIG_PATH:-/opt/saydian/config/gateway-nginx.conf}
certbot_email=${CERTBOT_EMAIL:-}
http_template="$root_dir/deploy/nginx/app-http.conf.template"
https_template="$root_dir/deploy/nginx/app-https.conf.template"
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

append_template() {
  marker=$1
  template=$2
  if grep -Fq "$marker" "$gateway_config"; then
    return
  fi
  sed "s/__APP_DOMAIN__/$app_domain/g" "$template" >> "$gateway_config"
  if ! docker exec "$gateway_container" nginx -t; then
    restore_gateway
    exit 1
  fi
  docker exec "$gateway_container" nginx -s reload
}

append_template "# BEGIN SAYDIAN APP HTTP $app_domain" "$http_template"

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

append_template "# BEGIN SAYDIAN APP HTTPS $app_domain" "$https_template"
echo "shared gateway configured; backup: $backup_path"
