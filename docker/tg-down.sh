#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "[fuel-atan] Stopping Telegram checker only..."
docker compose -f "$COMPOSE_FILE" stop monitor

echo "[fuel-atan] Telegram checker status:"
docker compose -f "$COMPOSE_FILE" ps monitor
