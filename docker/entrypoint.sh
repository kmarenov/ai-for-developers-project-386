#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-8080}"
BACKEND_PORT="${BACKEND_PORT:-8081}"

envsubst '${PORT}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# The backend keeps its own PORT separate from the public one, so the nginx
# listener and the Go server never compete for the same socket.
PORT="$BACKEND_PORT" /app/server &
backend_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

shutdown() {
    trap - TERM INT
    kill -TERM "$backend_pid" "$nginx_pid" 2>/dev/null || true
}

trap shutdown TERM INT

# Exit as soon as either process dies: a crashed backend must not leave the
# container serving stale SPA files through nginx.
set +e
wait -n "$backend_pid" "$nginx_pid"
status=$?
set -e

shutdown
wait "$backend_pid" "$nginx_pid" 2>/dev/null || true

# A signal-driven shutdown (128 + signal) is a clean stop for the container.
if [ "$status" -gt 128 ]; then
    exit 0
fi
exit "$status"
