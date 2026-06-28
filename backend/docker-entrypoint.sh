#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Container entrypoint. Bind-mounted host directories (./data/db, ./data/files)
# arrive owned by whatever UID created them on the host — typically root, since
# the Docker daemon creates missing bind-mount sources. The unprivileged `node`
# user the server runs as then cannot write there, so SQLite fails to create the
# database file with SQLITE_CANTOPEN.
#
# When started as root we fix ownership of the data directories, then drop to
# `node` (via gosu) to exec the server. If the container is already running as a
# non-root user (e.g. a compose `user:` override mapping to the host UID), we
# skip the chown and exec directly — the bind mount is writable by definition.
set -e

DB_DIR="$(dirname "${DATABASE_PATH:-/app/db/pkv.sqlite}")"
FILES_DIR=/app/files

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DB_DIR" "$FILES_DIR"
  chown -R node:node "$DB_DIR" "$FILES_DIR"
  exec gosu node "$@"
fi

exec "$@"
