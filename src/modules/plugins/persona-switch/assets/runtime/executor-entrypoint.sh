#!/bin/sh
set -eu
umask 077
chromedriver --port=9515 --allowed-ips=127.0.0.1 --log-level=OFF &
driver_pid=$!
node /app/dist/apps/persona-executor/server.js &
executor_pid=$!
trap 'kill "$executor_pid" "$driver_pid" 2>/dev/null || true' EXIT INT TERM
wait "$executor_pid"
