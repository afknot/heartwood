#!/bin/sh
set -e
# Make sure the data folder (often a bind mount created by root) belongs to the
# unprivileged "node" user, then drop root before starting the app.
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
