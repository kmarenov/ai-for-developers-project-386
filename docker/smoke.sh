#!/usr/bin/env bash
set -euo pipefail

IMAGE="${SMOKE_IMAGE:-calendar-slot-code:smoke}"
CONTAINER="${SMOKE_CONTAINER:-calendar-slot-smoke}"
SMOKE_PORT="${SMOKE_PORT:-18080}"
BASE_URL="http://127.0.0.1:${SMOKE_PORT}"
TMP_DIR="$(mktemp -d)"

cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
    echo "docker smoke failed: $*" >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
}

echo "Building $IMAGE"
docker build -t "$IMAGE" .

echo "Starting the container on PORT=$SMOKE_PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run --rm -d \
    --name "$CONTAINER" \
    -e "PORT=$SMOKE_PORT" \
    -p "127.0.0.1:${SMOKE_PORT}:${SMOKE_PORT}" \
    "$IMAGE" >/dev/null

ready=false
for _ in $(seq 1 30); do
    if curl -fsS "$BASE_URL/health" -o "$TMP_DIR/health.json" 2>/dev/null; then
        ready=true
        break
    fi
    sleep 1
done

[ "$ready" = true ] || fail "health endpoint did not become ready"
grep -q '"status":"ok"' "$TMP_DIR/health.json" || fail "unexpected /health body"

curl -fsS -o /dev/null "$BASE_URL/" || fail "SPA root is not served"
curl -fsS -o /dev/null "$BASE_URL/meeting-types" || fail "meeting-types API is not served"

status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$BASE_URL/meeting-types")
[ "$status" = "200" ] || fail "meeting-types document returned $status"

status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$BASE_URL/admin")
[ "$status" = "200" ] || fail "admin document returned $status"

echo "Docker smoke passed: health, SPA, API and direct SPA routes"
