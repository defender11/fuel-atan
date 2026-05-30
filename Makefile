COMPOSE_FILE := docker/docker-compose.yml

.PHONY: help up down ps logs tg-up tg-down tg-logs tg-test

help:
	@echo "Fuel ATAN Docker commands:"
	@echo "  make tg-up     Start/rebuild Telegram checker only"
	@echo "  make tg-down   Stop Telegram checker only"
	@echo "  make tg-logs   Follow Telegram checker logs"
	@echo "  make tg-test   Send one Telegram test message"
	@echo "  make up        Start/rebuild monitor + api"
	@echo "  make down      Stop and remove compose stack"
	@echo "  make ps        Show compose services"
	@echo "  make logs      Follow all compose logs"

up:
	docker compose -f $(COMPOSE_FILE) up -d --build

down:
	docker compose -f $(COMPOSE_FILE) down

ps:
	docker compose -f $(COMPOSE_FILE) ps

logs:
	docker compose -f $(COMPOSE_FILE) logs -f

tg-up:
	./docker/tg-up.sh

tg-down:
	./docker/tg-down.sh

tg-logs:
	./docker/tg-logs.sh

tg-test:
	./docker/tg-test.sh
