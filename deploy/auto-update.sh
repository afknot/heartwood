#!/usr/bin/env bash
# Runs every minute (cron). Checks GitHub every 5 minutes for new commits and, depending on the
# setting in the app (Settings → Updates), installs them automatically or waits for "Update now".
# Talks to the app only through files in data/:
#   data/update-status.json    written here: current version, what's available, state, log tail
#   data/update-settings.json  written by the app: {"auto": true|false}
#   data/update-request.json   written by the app: {"at": "<time>"} to install now
#   data/deployed.json         written here after an install: the running version
# --force reinstalls even when nothing changed.
set -uo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
STATUS=data/update-status.json
STATE_DIR="$HOME/.heartwood-update"; mkdir -p "$STATE_DIR"
LOG="$STATE_DIR/last-install.log"

# Older installs scheduled this every 5 minutes; check every minute so "Update now" feels quick.
if crontab -l 2>/dev/null | grep -q '^\*/5 .*heartwood/deploy/auto-update.sh'; then
  crontab -l 2>/dev/null | sed 's#^\*/5 \(.*heartwood/deploy/auto-update.sh\)#* \1#' | crontab -
fi

json_str() { [ -z "$1" ] && { printf '""'; return; }; printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/ /g' | tr -d '\r' | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//; s/^/"/; s/$/"/'; }
now() { date -u +%FT%TZ; }

write_status() { # $1 state, $2 error
  local cur cur_subj avail="" first=1 line
  cur=$(git rev-parse --short HEAD 2>/dev/null); cur_subj=$(git log -1 --format=%s 2>/dev/null)
  while IFS=$'\t' read -r h d s; do
    [ -z "$h" ] && continue
    [ $first = 1 ] || avail+=","; first=0
    avail+="{\"commit\":\"$h\",\"date\":\"$d\",\"subject\":$(json_str "$s")}"
  done < <(git log --format='%h%x09%cI%x09%s' HEAD..origin/main 2>/dev/null | head -n 30)
  local tail_txt=""; [ -f "$LOG" ] && tail_txt=$(tail -n 25 "$LOG")
  printf '{"current":{"commit":"%s","subject":%s},"available":[%s],"state":"%s","error":%s,"checked_at":"%s","log_tail":%s,"auto":%s}\n' \
    "$cur" "$(json_str "$cur_subj")" "$avail" "$1" "$(json_str "${2:-}")" "$(cat "$STATE_DIR/checked_at" 2>/dev/null || now)" "$(json_str "$tail_txt")" "$AUTO" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

AUTO=true
grep -q '"auto"[[:space:]]*:[[:space:]]*false' data/update-settings.json 2>/dev/null && AUTO=false

# Was "Update now" tapped since the last one we handled?
REQ=$(grep -o '"at"[[:space:]]*:[[:space:]]*"[^"]*"' data/update-request.json 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/')
HANDLED=$(cat "$STATE_DIR/handled_request" 2>/dev/null || true)
REQUESTED=false; [ -n "$REQ" ] && [ "$REQ" != "$HANDLED" ] && REQUESTED=true

# Fetch at most every 5 minutes, unless asked to update now.
LAST=$(cat "$STATE_DIR/fetched_epoch" 2>/dev/null || echo 0)
if $REQUESTED || [ "${1:-}" = "--force" ] || [ $(( $(date +%s) - LAST )) -ge 290 ]; then
  # A server set up with a deploy key keeps working if the repository goes public or the key goes away:
  # when the key can't fetch but the public address can, switch to the public address.
  ORIGIN=$(git remote get-url origin 2>/dev/null)
  if [[ "$ORIGIN" == git@github-heartwood:* ]] && ! git fetch -q origin main 2>/dev/null; then
    PUBLIC="https://github.com/${ORIGIN#git@github-heartwood:}"
    GIT_TERMINAL_PROMPT=0 git ls-remote -q "$PUBLIC" main >/dev/null 2>&1 && git remote set-url origin "$PUBLIC" && echo "== $(date '+%F %T') now following $PUBLIC"
  fi
  if git fetch -q origin main 2>"$STATE_DIR/fetch.err"; then
    date +%s > "$STATE_DIR/fetched_epoch"; now > "$STATE_DIR/checked_at"
  else
    write_status failed "Couldn't reach GitHub: $(tail -n 2 "$STATE_DIR/fetch.err")"; exit 1
  fi
fi

LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse origin/main)
NEW=false; [ "$LOCAL" != "$REMOTE" ] && NEW=true
$REQUESTED && echo "$REQ" > "$STATE_DIR/handled_request"

DO=false
if [ "${1:-}" = "--force" ]; then DO=true
elif $NEW && $REQUESTED; then DO=true
elif $NEW && $AUTO && [ "$REMOTE" != "$(cat "$STATE_DIR/failed_commit" 2>/dev/null)" ]; then DO=true  # don't retry a failed update on its own
fi
if ! $DO; then
  # Keep showing a failed update (with its log) until it's retried or a newer version arrives.
  if $NEW && [ "$REMOTE" = "$(cat "$STATE_DIR/failed_commit" 2>/dev/null)" ]; then write_status failed "$(cat "$STATE_DIR/failed_msg" 2>/dev/null)"; else write_status idle ""; fi
  exit 0
fi

echo "== $(date '+%F %T') updating ${LOCAL:0:7} → ${REMOTE:0:7}"
write_status updating ""
git reset -q --hard origin/main
printf '{"commit":"%s","subject":%s,"at":"%s"}\n' "$(git rev-parse --short HEAD)" "$(json_str "$(git log -1 --format=%s)")" "$(now)" > data/deployed.json
if ./deploy/install.sh < /dev/null > "$LOG" 2>&1; then
  echo "== $(date '+%F %T') installed $(git log -1 --format='%h %s')"
  rm -f "$STATE_DIR/failed_commit"
  write_status idle ""
else
  # Roll back to the version that was working, so a bad update never leaves Heartwood down.
  echo "== $(date '+%F %T') install FAILED (see $LOG); rolling back to ${LOCAL:0:7}"
  cp "$LOG" "$STATE_DIR/failed-install.log"
  echo "$REMOTE" > "$STATE_DIR/failed_commit"
  git reset -q --hard "$LOCAL"
  printf '{"commit":"%s","subject":%s,"at":"%s"}\n' "$(git rev-parse --short HEAD)" "$(json_str "$(git log -1 --format=%s)")" "$(now)" > data/deployed.json
  if ./deploy/install.sh < /dev/null > "$STATE_DIR/rollback.log" 2>&1; then
    echo "== $(date '+%F %T') rolled back to $(git log -1 --format='%h %s')"
  else
    echo "== $(date '+%F %T') ROLLBACK ALSO FAILED (see $STATE_DIR/rollback.log)"
  fi
  cp "$STATE_DIR/failed-install.log" "$LOG"
  echo "Update ${REMOTE:0:7} didn't start, so Heartwood went back to ${LOCAL:0:7}. Tap Update now to try again; the last lines of the failed install are below." > "$STATE_DIR/failed_msg"
  write_status failed "$(cat "$STATE_DIR/failed_msg")"
  exit 1
fi
