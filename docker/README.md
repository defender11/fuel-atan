# Docker Deployment

## Что в папке
- `Dockerfile` — multi-stage сборка с генерацией `dist/*`.
- `docker-compose.yml` — запуск двух сервисов: `monitor` и `api`.
- `tg-*.sh` — короткие команды для Telegram-чекалки.

## Требования
- Docker Engine 24+
- Docker Compose v2+

## Подготовка
1. Проверьте `.env.base` и `.env.local` в корне проекта.
2. Убедитесь, что корректно заданы:
- `ATAN_API_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Основные команды через Make
На сервере npm не нужен. Из корня проекта:

```bash
make tg-up      # запустить/пересобрать Telegram-чекалку
make tg-logs    # смотреть логи чекалки
make tg-down    # остановить чекалку
make tg-test    # отправить тестовое сообщение в Telegram
```

Полная связка с API/dashboard:

```bash
make up
make logs
make down
```

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
make tg-up
```

Или через прямой скрипт:

```bash
./docker/tg-up.sh
```

Низкоуровневая команда Compose:

```bash
docker compose -f docker/docker-compose.yml up -d --build --no-deps monitor
```

Логи чекалки:

```bash
make tg-logs
```

Тестовое сообщение в Telegram без запуска постоянной чекалки:

```bash
make tg-test
```

Остановить только чекалку:

```bash
make tg-down
```

Прямые скрипты остаются доступны: `./docker/tg-up.sh`, `./docker/tg-logs.sh`, `./docker/tg-test.sh`, `./docker/tg-down.sh`.

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

Если нужна только Telegram-чекалка:

```bash
make tg-up
```

## Примечания
- Контейнеры читают env через `env_file` (`.env.base` + `.env.local`).
- `data/` смонтирована как volume `../data:/app/data` для сохранения state и логов.
- `api` использует `DASHBOARD_FILE=/app/dist/index.html`.
- `restart: always` у обоих сервисов включает автоподнятие контейнеров после рестарта Docker/хоста.
- `.dockerignore` исключает `.env.local`, `data/` и готовый `dist/` из build context; runtime получает `.env.local` только через `env_file`.
