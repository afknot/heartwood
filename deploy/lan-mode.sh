#!/usr/bin/env bash
# Makes Heartwood reachable on your home network at http://<server-ip>:3410
# (plain HTTP: everything works except phone microphone recording).
# Undo with:  ./deploy/lan-mode.sh off
set -euo pipefail
cd "$(dirname "$0")/.."
setvar() { grep -q "^$1=" .env && sed -i "s|^$1=.*|$1=$2|" .env || echo "$1=$2" >> .env; }
if [ "${1:-on}" = "off" ]; then
  setvar COOKIE_SECURE true; setvar HEARTWOOD_BIND 127.0.0.1
else
  setvar COOKIE_SECURE false; setvar HEARTWOOD_BIND 0.0.0.0
fi
docker compose up -d heartwood
IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')
for i in $(seq 1 20); do curl -fsS "http://$IP:${HEARTWOOD_PORT:-3410}/api/health" >/dev/null 2>&1 && break; sleep 2; done
echo
if [ "${1:-on}" = "off" ]; then echo "== Home-network access turned off."
else echo "== Open this on your phone or Mac (same Wi-Fi):  http://$IP:${HEARTWOOD_PORT:-3410}"; fi
