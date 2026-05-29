# Runbook

## Предусловия
- Node.js 18+.
- Настроены `.env.base` и `.env.local`.
- Доступны `pm2` и `npm`.

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
