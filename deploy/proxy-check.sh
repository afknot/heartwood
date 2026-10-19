#!/usr/bin/env bash
# Shows what already serves ports 80/443 on this server, so Heartwood can be added to it.
echo "== Who owns ports 80/443 (asks for your sudo password)"
sudo ss -ltnp | grep -E ':(80|443) ' || true
echo; echo "== Containers"
docker ps --format '{{.Names}}  |  {{.Image}}  |  {{.Ports}}'
echo; echo "== Services"
for s in caddy nginx apache2 traefik tailscaled; do printf '%-11s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null)"; done
echo; echo "== Config folders"
ls -d /etc/caddy /etc/nginx/sites-enabled /etc/apache2/sites-enabled 2>/dev/null || true
echo; echo "== Done. Tell Claude 'checked'."
