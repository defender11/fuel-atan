#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "[fuel-atan] Starting Telegram checker only..."
docker compose -f "$COMPOSE_FILE" up -d --build --no-deps monitor

if docker compose -f "$COMPOSE_FILE" ps --services --filter "status=running" | grep -qx "api"; then
  echo "[fuel-atan] Stopping API service for monitor-only mode..."
  docker compose -f "$COMPOSE_FILE" stop api >/dev/null
fi

echo "[fuel-atan] Monitor status:"
docker compose -f "$COMPOSE_FILE" ps monitor

echo "[fuel-atan] Logs: docker compose -f docker/docker-compose.yml logs -f monitor"
