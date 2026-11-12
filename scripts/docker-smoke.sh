#!/usr/bin/env bash
# Smoke + persistence check for the headless Docker image.
#
#   docker build -t debriddownloader .
#   bash scripts/docker-smoke.sh debriddownloader
#
# 1. Starts the image with a fresh /config volume and no token env, waits for 200 from /health.
# 2. Reads the server token generated into /config/secrets.json, saves a setting with
#    PUT /api/settings.
# 3. Removes the container, starts a new one on the same /config volume, and checks that the
#    secret (the token) and the setting are both still there.
#
# Needs docker, curl and jq. Cleans up its container and volume on exit.
set -euo pipefail

IMAGE="${1:?usage: docker-smoke.sh <image>}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
SAVED_CONCURRENCY=7

NAME="dd-smoke-$$"
VOLUME="dd-smoke-config-$$"
BASE=""

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '\n---- container logs (%s) ----\n' "$NAME" >&2
    docker logs "$NAME" >&2 2>&1 || true
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

for tool in docker curl jq; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done

# Start the container on the shared /config volume and wait for /health. Sets BASE.
start() {
  docker run -d --name "$NAME" -p 127.0.0.1::8777 -v "$VOLUME:/config" "$IMAGE" >/dev/null
  BASE="http://$(docker port "$NAME" 8777/tcp | head -n1)"
  for _ in $(seq "$HEALTH_TIMEOUT"); do
    if [ "$(http_code "$BASE/health")" = 200 ]; then
      return 0
    fi
    [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" = true ] || fail "the container exited"
    sleep 1
  done
  fail "/health did not return 200 within ${HEALTH_TIMEOUT}s"
}

# http_code <url> [curl args...]: the status code, 000 when the connection fails.
http_code() {
  local url="$1"
  shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" "$url" || true
}

stored_token() {
  docker exec "$NAME" cat /config/secrets.json | jq -er '."server.auth_token"'
}

api() { # api <path> [curl args...]: body on stdout, fails on a non-2xx status
  local path="$1"
  shift
  curl -fsS --max-time 10 -H "Authorization: Bearer $TOKEN" "$@" "$BASE$path"
}

step "Start $IMAGE with a fresh /config volume"
docker volume create "$VOLUME" >/dev/null
start
echo "/health is 200 at $BASE"

step "Auth: generated token in /config/secrets.json"
TOKEN="$(stored_token)" || fail "no server.auth_token in /config/secrets.json"
[ "$(http_code "$BASE/api/downloads")" = 401 ] || fail "an unauthenticated request was not 401"
[ "$(http_code "$BASE/api/downloads" -H "Authorization: Bearer $TOKEN")" = 200 ] \
  || fail "the generated token was not accepted"
echo "401 without the token, 200 with it"

step "Save a setting through the HTTP API"
settings="$(api /api/settings)"
[ "$(jq -r .download_folder <<<"$settings")" = /downloads ] \
  || fail "download_folder was not seeded to /downloads: $settings"
[ "$(jq -r .max_concurrent_downloads <<<"$settings")" != "$SAVED_CONCURRENCY" ] \
  || fail "max_concurrent_downloads is already $SAVED_CONCURRENCY"
jq --argjson n "$SAVED_CONCURRENCY" '{settings: (. + {max_concurrent_downloads: $n})}' <<<"$settings" \
  | api /api/settings -X PUT -H 'Content-Type: application/json' --data-binary @- >/dev/null
echo "PUT /api/settings max_concurrent_downloads=$SAVED_CONCURRENCY"

step "Replace the container, same /config volume"
docker stop "$NAME" >/dev/null
docker rm "$NAME" >/dev/null
start
echo "/health is 200 at $BASE"

step "The secret and the setting persisted"
[ "$(stored_token)" = "$TOKEN" ] || fail "server.auth_token changed across the restart"
[ "$(http_code "$BASE/api/downloads")" = 401 ] || fail "an unauthenticated request was not 401"
[ "$(http_code "$BASE/api/downloads" -H "Authorization: Bearer $TOKEN")" = 200 ] \
  || fail "the token from before the restart was not accepted"
after="$(api /api/settings | jq -r .max_concurrent_downloads)"
[ "$after" = "$SAVED_CONCURRENCY" ] \
  || fail "max_concurrent_downloads is $after after the restart, expected $SAVED_CONCURRENCY"
echo "token unchanged and still accepted; max_concurrent_downloads=$after"

printf '\nOK: %s passed the smoke and persistence checks\n' "$IMAGE"
