#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "[fuel-atan] Building monitor image..."
docker compose -f "$COMPOSE_FILE" build monitor

echo "[fuel-atan] Sending Telegram test message..."
docker compose -f "$COMPOSE_FILE" run --rm --no-deps monitor node dist/test-telegram.js
