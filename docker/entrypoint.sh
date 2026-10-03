#!/usr/bin/env bash
# Runs the app as a user matching the host's PUID/PGID (PROJECT_BRIEF.md §8), so the photos, edits
# and sidecars it writes to the bind-mounted /data stay owned by whoever owns that directory on
# the host, not root. Copied from shelf's docker/entrypoint.sh.
set -euo pipefail

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if ! getent group "$PGID" > /dev/null 2>&1; then
  addgroup -g "$PGID" proof
fi
GROUP_NAME="$(getent group "$PGID" | cut -d: -f1)"

if ! getent passwd "$PUID" > /dev/null 2>&1; then
  adduser -D -u "$PUID" -G "$GROUP_NAME" -H proof
fi
USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"

mkdir -p "$PROOF_DATA"
# Best-effort, as in shelf: some hosts don't let a container chown. A directory that's already
# owned correctly needs no chown at all.
chown "$PUID:$PGID" "$PROOF_DATA" || echo "warning: could not chown $PROOF_DATA to $PUID:$PGID; continuing, assuming it's already correct" >&2

exec su-exec "$USER_NAME:$GROUP_NAME" "$@"
