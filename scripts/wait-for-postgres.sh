#!/usr/bin/env bash
# Used only for local (non-compose) workflows; compose relies on the postgres
# healthcheck + depends_on: condition: service_healthy instead.
set -euo pipefail
HOST="${1:-localhost}"
PORT="${2:-5432}"
TRIES=30
until pg_isready -h "$HOST" -p "$PORT" >/dev/null 2>&1 || [ "$TRIES" -eq 0 ]; do
  TRIES=$((TRIES - 1))
  echo "waiting for postgres at $HOST:$PORT... ($TRIES tries left)"
  sleep 1
done
if [ "$TRIES" -eq 0 ]; then
  echo "postgres did not become ready in time" >&2
  exit 1
fi
echo "postgres is ready"
