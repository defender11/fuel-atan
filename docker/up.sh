#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "[fuel-atan] Starting docker stack..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

if command -v curl >/dev/null 2>&1; then
  echo "[fuel-atan] Waiting for API health..."
  i=0
  until [ "$i" -ge 30 ]; do
    if curl -fsS "http://127.0.0.1:4010/health" >/dev/null 2>&1; then
      echo "[fuel-atan] API is healthy: http://127.0.0.1:4010/health"
      break
    fi
    i=$((i + 1))
    sleep 2
  done
fi

echo "[fuel-atan] Services status:"
docker compose -f "$COMPOSE_FILE" ps

echo "[fuel-atan] Dashboard: http://localhost:4010/dashboard"
