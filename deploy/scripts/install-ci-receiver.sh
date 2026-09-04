#!/usr/bin/env bash
# Run once as root with the reviewed receiver script and a PUBLIC ed25519 key.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root' >&2; exit 1; }
receiver=${1:?receiver script path}
public_key=${2:?public key path}
[[ -f "$receiver" && -f "$public_key" && -d /opt/saydianapp-server/deploy ]]
bash -n "$receiver"
ssh-keygen -lf "$public_key"
[[ $(wc -l < "$public_key") -le 1 ]]
read -r key_type key_data key_comment < "$public_key"
[[ "$key_type" == ssh-ed25519 && "$key_data" =~ ^[A-Za-z0-9+/=]+$ ]]
deploy_user=saydianapp-deploy
deploy_home=/var/lib/saydianapp-deploy
if getent passwd "$deploy_user" >/dev/null; then
  [[ $(getent passwd "$deploy_user" | cut -d: -f6) == "$deploy_home" ]] || exit 1
else
  useradd --system --create-home --home-dir "$deploy_home" --shell /bin/bash "$deploy_user"
fi
# Root owns the key/command policy; this account is not a member of docker or sudo.
install -d -o root -g root -m 755 "$deploy_home" "$deploy_home/.ssh"
install -o root -g root -m 755 "$receiver" /usr/local/sbin/saydianapp-ci-receiver
policy=$(mktemp /etc/sudoers.d/saydianapp-ci-check.XXXXXXXX)
trap 'rm -f -- "$policy"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/saydianapp-ci-receiver *\n' "$deploy_user" > "$policy"
chmod 440 "$policy"
visudo -cf "$policy"
install -o root -g root -m 440 "$policy" /etc/sudoers.d/saydianapp-ci
authorized="$deploy_home/.ssh/authorized_keys"
[[ ! -e "$authorized" || ( -f "$authorized" && ! -L "$authorized" ) ]]
line='restrict,command="sudo -n /usr/local/sbin/saydianapp-ci-receiver \"$SSH_ORIGINAL_COMMAND\""'
line+=" $key_type $key_data saydianapp-ci"
if [[ ! -e "$authorized" ]] || ! grep -Fqx -- "$line" "$authorized"; then
  printf '%s\n' "$line" >> "$authorized"
fi
chown root:root "$authorized"
chmod 644 "$authorized"
echo 'Receiver installed. Verify SSH status and rejected commands before enabling Actions.'
