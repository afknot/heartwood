#!/usr/bin/env bash
# Adds your Heartwood address (HEARTWOOD_DOMAIN) to the Caddy server already running on this machine.
# Backs up the Caddyfile, validates the change, and rolls back if anything fails.
set -euo pipefail
DOMAIN="${HEARTWOOD_DOMAIN:-$(sed -n 's/^HEARTWOOD_DOMAIN=//p' "$(dirname "$0")/../.env" 2>/dev/null)}"
[ -n "$DOMAIN" ] || { echo "Set HEARTWOOD_DOMAIN in .env first (e.g. heartwood.yourdomain.com)."; exit 1; }
PORT="${HEARTWOOD_PORT:-3410}"
CF=/etc/caddy/Caddyfile

echo "== Sites Caddy already serves"
sudo grep -nE '^[^#[:space:]].*\{\s*$' "$CF" || true
echo

if sudo grep -q "$DOMAIN" "$CF"; then
  echo "$DOMAIN is already in $CF — nothing to add."
else
  BIND=""
  if sudo grep -qE '^\s*bind\s' "$CF"; then
    BIND="	bind $(sudo grep -m1 -E '^\s*bind\s' "$CF" | sed -E 's/^\s*bind\s+//')"
  fi
  BACKUP="$CF.bak-$(date +%Y%m%d-%H%M%S)"
  sudo cp "$CF" "$BACKUP"
  echo "== Backed up to $BACKUP"
  sudo tee -a "$CF" >/dev/null <<BLOCK

# Heartwood (leadership journal) — added $(date +%F)
$DOMAIN {
$BIND
	encode zstd gzip
	request_body {
		max_size 600MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Robots-Tag "noindex, nofollow"
	}
	reverse_proxy 127.0.0.1:$PORT
}
BLOCK
  if ! sudo caddy validate --config "$CF" --adapter caddyfile >/tmp/heartwood-caddy-validate.log 2>&1; then
    echo "!! Caddy rejected the change. Restoring the backup."; tail -5 /tmp/heartwood-caddy-validate.log
    sudo cp "$BACKUP" "$CF"; exit 1
  fi
  if ! sudo systemctl reload caddy; then
    echo "!! Caddy failed to reload. Restoring the backup."
    sudo cp "$BACKUP" "$CF"; sudo systemctl reload caddy || true; exit 1
  fi
  echo "== Caddy reloaded with $DOMAIN"
fi

echo "== Waiting for the HTTPS certificate (up to ~60s)"
for i in $(seq 1 20); do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1 || \
     curl -fsS --resolve "$DOMAIN:443:$(ss -ltn | awk '$4 ~ /:443$/ && $4 !~ /^100\./ && $4 !~ /\[/ {sub(/:443$/,"",$4); print $4; exit}')" "https://$DOMAIN/api/health" >/dev/null 2>&1; then
    echo "   https://$DOMAIN is live ✔"; break
  fi
  sleep 3
  [ "$i" = 20 ] && { echo "   Not ready yet. Recent Caddy log:"; sudo journalctl -u caddy --since "-3 min" --no-pager | grep -iE "$DOMAIN|error|challenge" | tail -8; }
done
echo; echo "== Done. Tell Claude 'proxied'."
