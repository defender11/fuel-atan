# Docker Deployment

## Что в папке
- `Dockerfile` — multi-stage сборка с генерацией `dist/*`.
- `docker-compose.yml` — запуск двух сервисов: `monitor` и `api`.

## Требования
- Docker Engine 24+
- Docker Compose v2+

## Подготовка
1. Проверьте `.env.base` и `.env.local` в корне проекта.
2. Убедитесь, что корректно заданы:
- `ATAN_API_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Сборка и запуск полной связки
Из корня проекта:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Или через готовый скрипт:

```bash
./docker/up.sh
```

Проверка:

```bash
docker compose -f docker/docker-compose.yml ps
docker compose -f docker/docker-compose.yml logs -f
```

Dashboard/API:
- `http://localhost:4010/`
- `http://localhost:4010/dashboard`

## Запуск только Telegram-чекалки
Если нужен только мониторинг ATAN -> Telegram без API и dashboard:

```bash
docker compose -f docker/docker-compose.yml up -d --build --no-deps monitor
```

Или через отдельный скрипт:

```bash
./docker/up-monitor.sh
```

Логи чекалки:

```bash
docker compose -f docker/docker-compose.yml logs -f monitor
```

Остановить только чекалку:

```bash
docker compose -f docker/docker-compose.yml stop monitor
```

## Остановка и удаление
```bash
docker compose -f docker/docker-compose.yml down
```

С удалением образа и volume:
```bash
docker compose -f docker/docker-compose.yml down --rmi local -v
```

## Обновление версии
После изменений в коде:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

## Примечания
- Контейнеры читают env через `env_file` (`.env.base` + `.env.local`).
- `data/` смонтирована как volume `../data:/app/data` для сохранения state и логов.
- `api` использует `DASHBOARD_FILE=/app/dist/index.html`.
- `restart: always` у обоих сервисов включает автоподнятие контейнеров после рестарта Docker/хоста.
- `.dockerignore` исключает `.env.local`, `data/` и готовый `dist/` из build context; runtime получает `.env.local` только через `env_file`.
