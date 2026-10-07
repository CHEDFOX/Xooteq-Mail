#!/usr/bin/env bash
# Adds the mailboxes (Stalwart) and Xooteq Mail (the dashboard) to the platform
# that setup.sh installed. Safe to run again: it makes what is missing, keeps
# what is there, and rebuilds the dashboard from this checkout.
#
#   cd ~/xooteq-mail && git pull && sudo ./workspace-setup.sh
#
# In order: secrets into .env, files to /opt/postal, Stalwart's certificate,
# port 25 handed from Postal to Stalwart, Stalwart's first start (bootstrap),
# its settings (engine.py configure), the dashboard, and the first login.
set -euo pipefail
cd "$(dirname "$0")"
REPO=$PWD
P=/opt/postal

[ -f .env ] || { echo ".env is missing (README, step 2)"; exit 1; }
[ -d "$P" ] || { echo "$P is missing: run setup.sh first"; exit 1; }
set -a; . ./.env; set +a
: "${MAIL_DOMAIN:?set MAIL_DOMAIN in .env}" "${VPS_IP:?set VPS_IP in .env}"

# 1. Secrets this part needs, made once and kept in this checkout's .env (the
#    one setup.sh copies to /opt/postal).
rand() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"$1"; }
add() { grep -q "^$1=." .env || { sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; echo "made $1"; }; }
add DASHBOARD_SECRET "$(rand 48)"
add WEBHOOK_SECRET "$(rand 40)"
add DASHBOARD_URL "https://$MAIL_DOMAIN"
if ! grep -q '^STALWART_ADMIN_SECRET=.' .env; then add STALWART_RECOVERY_ADMIN "admin:$(rand 24)"; fi

# The two ports on 127.0.0.1 (Stalwart's own API, the dashboard for nginx): the
# usual ones, or the next free ones if another program on this VPS has them.
# Chosen once and kept in .env.
busy() {
  if command -v ss >/dev/null; then [ -n "$(ss -Hltn "( sport = :$1 )" 2>/dev/null)" ]
  else (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
free_port() { local p=$1; while busy "$p"; do p=$((p+1)); done; echo "$p"; }
grep -q '^STALWART_LOCAL_PORT=.' .env || add STALWART_LOCAL_PORT "$(free_port 8081)"
grep -q '^DASHBOARD_PORT=.' .env || add DASHBOARD_PORT "$(free_port 5200)"
chmod 600 .env
set -a; . ./.env; set +a
STALWART_LOCAL="http://127.0.0.1:$STALWART_LOCAL_PORT"
echo "ports on 127.0.0.1: Stalwart API $STALWART_LOCAL_PORT, dashboard $DASHBOARD_PORT"

# 2. Files.
cp docker-compose.yml engine.py certbot-hook.sh "$P/"
chmod +x "$P/certbot-hook.sh"
rm -rf "$P/dashboard" && cp -r dashboard "$P/dashboard"
cp .env "$P/.env" && chmod 600 "$P/.env"
# nginx's site for the dashboard, filled in (README, Xooteq Mail).
sed "s/MAIL_DOMAIN/$MAIL_DOMAIN/g; s/127\.0\.0\.1:5200/127.0.0.1:$DASHBOARD_PORT/g" nginx-dashboard.conf > "$P/nginx-xooteq-mail.conf"

# 3. Stalwart's copy of the certificate (certbot-hook.sh keeps it fresh).
install -d -m 750 -o 2000 -g 2000 "$P/stalwart-tls"
if [ ! -f "$P/stalwart-tls/fullchain.pem" ]; then
  if [ -f "$P/config/tls/fullchain.pem" ]; then
    install -m 644 -o 2000 -g 2000 "$P/config/tls/fullchain.pem" "$P/stalwart-tls/fullchain.pem"
    install -m 600 -o 2000 -g 2000 "$P/config/tls/privkey.pem" "$P/stalwart-tls/privkey.pem"
  else
    echo "no certificate yet: run certbot (README step 3) first"; exit 1
  fi
fi

cd "$P"
# 4. Port 25 moves from Postal to Stalwart: Postal's smtp container is
#    recreated with 587 only, then Stalwart takes 25, 465 and 993.
docker compose pull -q stalwart
docker compose up -d smtp
docker compose up -d stalwart

# 5. First start only: bootstrap, then restart without the recovery login.
if ! grep -q '^STALWART_ADMIN_SECRET=.' "$REPO/.env"; then
  ENV_FILE="$REPO/.env" STALWART_LOCAL_URL=$STALWART_LOCAL python3 "$P/engine.py" bootstrap
  cp "$REPO/.env" "$P/.env"
  docker compose up -d --force-recreate stalwart
fi

# 6. The settings the platform depends on (idempotent).
ENV_FILE="$REPO/.env" STALWART_LOCAL_URL=$STALWART_LOCAL python3 "$P/engine.py" configure
cp "$REPO/.env" "$P/.env"

# 7. Xooteq Mail.
docker compose build -q dashboard
docker compose up -d dashboard
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$DASHBOARD_PORT/healthz" >/dev/null && break; sleep 2; done
curl -fs "http://127.0.0.1:$DASHBOARD_PORT/healthz" >/dev/null || { echo "dashboard not answering (docker compose logs dashboard)"; exit 1; }

# 8. The first login: asked for once, kept in the dashboard's database.
if ! docker compose exec -T dashboard node --disable-warning=ExperimentalWarning server/cli.ts has-owner >/dev/null 2>&1; then
  echo
  echo "== your Xooteq Mail login =="
  docker compose exec dashboard node --disable-warning=ExperimentalWarning server/cli.ts create-owner
fi

echo
echo "done. Still to do, once (README, Xooteq Mail):"
echo "  - DNS: A record  ${MAIL_DOMAIN%%.*}  ->  $VPS_IP  at ${MAIL_DOMAIN#*.}   (the dashboard's address)"
echo "  - nginx + certbot for https://$MAIL_DOMAIN:"
echo "      sudo cp $P/nginx-xooteq-mail.conf /etc/nginx/sites-available/xooteq-mail.conf"
echo "      sudo ln -sf /etc/nginx/sites-available/xooteq-mail.conf /etc/nginx/sites-enabled/"
echo "      sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d $MAIL_DOMAIN"
echo "  - hPanel firewall: accept TCP 465 and 993 (mail apps)"
