#!/usr/bin/env bash
# One-shot installer for Heartwood on the Ubuntu server. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== What's already listening (80, 443, 3410)"
ss -ltn | grep -E ':(80|443|3410) ' || echo "   none of those ports are in use"
echo

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's|^# WHISPER_URL=|WHISPER_URL=|' .env
fi

# First run: a few questions instead of editing a file. Everything else is in Settings.
setenv() { # KEY VALUE: replace any existing (or commented-out) line, single-quoted so "$" and spaces stay literal
  grep -vE "^#? ?$1=" .env > .env.tmp || true
  printf "%s='%s'\n" "$1" "$2" >> .env.tmp
  cat .env.tmp > .env && rm -f .env.tmp
}
if grep -q '^APP_PASSWORD=change-me' .env; then
  if [ ! -t 0 ]; then echo "First-time setup needs answers: run ./deploy/install.sh in a terminal."; exit 1; fi
  echo "== First-time setup (three questions; everything else is in Settings afterwards)"
  while true; do
    read -rsp "   Choose your Heartwood password (at least 12 characters): " p1; echo
    read -rsp "   Again: " p2; echo
    case "$p1" in *"'"*) echo "   Please leave out the ' character."; continue ;; esac
    if [ "${#p1}" -ge 12 ] && [ "$p1" = "$p2" ]; then break; fi
    echo "   Those didn't match or were too short. Try again."
  done
  setenv APP_PASSWORD "$p1"; unset p1 p2
  cur="$(sed -n -E "s/^HEARTWOOD_DOMAIN='?([^']*)'?$/\1/p" .env)"
  read -rp "   The web address you'll use, without https:// (e.g. heartwood.yourdomain.com) [${cur}]: " dom
  dom="${dom:-$cur}"; [ -n "$dom" ] && setenv HEARTWOOD_DOMAIN "$dom"
  tzguess="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo America/New_York)"
  read -rp "   Your time zone [${tzguess}]: " tzv
  setenv TZ "${tzv:-$tzguess}"
  echo "   Saved. Add your AI key in Heartwood: Settings → AI & transcription."
fi

# Docker Compose reads "$" in .env as a variable, which silently breaks passwords
# and keys that contain one. Single-quote those values so they stay literal.
sed -i -E "s/^(APP_PASSWORD|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|RESTIC_PASSWORD|B2_ACCOUNT_KEY|AWS_SECRET_ACCESS_KEY|INVITE_PASSWORD)=([^'\"].*)$/\\1='\\2'/" .env

# Keep secrets and the journal readable only by you.
chmod 600 .env 2>/dev/null || true
mkdir -p data data/backup-status && { chmod 700 data 2>/dev/null || true; }

# The backup service always runs; it waits quietly until backups are turned on (in Settings or .env).
PROFILES="--profile whisper --profile backup"
mkdir -p backups rclone
if ss -ltn | grep -qE ':(80|443) '; then
  echo "== Ports 80/443 are already used by something else, so the bundled HTTPS proxy is skipped."
else
  PROFILES="$PROFILES --profile caddy"
fi

if docker compose ps --status running --services 2>/dev/null | grep -qx heartwood; then
  echo "== Backing up your journal before updating"
  docker compose exec -T heartwood node -e "const D=require('better-sqlite3');new D('/data/heartwood.db',{readonly:true}).backup('/data/backup-'+new Date().toISOString().slice(0,10)+'.db').then(()=>console.log('   saved to data/backup-'+new Date().toISOString().slice(0,10)+'.db'))" || echo "   (backup skipped)"
fi

echo "== Building and starting (first build takes a few minutes)"
docker compose $PROFILES up -d --build

# The backup service runs deploy/backup.sh from a mounted file, so a new version only takes effect
# after a restart. Restart it when the script changed (never in the middle of anything else).
BK_SUM="$(sha256sum deploy/backup.sh 2>/dev/null | cut -d' ' -f1)"
if [ -n "$BK_SUM" ] && [ "$BK_SUM" != "$(cat data/.backup-script.sha 2>/dev/null)" ]; then
  docker compose $PROFILES restart backup >/dev/null 2>&1 && echo "$BK_SUM" > data/.backup-script.sha && echo "   Backup service restarted with the new version"
fi

echo "== Health check"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${HEARTWOOD_PORT:-3410}/api/health" >/dev/null 2>&1; then echo "   Heartwood is running ✔"; break; fi
  sleep 2; if [ "$i" = 30 ]; then echo "   Not responding — check: docker compose logs heartwood"; exit 1; fi
done
docker compose $PROFILES ps
echo
echo "== Done."
