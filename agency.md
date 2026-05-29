# Fuel ATAN: Цель проекта
- Мониторить наличие топлива на АЗС ATAN.
- Отправлять уведомления в Telegram только по целевым изменениям статуса топлива.
- Поддерживать удобный формат оповещений: карта + текстовый список АЗС.

## Текущая реализация
- Язык и рантайм: `Node.js` + `JavaScript`.
- Структура приложений:
- `apps/monitor` — опрос ATAN, сравнение snapshot, отправка Telegram.
- `apps/api` — HTTP API для dashboard и интеграций.
- `apps/dashboard` — UI дашборда (получает данные только через API).
- Dashboard (SPA):
- разделы: `Stations`, `Logs`, `Settings`;
- тултипы на ключевых элементах UI;
- легенда статусов топлива + цветные индикаторы в таблице;
- автообновление данных через select (`0/3/5/15/30` сек) с мини-прогрессом цикла;
- выбор темы `Системная/Светлая/Темная` (сохранение локально в браузере).
- Опрос API: каждые `POLL_INTERVAL_MS` миллисекунд.
- Endpoint: `POST https://api.fuel-status.atan.ru/gasstations.Edge/ListGasStationsForMap`.
- Фильтрация по городам: `CITY_FILTERS` + `CITY_FILTER_MODE` (`segment`/`contains`).
- Фильтрация по видам топлива: `FUEL_TYPES`.
- Целевые статусы уведомлений: `NOTIFY_TARGET_STATUSES` (массив).
- Логирование: JSON-логи в `stdout` и daily-файлы в `LOG_DIR`.
- Встроенный API для интеграций и dashboard (`/health`, `/snapshot/current`, `/events/recent`, `/config/public`).
- Dashboard в отдельной папке: `apps/dashboard` (в разработке, отдача через API по `/dashboard`).

## Логика событий
- Событие создается, когда статус топлива изменился и новый статус входит в `NOTIFY_TARGET_STATUSES`.
- По умолчанию целевой статус: `FUEL_STATUS_IN_STOCK`.
- Антидубли: `COOLDOWN_MINUTES` на ключ `station_uuid + fuel`.
- При первом запуске:
- `INITIAL_NOTIFY=true`: отправка по текущим подходящим записям.
- `INITIAL_NOTIFY=false`: только инициализация baseline без рассылки.

## Формат уведомлений
- По событию отправляется карта (если `MAP_ATTACH_ENABLED=true`) с пронумерованными точками АЗС.
- В подписи/тексте указывается:
- количество АЗС;
- выбранные города;
- выбранные виды топлива;
- список АЗС в формате:
- `N. Адрес: ...`
- `• Топливо: A-92, A-95, ...`
- В строке `Адрес` адрес кликабелен и ведет в Яндекс Карты по координатам точки.
- Если сообщение слишком длинное, автоматически дробится на части.

## Состояние и изоляция
- State хранится в `data/`.
- По умолчанию state разделяется по связке `chat + bot`:
- шаблон файла: `data/<chat>_<bot>_state.json`.
- Это исключает смешивание уведомлений между разными ботами и чатами.

## Конфигурация env
- Базовый конфиг: `.env.base`.
- Локальные/секретные переопределения: `.env.local`.
- Порядок приоритета: `.env.base` -> `.env.local` -> переменные shell.
- Логи:
- `FILE_LOGGING_ENABLED` — включение/выключение файлового логирования.
- `LOG_DIR` — директория файлов логов.
- `LOG_RETENTION_DAYS` — хранение логов в днях (по умолчанию `2`).

## Полезные команды
- `npm run start` — обычный запуск.
- `npm run start:api` — запуск встроенного API.
- `npm run build` — сборка single-file артефактов в `dist/`.
- `npm run start:fresh` — сброс state текущего `chat+bot` и запуск.
- `npm run test-telegram` — тест отправки в Telegram.
- `npm run map:generate` — генерация локальной SVG-карты в `data/`.

## Быстрый запуск сервисов
- Исходники:
- `npm install`
- `npm run start` (monitor)
- `npm run start:api` (api + dashboard)
- Dashboard URL: `http://localhost:4010/dashboard`
- Dist-артефакты:
- `npm run build`
- `npm run start:dist:monitor`
- `npm run start:dist:api`
- PM2:
- `npm run build`
- `npm run pm2:start:all`
- `npm run pm2:logs:all`
- Docker:
- `docker/README.md` (сборка, запуск, обновление, остановка через Docker Compose).
- Быстрый Docker старт: `./docker/up.sh` (поднимает `monitor + api`, с авто-рестартами через `restart: always`).

## План развития
- Актуальный поэтапный план разделения, API и dashboard: `PLAN.md`.
