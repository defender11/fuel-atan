# Operations

## Режим запуска
- Рекомендуемый интервал опроса: 90 секунд.
- Варианты:
  - системный cron, запускающий скрипт;
  - постоянный Node.js процесс с внутренним scheduler.
- Для текущей структуры рекомендуется пара процессов: `monitor + api` (см. `ecosystem.config.cjs`).
- Для серверного запуска только Telegram-чекалки рекомендуется Docker/Make: `make tg-up`, `make tg-logs`, `make tg-down`.

## Cron пример
```cron
*/1 * * * * /usr/bin/node /path/to/app/index.js >> /path/to/logs/fuel-monitor.log 2>&1
```

## Логи
- Логировать начало/конец цикла, количество АЗС, количество событий, ошибки API, ошибки Telegram.
- Добавить корреляционный `run_id` на каждый цикл.
- Хранить логи в `LOG_DIR` по дням (`YYYY-MM-DD.log`) с автоочисткой старше `LOG_RETENTION_DAYS` (по умолчанию 2 дня).

## Метрики (минимум)
- `poll_success_total`
- `poll_error_total`
- `telegram_sent_total`
- `telegram_error_total`
- `events_detected_total`
- `events_suppressed_cooldown_total`

## Надежность
- Таймаут запроса к ATAN API: `REQUEST_TIMEOUT_MS` (в базовом конфиге 45 секунд).
- Ограничение на максимальное время цикла (чтобы не накапливались перекрытия).
- Защита от параллельного запуска (lock-файл или distributed lock).

## Хранилище состояния
- Формат: JSON-файл на диске (`STATE_FILE`).
- Содержимое:
  - последний статус по ключу `station_uuid + fuel_type`;
  - метки времени отправленных уведомлений для cooldown.
- Делать атомарную запись состояния (temp file + rename).

## Runbook
- Практические команды запуска/рестарта/диагностики: `docs/RUNBOOK.md`.

## Алертинг
- Если API недоступен более N циклов подряд (например 5), отправлять тех. уведомление в отдельный чат/канал.
- Если Telegram отправка падает более N раз подряд, поднимать warning.
