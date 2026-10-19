#!/bin/sh
# Runs inside the backup container (restic + rclone): nightly encrypted backup of Heartwood's data.
# Backs up the nightly database snapshot (never the live database), audio, files and photos.
#
# Everything can be set up from Heartwood's Settings, with no terminal:
#   /status/config.json     passphrase and destination chosen in Settings (or RESTIC_* in .env)
#   /status/status.json     how the last backup went, read by Settings
#   /status/request         "Back up now"
#   /status/drive-start     "Connect Google Drive": start a sign-in and publish its link
#   /status/drive-callback  the address Google sent you back to, pasted into Settings
#   /status/drive.json      where the Google Drive connection stands
set -u
STATUS_DIR=/status
mkdir -p "$STATUS_DIR" 2>/dev/null || true
HOUR="${BACKUP_HOUR:-03}"; MIN="${BACKUP_MINUTE:-30}"
DRIVE_OPTS="$(printf '{"scope":"drive.file"}' | base64 | tr -d '\n=' | tr '+/' '-_')"

esc() { printf '%s' "$1" | tr '\n\r\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-600; }
jget() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" "$2" 2>/dev/null | head -n 1; }

# Settings beat .env, so the whole thing can be managed from the app.
load_config() {
  if [ -f "$STATUS_DIR/config.json" ]; then
    p="$(jget password "$STATUS_DIR/config.json")"; r="$(jget repository "$STATUS_DIR/config.json")"
    [ -n "$p" ] && export RESTIC_PASSWORD="$p"
    [ -n "$r" ] && export RESTIC_REPOSITORY="$r"
  fi
  export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-/backups}"
}

# Tell Heartwood how the last backup went, so Settings shows the truth instead of a guess.
write_status() { # ok error
  prev_success="$(jget last_success "$STATUS_DIR/status.json")"
  success="$prev_success"; [ "$1" = "true" ] && success="$(date -u +%FT%TZ)"
  count=0; latest=""; size=0
  if [ "$1" = "true" ]; then
    count="$(restic snapshots --tag heartwood --json 2>/dev/null | grep -o '"time"' | wc -l | tr -d ' ')"
    latest="$(restic snapshots --tag heartwood --latest 1 --json 2>/dev/null | sed -n 's/.*"time":"\([^"]*\)".*/\1/p' | head -n 1)"
    size="$(restic stats --mode raw-data --json 2>/dev/null | sed -n 's/.*"total_size":\([0-9]*\).*/\1/p' | head -n 1)"
  fi
  printf '{"last_attempt":"%s","last_success":"%s","ok":%s,"error":"%s","repository":"%s","snapshots":%s,"latest":"%s","size":%s}\n' \
    "$(date -u +%FT%TZ)" "$success" "$1" "$(esc "$2")" "$(esc "$RESTIC_REPOSITORY")" "${count:-0}" "$latest" "${size:-0}" > "$STATUS_DIR/status.json.tmp" \
    && mv "$STATUS_DIR/status.json.tmp" "$STATUS_DIR/status.json"
}

LOG="$STATUS_DIR/backup.log"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; tail -n 200 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"; }

# Is the repository there and readable? Only a repository that truly doesn't exist yet gets created:
# any other problem (a stale lock, a network or sign-in error) is reported as itself.
open_repo() {
  out="$(restic cat config 2>&1)" && return 0
  log "check: $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
  if printf '%s' "$out" | grep -qiE 'repository does not exist|Is there a repository|config: no such file|file does not exist|directory not found|not found'; then
    out="$(restic init 2>&1)" && { log "created the backup repository"; return 0; }
    printf '%s' "$out" | grep -qi 'already exists' || { REPO_ERR="Couldn't create the backup repository: $(printf '%s' "$out" | tail -n 2)"; return 1; }
  fi
  # A backup cut off by a restart (updates restart this service) can leave a stale lock behind.
  restic unlock >/dev/null 2>&1
  sleep 5
  out="$(restic cat config 2>&1)" && return 0
  REPO_ERR="Couldn't open the backup repository: $(printf '%s' "$out" | grep -iE 'error|fatal|denied|token|auth|quota|lock|unable|timeout|refused|password' | tail -n 2)"
  [ "$REPO_ERR" = "Couldn't open the backup repository: " ] && REPO_ERR="Couldn't open the backup repository: $(printf '%s' "$out" | tail -n 2)"
  return 1
}

backup_once() {
  out="$(restic backup --tag heartwood --host heartwood /data/snapshots /data/audio /data/files /data/avatars 2>&1)"; rc=$?
  printf '%s\n' "$out" | tail -n 5
  log "backup exit $rc: $(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')"
}

run_backup() {
  load_config
  if [ -z "${RESTIC_PASSWORD:-}" ]; then return; fi
  echo "== $(date) backup starting"; log "backup starting ($RESTIC_REPOSITORY)"
  if ! open_repo && { sleep 30; ! open_repo; }; then
    echo "$REPO_ERR"; log "$REPO_ERR"; write_status false "$REPO_ERR"; return
  fi
  restic unlock >/dev/null 2>&1   # clears only locks left by processes that are gone
  backup_once
  # One retry for a passing network or Drive hiccup.
  if [ "$rc" != "0" ] && [ "$rc" != "3" ]; then sleep 60; restic unlock >/dev/null 2>&1; backup_once; fi
  # Exit code 3 means a few files couldn't be read (e.g. removed mid-backup); the snapshot is still saved.
  if [ "$rc" = "0" ] || [ "$rc" = "3" ]; then
    restic forget --tag heartwood --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune 2>&1 | tail -n 3
    # Weekly: verify a slice of the stored data can actually be read back.
    [ "$(date +%u)" = "7" ] && restic check --read-data-subset=5% 2>&1 | tail -n 2
    write_status true ""
  else
    write_status false "$(printf '%s' "$out" | grep -iE 'error|fatal|denied|token|quota|unable|lock|timeout' | tail -n 3)"
  fi
  echo "== $(date) backup finished (exit $rc)"; log "backup finished (exit $rc)"
}


# ---------- connecting Google Drive from Settings ----------
# rclone runs its usual sign-in, waiting on 127.0.0.1:53682 inside this container. Google sends your
# browser back to that address on your own device, where it doesn't load; you paste the address
# into Settings, and it's handed to rclone here. Access is limited to files Heartwood creates.
drive_state() { printf '{"stage":"%s","auth_url":"%s","error":"%s","at":"%s"}\n' "$1" "$(esc "${2:-}")" "$(esc "${3:-}")" "$(date -u +%FT%TZ)" > "$STATUS_DIR/drive.json"; }
# Older rclone prints the token JSON; newer prints it base64-wrapped as {"token":"<json>"}.
unwrap_token() {
  t="$1"
  case "$t" in "{"*) printf '%s' "$t"; return ;; esac
  b="$(printf '%s' "$t" | tr -- '-_' '+/')"
  while [ $(( ${#b} % 4 )) -ne 0 ]; do b="$b="; done
  d="$(printf '%s' "$b" | base64 -d 2>/dev/null)"
  case "$d" in
    '{"token":"'*) printf '%s' "$d" | sed 's/^{"token":"//; s/"}[[:space:]]*$//; s/\\"/"/g' ;;
    "{"*) printf '%s' "$d" ;;
    *) printf '%s' "$t" ;;
  esac
}
AUTH_PID=""
drive_start() {
  [ -n "$AUTH_PID" ] && kill "$AUTH_PID" 2>/dev/null
  rm -f "$STATUS_DIR/.authorize.log"
  rclone authorize drive "$DRIVE_OPTS" --auth-no-open-browser > "$STATUS_DIR/.authorize.log" 2>&1 &
  AUTH_PID=$!
  local_url=""
  for _ in $(seq 1 30); do
    local_url="$(grep -o 'http://127.0.0.1:53682/auth?state=[A-Za-z0-9_-]*' "$STATUS_DIR/.authorize.log" | head -n 1)"
    [ -n "$local_url" ] && break; sleep 1
  done
  [ -z "$local_url" ] && { drive_state error "" "Couldn't start the Google sign-in: $(tail -n 3 "$STATUS_DIR/.authorize.log")"; return; }
  google="$(curl -s -o /dev/null -w '%{redirect_url}' "$local_url")"
  [ -z "$google" ] && { drive_state error "" "Couldn't get the Google sign-in link."; return; }
  drive_state waiting "$google"
}
drive_finish() {
  pasted="$(cat "$STATUS_DIR/drive-callback")"; rm -f "$STATUS_DIR/drive-callback"
  query="$(printf '%s' "$pasted" | sed -n 's/^[^?]*?\(.*\)$/\1/p' | tr -d ' \r\n')"
  if [ -z "$query" ] || [ -z "$AUTH_PID" ]; then drive_state error "" "That sign-in has expired. Start again."; return; fi
  curl -s -o /dev/null "http://127.0.0.1:53682/?$query"
  for _ in $(seq 1 30); do kill -0 "$AUTH_PID" 2>/dev/null || break; sleep 1; done
  AUTH_PID=""
  token="$(sed -n '/--->/,/<---/p' "$STATUS_DIR/.authorize.log" | sed '1d;$d' | tr -d '\n' | sed 's/^ *//')"
  token="$(unwrap_token "$token")"
  if [ -z "$token" ]; then drive_state error "" "Google didn't accept that. Start again and paste the whole address. $(grep -iE 'error|fail' "$STATUS_DIR/.authorize.log" | tail -n 1)"; return; fi
  rclone config delete gdrive >/dev/null 2>&1
  if out="$(rclone config create gdrive drive scope=drive.file token="$token" config_is_local=false --non-interactive 2>&1)"; then
    rm -f "$STATUS_DIR/.authorize.log"
    drive_state connected
    run_backup
  else
    drive_state error "" "Couldn't save the connection: $(printf '%s' "$out" | tail -n 2)"
  fi
}

# On start, back up only if the last good backup is more than a day old. Updates restart this
# service, and starting a fresh backup on every restart is what used to leave stale locks behind.
last_ok="$(jget last_success "$STATUS_DIR/status.json")"
if [ "${BACKUP_ON_START:-1}" = "1" ]; then
  if [ -z "$last_ok" ] || [ $(( $(date -u +%s) - $(date -u -d "$(printf '%s' "$last_ok" | tr 'T' ' ' | tr -d 'Z')" +%s 2>/dev/null || echo 0) )) -gt 86400 ] || ! grep -q '"ok":true' "$STATUS_DIR/status.json" 2>/dev/null; then run_backup; fi
fi
last=""
while true; do
  now="$(date +%H:%M)"; today="$(date +%F)"
  if [ "$now" = "$HOUR:$MIN" ] && [ "$last" != "$today" ]; then run_backup; last="$today"; fi
  if [ -f "$STATUS_DIR/request" ]; then rm -f "$STATUS_DIR/request"; run_backup; fi
  if [ -f "$STATUS_DIR/drive-start" ]; then rm -f "$STATUS_DIR/drive-start"; drive_start; fi
  if [ -f "$STATUS_DIR/drive-callback" ]; then drive_finish; fi
  # A sign-in nobody finished: stop waiting after 20 minutes.
  if [ -n "$AUTH_PID" ] && [ -f "$STATUS_DIR/.authorize.log" ] && [ -n "$(find "$STATUS_DIR/.authorize.log" -mmin +20 2>/dev/null)" ]; then
    kill "$AUTH_PID" 2>/dev/null; AUTH_PID=""; drive_state expired
  fi
  sleep 5
done
