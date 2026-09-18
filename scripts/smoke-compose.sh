#!/usr/bin/env bash
# Module 11 hardening: automated version of build-plan.md's "confirm a clean docker
# compose up from an empty clone" and the Verification table's
# `tests/smoke/compose.spec.ts` row. Not a Vitest spec — it drives real `docker
# compose`, which Vitest has no business orchestrating — but it is the actual
# executable proof behind that row, runnable on demand via `npm run test:compose`.
#
# Tears the stack down (including volumes — this is a fresh-clone simulation, not a
# dev-data-preserving restart) and brings it back up from nothing, then proves all four
# services actually work together: postgres healthy, migrate-seed exits 0, api's own
# healthcheck passes, and the frontend actually serves HTML on 5173.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found — copying .env.example (matches README's documented quick start)."
  cp .env.example .env
fi

if [ ! -d ../incident-web ]; then
  echo "FAIL: ../incident-web must exist as a sibling checkout (docker-compose.yml's web service builds it)." >&2
  exit 1
fi

echo "== Tearing down any existing stack, including volumes (fresh-clone simulation) =="
docker compose down -v --remove-orphans

echo "== Building and starting the full stack =="
docker compose up -d --build

cleanup() {
  echo "== Stack logs (last 40 lines per service) on exit =="
  docker compose logs --tail=40 || true
  echo "== Tearing down =="
  docker compose down -v --remove-orphans || true
}
trap cleanup EXIT

echo "== Waiting for migrate-seed to exit successfully =="
for i in $(seq 1 90); do
  # `docker compose ps` (without -a) omits exited containers entirely, not just
  # hides their status — this bit the first draft of this script, which polled
  # without -a and always saw an empty string, timing out even on a run where
  # migrate-seed had already finished successfully seconds earlier.
  status=$(docker compose ps -a migrate-seed --format '{{.State}}' 2>/dev/null || echo '')
  if [ "$status" = "exited" ]; then
    code=$(docker inspect --format '{{.State.ExitCode}}' "$(docker compose ps -a -q migrate-seed)")
    if [ "$code" != "0" ]; then
      echo "FAIL: migrate-seed exited with code $code" >&2
      exit 1
    fi
    echo "migrate-seed completed successfully."
    break
  fi
  sleep 2
  if [ "$i" = 90 ]; then
    echo "FAIL: migrate-seed never reached 'exited' within 180s" >&2
    exit 1
  fi
done

echo "== Waiting for the api container's own healthcheck to report healthy =="
for i in $(seq 1 60); do
  health=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null || echo '')
  if [ "$health" = "healthy" ]; then
    echo "api is healthy."
    break
  fi
  sleep 2
  if [ "$i" = 60 ]; then
    echo "FAIL: api never reported healthy within 120s (last status: $health)" >&2
    exit 1
  fi
done

echo "== Verifying the health endpoint from outside the compose network =="
health_body=$(curl -sf http://localhost:4000/api/v1/health)
echo "$health_body"
echo "$health_body" | grep -q '"status":"ok"' || { echo "FAIL: health endpoint did not report ok" >&2; exit 1; }

echo "== Verifying an unauthenticated protected route 401s through the error envelope =="
auth_status=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/v1/incidents)
[ "$auth_status" = "401" ] || { echo "FAIL: expected 401 from an unauthenticated /incidents, got $auth_status" >&2; exit 1; }

echo "== Verifying the frontend serves HTML on 5173 =="
for i in $(seq 1 30); do
  if curl -sf http://localhost:5173 -o /tmp/incident-web-smoke.html; then
    grep -qi '<div id="root"' /tmp/incident-web-smoke.html && break
  fi
  sleep 2
  if [ "$i" = 30 ]; then
    echo "FAIL: frontend never served the expected HTML shell within 60s" >&2
    exit 1
  fi
done
rm -f /tmp/incident-web-smoke.html
echo "frontend is serving."

echo
echo "PASS — clean docker compose up from an empty clone: all four services healthy and talking to each other."
