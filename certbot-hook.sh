#!/usr/bin/env bash
# Hands certbot's certificate to the two mail servers: Postal's SMTP server
# (/opt/postal/config/tls, port 587) and Stalwart (/opt/postal/stalwart-tls,
# ports 25, 465 and 993). Certbot calls this after every renewal
# (--deploy-hook); run it once by hand after the first issue.
set -euo pipefail
P=/opt/postal
set -a; . "$P/.env"; set +a
LIVE=/etc/letsencrypt/live/postal.$MAIL_DOMAIN
[ -d "$LIVE" ] || LIVE=/etc/letsencrypt/live/smtp.$MAIL_DOMAIN
[ -f "$LIVE/fullchain.pem" ] || { echo "no certificate at $LIVE yet"; exit 1; }

install -m 644 "$LIVE/fullchain.pem" "$P/config/tls/fullchain.pem"
install -m 644 "$LIVE/privkey.pem" "$P/config/tls/privkey.pem"
cd "$P" && docker compose restart smtp >/dev/null
echo "Postal's smtp server now uses the certificate from $LIVE"

# Stalwart runs as uid 2000 and reads the files on every TLS reload.
install -d -m 750 -o 2000 -g 2000 "$P/stalwart-tls"
install -m 644 -o 2000 -g 2000 "$LIVE/fullchain.pem" "$P/stalwart-tls/fullchain.pem"
install -m 600 -o 2000 -g 2000 "$LIVE/privkey.pem" "$P/stalwart-tls/privkey.pem"
if [ -n "${STALWART_ADMIN_SECRET:-}" ] && docker compose ps --status running --services 2>/dev/null | grep -qx stalwart; then
  ENV_FILE="$P/.env" python3 "$P/engine.py" reload-tls || docker compose restart stalwart >/dev/null
  echo "Stalwart now uses the certificate from $LIVE"
fi
