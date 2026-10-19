#!/usr/bin/env bash
# One-time: have this server follow a Heartwood repository on GitHub and install updates on its own.
# Your journal (data/), settings (.env) and backups are never touched.
#
#   ./deploy/connect-github.sh                 follow the main project (afknot/heartwood)
#   ./deploy/connect-github.sh you/heartwood   follow your own fork instead (public or private)
#
# Public repositories need nothing else. For a private one, this makes a read-only deploy key and
# tells you where to add it.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="${1:-${HEARTWOOD_REPO:-afknot/heartwood}}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Use the form owner/repository, like afknot/heartwood."; exit 1; }
KEY="$HOME/.ssh/heartwood_deploy"

command -v git >/dev/null || { echo "Installing git…"; sudo apt-get update -qq && sudo apt-get install -y -qq git; }

if GIT_TERMINAL_PROMPT=0 git ls-remote -q "https://github.com/$REPO.git" main >/dev/null 2>&1; then
  URL="https://github.com/$REPO.git"
  echo "== $REPO is public: no key needed"
else

# 1) A read-only deploy key just for this repository.
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N '' -C "heartwood-server" -f "$KEY" >/dev/null
if ! grep -q '^Host github-heartwood' "$HOME/.ssh/config" 2>/dev/null; then
  printf '\nHost github-heartwood\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >> "$HOME/.ssh/config"
  chmod 600 "$HOME/.ssh/config"
fi
ssh-keygen -F github.com >/dev/null 2>&1 || ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null

# GitHub answers "successfully authenticated" but exits with status 1 (no shell access), so check the text.
key_ok() { local out; out=$(ssh -o BatchMode=yes -o ConnectTimeout=15 -T github-heartwood 2>&1 || true); [[ "$out" == *"successfully authenticated"* ]] || { LAST="$out"; return 1; }; }
LAST=""
until key_ok; do
  cat <<MSG

== Add this server's key to GitHub (read-only)
1. Open https://github.com/$REPO/settings/keys/new
2. Title: Heartwood server
3. Key: paste the line below
4. Leave "Allow write access" OFF, then click "Add key".

$(cat "$KEY.pub")

MSG
  [ -n "$LAST" ] && echo "(GitHub said: ${LAST})"
  read -rp "Press Enter once it's added… " _
done
echo "== GitHub key works ✔"
URL="git@github-heartwood:$REPO.git"
fi

# 2) Turn this folder into a checkout of the repository, keeping everything that isn't code.
if [ ! -d .git ]; then
  tar czf "../heartwood-before-git-$(date +%F).tgz" --exclude=./data --exclude=./backups --exclude=./node_modules . 2>/dev/null || true
  git init -q -b main
  git remote add origin "$URL"
fi
git remote set-url origin "$URL"
git fetch -q origin main
git reset -q --hard origin/main   # code only; data/, .env, backups/ and rclone/ are untracked and stay put
echo "== This folder now follows GitHub ($(git log -1 --format='%h %s'))"

# 3) Check GitHub every 5 minutes and install anything new.
chmod +x deploy/auto-update.sh
LINE="* * * * * flock -n /tmp/heartwood-update.lock $PWD/deploy/auto-update.sh >> $HOME/heartwood-update.log 2>&1"
command -v crontab >/dev/null || { echo "Installing cron…"; sudo apt-get install -y -qq cron; }
EXISTING="$(crontab -l 2>/dev/null || true)"          # empty the first time: no crontab yet
{ printf '%s\n' "$EXISTING" | grep -v 'heartwood/deploy/auto-update.sh' | grep -v '^$' || true; echo "$LINE"; } | crontab -
echo "== Updates are on: checks GitHub every 5 minutes. Manage them in Heartwood → Settings → Updates. Log: ~/heartwood-update.log"

./deploy/auto-update.sh --force
