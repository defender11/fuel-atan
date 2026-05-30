# Runbook

## Предусловия
- Настроены `.env.base` и `.env.local`.
- Для серверного Docker-запуска доступны Docker Engine 24+, Docker Compose v2 и `make`.
- Для локального Node/PM2-запуска доступны Node.js 18+, `npm` и `pm2`.

## Серверный Docker-запуск Telegram-чекалки
- Тест Telegram: `make tg-test`
- Запуск/пересборка: `make tg-up`
- Логи: `make tg-logs`
- Остановка: `make tg-down`

`monitor` в Compose — это Telegram-чекалка. `api` — веб/API/дашборд.

## Серверный Docker-запуск полного стека
- Запуск/пересборка `monitor + api`: `make up`
- Статус сервисов: `make ps`
- Логи всех сервисов: `make logs`
- Остановка и удаление stack: `make down`

## Локальный запуск (source)
- Monitor: `npm run start`
- API: `npm run start:api`

## Локальный запуск (dist)
1. Собрать артефакты: `npm run build`
2. Запустить monitor: `npm run start:dist:monitor`
3. Запустить api: `npm run start:dist:api`

## PM2 (production)
1. Собрать артефакты: `npm run build`
2. Запуск обоих сервисов: `npm run pm2:start:all`
3. Перезапуск: `npm run pm2:restart:all`
4. Логи: `npm run pm2:logs:all`
5. Остановка: `npm run pm2:stop:all`
6. Удаление процессов: `npm run pm2:delete:all`

`ecosystem.config.cjs` использует:
- `dist/monitor.js`
- `dist/api.js`
- `DASHBOARD_FILE=./dist/index.html` для API-процесса.

## Диагностика
- Проверка синтаксиса и связности: `npm run check`
- Полный CI-цикл локально: `npm run ci`
- Health endpoint API: `GET /health`
- Логи monitor: JSON в `stdout` и daily-файлы в `LOG_DIR`.
- Логи Docker TG-чекалки: `make tg-logs`.
