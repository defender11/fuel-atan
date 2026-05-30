# Fuel ATAN Monitor

Сервис мониторит наличие топлива на АЗС ATAN и отправляет уведомления в Telegram при появлении топлива.

## Что делает
- Получает список АЗС через API.
- Сравнивает текущие статусы топлива с предыдущим снимком.
- Отправляет уведомление только при целевом переходе статуса.
- Работает по расписанию (в базовом конфиге каждые 90 секунд).
- По умолчанию целевой статус уведомления: `FUEL_STATUS_IN_STOCK`.
- При множественных событиях за цикл отправляет одно агрегированное сообщение (если длинное, делит на части).
- В уведомлениях статусы выводятся в человекочитаемом виде ("Есть", "Талоны", "Нет").
- Перед текстом отправляет карту с отмеченными АЗС (если `MAP_ATTACH_ENABLED=true`) и легендой в подписи.

## Требования
- Node.js 18+ для локального запуска без Docker.
- Docker Engine 24+ и Docker Compose v2 для серверного запуска.
- `make` для коротких серверных команд.

## Быстрый запуск Telegram-чекалки на сервере
1. Заполнить `.env.base` базовыми значениями проекта.
2. В `.env.local` указывать локальные/секретные значения (они переопределяют `.env.base`).
3. Заполнить `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` в `.env.local`.
4. Проверить отправку в Telegram и запустить чекалку.

```bash
make tg-test
make tg-up
make tg-logs
```

Остановить только Telegram-чекалку:
```bash
make tg-down
```

`monitor` в Docker Compose — это Telegram-чекалка. Веб/API сервис называется `api`.

### Локальный запуск без Docker
- Из исходников:
```bash
npm install
npm run start
npm run start:api
```

- Dashboard URL:
- `http://localhost:4010/`
- `http://localhost:4010/dashboard`

- Из dist:
```bash
npm run build
npm run start:dist:monitor
npm run start:dist:api
```

- Через PM2:
```bash
npm run build
npm run pm2:start:all
npm run pm2:logs:all
```

Сборка production-артефактов:
```bash
npm run build
```

Приоритет конфигов:
- сначала читается `.env.base` (значения по умолчанию);
- потом читается `.env.local` и переопределяет совпадающие ключи;
- переменные, переданные из shell при запуске, имеют наивысший приоритет.
- state по умолчанию разделяется по связке `chat+bot` (файлы вида `data/<chat>_<bot>_state.json`).

Для локальной проверки без внешних запросов:
- `USE_SAMPLE_RESPONSE=true`
- `SAMPLE_FILE_PATH=./response.md`

Проверка Telegram отдельно (без ATAN и без `state.json`):
```bash
npm run test-telegram
```

Проверка Telegram через Docker без локального Node/npm:
```bash
make tg-test
```

Запуск с автоперезапуском в разработке:
```bash
npm run dev
npm run dev:api
```

Старт с очисткой состояния (удаляет `data/state.json`):
```bash
npm run start:fresh
```

Отдельная генерация карты с АЗС, где есть бензин:
```bash
npm run map:generate
```

Запуск как сервис через PM2:
```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:restart
```

## Встроенный API для дашборда
- `GET /health` — health-check (без авторизации).
- `GET /snapshot/current` — текущий снимок АЗС из state.
- `GET /events/recent?limit=50` — последние записи из daily логов.
- `GET /config/public` — публичная часть runtime-конфига.

Запуск API:
```bash
npm run start:api
```

Dashboard доступен по адресу:
- `http://localhost:4010/`
- `http://localhost:4010/dashboard`

Если задан `API_KEY`, для endpoint-ов кроме `/health` нужно передавать header `x-api-key`.

## Docker запуск
- Telegram-чекалка: `make tg-up`, `make tg-logs`, `make tg-down`, `make tg-test`.
- Полный стек `monitor + api`: `make up`.
- Быстрый запуск полного стека: `./docker/up.sh`.
- Compose-файл: `docker/docker-compose.yml`
- Подробная инструкция: `docker/README.md`

## Dashboard
- Исходники UI: `apps/dashboard/index.html`.
- Dashboard работает только через API.
- Разделы SPA: `Stations`, `Logs`, `Settings`.
- Автообновление данных через Bootstrap select: `Выключить / 3 / 5 / 15 / 30 секунд`.
- Для автообновления показывается мини-прогресс цикла и обратный отсчет до следующего обновления.
- Переключение темы в `Settings`: `Системная / Светлая / Темная` (сохранение выбора в `localStorage`).
- Для основных контролов, меню, статусов и таблиц включены tooltip-подсказки.
- В таблице топлива статусы отображаются цветными кружками по легенде.
- Локальные URL:
- `http://localhost:4010/`
- `http://localhost:4010/dashboard`

## Сборка в один файл (Stage 4)
Команда:
```bash
npm run build
```

Результат в `dist/`:
- `dist/monitor.js` — single-file bundle monitor.
- `dist/api.js` — single-file bundle API.
- `dist/test-telegram.js` — single-file Telegram test runner для Docker.
- `dist/index.html` — single-file dashboard.

Запуск dist-артефактов:
```bash
npm run start:dist:monitor
npm run start:dist:api
```

## CI и smoke (Stage 5)
- `npm run ci` запускает: `check -> build -> test:smoke`.
- Smoke-тест API: `npm run test:smoke`.
- GitHub Actions pipeline: `.github/workflows/ci.yml`.

## Переменные окружения
- `ATAN_API_URL` - URL API ATAN.
- `POLL_INTERVAL_MS` - интервал опроса в миллисекундах (по умолчанию в конфиге `90000`).
- `REQUEST_TIMEOUT_MS` - таймаут запроса к API (по умолчанию в конфиге `45000`).
- `TELEGRAM_BOT_TOKEN` - токен Telegram-бота.
- `TELEGRAM_CHAT_ID` - chat id для уведомлений.
- `STATE_FILE` - путь к файлу состояния, например `./data/state.json`.
- `STATE_SPLIT_BY_CHAT_BOT` - разделять state по `chat+bot` (рекомендуется `true`).
- `COOLDOWN_MINUTES` - cooldown для дублей уведомлений.
- `INITIAL_NOTIFY` - отправлять ли уведомления на самом первом запуске.
- `USE_SAMPLE_RESPONSE` - брать данные из локальной фикстуры вместо API.
- `SAMPLE_FILE_PATH` - путь к локальной фикстуре.
- `FUEL_TYPES` - массив топлив для отслеживания, пример: `["a95","a100"]` (если пусто, отслеживаются все).
- `CITY_FILTERS` - массив городов/подстрок для фильтра АЗС, пример: `["Симферополь","Керчь","Севастополь"]` (если пусто, все города).
- `CITY_FILTER_MODE` - режим фильтра по городу: `contains` (по подстроке) или `segment` (строго по сегменту города в адресе/названии).
- `NOTIFY_TARGET_STATUSES` - массив статусов, при переходе в которые отправляется уведомление, пример: `["FUEL_STATUS_IN_STOCK"]`.
- `MAP_OUTPUT_FILE` - путь, куда сохраняется SVG-карта с отмеченными АЗС.
- `MAP_ATTACH_ENABLED` - прикладывать ли карту к уведомлению в Telegram.
- `FILE_LOGGING_ENABLED` - писать ли JSON-логи в файлы (`true/false`).
- `LOG_DIR` - директория для daily логов (по умолчанию `./data/logs`).
- `LOG_RETENTION_DAYS` - сколько дней хранить лог-файлы (по умолчанию `2`).
- `API_HOST` - host для встроенного API (по умолчанию `0.0.0.0`).
- `API_PORT` - порт встроенного API (по умолчанию `4010`).
- `API_KEY` - ключ для защиты API endpoint-ов (если пусто, защита выключена).
- `DASHBOARD_FILE` - путь к HTML dashboard, который отдает API (опционально).

## Структура документации
- Проектная цель и контекст: `agency.md`
- План этапов и статусов: `PLAN.md`
- Бизнес-правила: `SPEC.md`
- Контракт API: `API_CONTRACT.md`
- Эксплуатация и cron: `OPERATIONS.md`
- Runbook эксплуатации: `docs/RUNBOOK.md`
- Docker деплой и запуск: `docker/README.md`
- Пример ответа API: `response.md`
