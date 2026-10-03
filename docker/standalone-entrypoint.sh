#!/usr/bin/env bash
# Bootstraps a bundled Postgres (loopback-only, never exposed) alongside proof in one container,
# then runs both as this script's direct children. There's no process supervisor; the pattern is
# shelf's docker/standalone-entrypoint.sh. One bind-mounted directory holds both the photos and
# Postgres's data, as separate subdirectories.
set -euo pipefail

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
PROOF_DATA_DIR="${PROOF_DATA_DIR:-/data}"
PROOF_DB_PASSWORD="${PROOF_DB_PASSWORD:?PROOF_DB_PASSWORD is required}"

if ! getent group "$PGID" > /dev/null 2>&1; then
  addgroup -g "$PGID" proof
fi
GROUP_NAME="$(getent group "$PGID" | cut -d: -f1)"
if ! getent passwd "$PUID" > /dev/null 2>&1; then
  adduser -D -u "$PUID" -G "$GROUP_NAME" -H proof
fi
USER_NAME="$(getent passwd "$PUID" | cut -d: -f1)"

PHOTOS_DIR="$PROOF_DATA_DIR/photos"
PGDATA="$PROOF_DATA_DIR/postgres"
mkdir -p "$PHOTOS_DIR" "$PGDATA"
chown "$PUID:$PGID" "$PHOTOS_DIR" || echo "warning: could not chown $PHOTOS_DIR to $PUID:$PGID; continuing" >&2
chown postgres:postgres "$PGDATA" || echo "warning: could not chown $PGDATA to postgres; continuing" >&2
chmod 700 "$PGDATA" || true

export PROOF_DATA="$PHOTOS_DIR"
export PROOF_DB_URL="jdbc:postgresql://127.0.0.1:5432/proof"
export PROOF_DB_USER="proof"

# Postgres's socket/lock directory: normally created by Alpine's openrc service, which isn't used.
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su-exec postgres initdb -D "$PGDATA" --auth=trust --username=postgres >/tmp/initdb.log 2>&1
fi

# Started directly (not daemonised by pg_ctl), so it stays a child of this script. Loopback only.
su-exec postgres postgres -D "$PGDATA" -c listen_addresses=127.0.0.1 -c logging_collector=off &
PG_PID=$!

until su-exec postgres pg_isready -q -h 127.0.0.1 2>/dev/null; do
  sleep 0.3
done

# The role's password is re-synced from the environment on every start.
su-exec postgres psql -v ON_ERROR_STOP=1 -v pass="$PROOF_DB_PASSWORD" --username postgres --dbname postgres <<-'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'proof') THEN
    CREATE ROLE proof LOGIN;
  END IF;
END
$$;
ALTER ROLE proof WITH PASSWORD :'pass';
SELECT 'CREATE DATABASE proof OWNER proof' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'proof')\gexec
EOSQL

su-exec "$USER_NAME:$GROUP_NAME" java -cp /app/out:/app/lib/* MainKt &
APP_PID=$!

SHUTTING_DOWN=0
shutdown() {
  if [ "$SHUTTING_DOWN" = "1" ]; then return; fi
  SHUTTING_DOWN=1
  kill -TERM "$APP_PID" 2>/dev/null || true
  su-exec postgres pg_ctl -D "$PGDATA" -m fast stop 2>/dev/null || true
}
trap shutdown TERM INT

# Either process exiting ends the container: let Docker's restart policy handle it.
set +e
wait -n
EXIT_CODE=$?
set -e
shutdown
wait "$PG_PID" "$APP_PID" 2>/dev/null || true
exit "$EXIT_CODE"
