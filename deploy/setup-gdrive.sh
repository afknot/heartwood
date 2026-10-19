#!/usr/bin/env bash
# Connect encrypted backups to your Google Drive.
# Restic encrypts everything on this server first; Google only stores unreadable chunks.
# Heartwood asks for the narrowest Drive access ("drive.file"): it can only see files it created.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p rclone

echo "== Building the backup container (restic + rclone)"
docker compose --profile backup build backup

if [ -s rclone/rclone.conf ] && grep -q '^\[gdrive\]' rclone/rclone.conf; then
  echo "== Google Drive is already connected (rclone/rclone.conf). Delete that file to reconnect."
else
  cat <<'MSG'

== Connecting Google Drive
In a moment rclone prints a command that starts with:   rclone authorize "drive" ...
1. On your Mac, install rclone once if needed:           brew install rclone
2. Paste that whole command into a Mac terminal. A browser opens: sign in to Google and allow access.
3. Copy the long token it prints back on the Mac and paste it here.

MSG
  docker compose --profile backup run --rm -it --entrypoint rclone backup \
    config create gdrive drive scope=drive.file config_is_local=false
fi

# Point restic at Drive, and make sure there's a passphrase.
if grep -qE '^RESTIC_REPOSITORY=' .env; then
  sed -i -E 's|^RESTIC_REPOSITORY=.*|RESTIC_REPOSITORY=rclone:gdrive:Heartwood-backups|' .env
else
  printf '\nRESTIC_REPOSITORY=rclone:gdrive:Heartwood-backups\n' >> .env
fi
if ! grep -qE '^RESTIC_PASSWORD=.+' .env; then
  echo
  echo "== Choose a backup passphrase. Save it in your password manager: without it the backups can't be opened."
  while true; do
    read -rsp "Passphrase: " p1; echo
    read -rsp "Again: " p2; echo
    [ -n "$p1" ] && [ "$p1" = "$p2" ] && break
    echo "They didn't match (or were empty). Try again."
  done
  printf 'RESTIC_PASSWORD=%s\n' "$p1" >> .env
fi

echo "== Starting backups to Google Drive"
./deploy/install.sh
echo
echo "Done. The first backup runs now; check it with:  docker compose logs --tail 20 backup"
echo "In Google Drive you'll see a 'Heartwood-backups' folder of encrypted files."
