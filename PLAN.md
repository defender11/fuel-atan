# Fuel ATAN: План разделения и структурирования

Этот файл — единственный источник статуса по этапам развития проекта.

## Правила ведения статусов
- `Статус` у каждого этапа: `planned` | `in_progress` | `done` | `blocked`.
- `Приоритет` у каждого этапа: `P0` (критичный) | `P1` (высокий) | `P2` (средний).
- После завершения этапа:
- чекбокс переводится в `[x]`;
- `Статус` меняется на `done`;
- фиксируется дата завершения.

## Целевая структура
```text
fuel-atan/
  apps/
    monitor/
    api/
    dashboard/
  packages/
    core/
    infra/
    shared-types/
  data/
  docs/
```

## Этапы

### [x] Этап 1: Модульное разделение текущего monitor
- Приоритет: `P0`
- Статус: `done`
- Цель: разнести текущий `index.js` на модули без изменения поведения.
- Основные работы:
- выделить `config`, `logger`, `atan-client`, `state-store`, `event-detector`, `telegram-notifier`;
- перенести запуск в `apps/monitor/src/main.js`;
- сохранить совместимость команды `npm run start`.
- Прогресс:
- создана структура `apps/monitor/src`;
- `index.js` переведен в совместимый entrypoint;
- текущая логика вынесена в модули `constants`, `env`, `logger`, `storage`, `domain`, `integrations`, `main`.
- Критерий завершения:
- функционал уведомлений работает как раньше;
- проект проходит `npm run check`.
- Дата завершения: `2026-05-29`

### [x] Этап 2: Внутренний API для дашборда
- Приоритет: `P0`
- Статус: `done`
- Цель: добавить HTTP API, читающий данные текущего monitor.
- Основные работы:
- создать `apps/api`;
- реализовать `GET /health`, `GET /snapshot/current`, `GET /events/recent`, `GET /config/public`;
- добавить базовую защиту (`X-API-Key` или аналог).
- Прогресс:
- создан `apps/api/src/main.js` и entrypoint `api.js`;
- реализованы `GET /health`, `GET /snapshot/current`, `GET /events/recent`, `GET /config/public`;
- добавлена защита через `x-api-key` (если задан `API_KEY`);
- добавлены команды `npm run start:api` и `npm run dev:api`.
- Критерий завершения:
- API возвращает актуальные данные без прямого опроса ATAN;
- есть минимальные smoke-тесты endpoint-ов.
- Дата завершения: `2026-05-29`

### [x] Этап 3: Dashboard в отдельной папке
- Приоритет: `P1`
- Статус: `done`
- Цель: сделать UI в `apps/dashboard`, работающий только через `apps/api`.
- Основные работы:
- поднять фронтенд-проект в отдельной папке;
- вывести статус сервиса, последние циклы, события, ошибки;
- добавить фильтры для данных АЗС.
- Прогресс:
- создан `apps/dashboard/index.html`;
- дашборд отдается через `GET /` и `GET /dashboard` в `apps/api`;
- дашборд читает `/health`, `/config/public`, `/snapshot/current`, `/events/recent`.
- добавлен фильтр по названию/адресу АЗС.
- Критерий завершения:
- дашборд читает данные только из API;
- локально доступен отдельной командой запуска.
- Дата завершения: `2026-05-29`

### [x] Этап 4: Единая сборка (single-file artifacts)
- Приоритет: `P1`
- Статус: `done`
- Цель: собрать deploy-артефакты в один файл для backend и dashboard.
- Основные работы:
- собрать `apps/api` и `apps/monitor` в single-file bundle (`dist/*.js`);
- собрать dashboard в single-file output (`dist/index.html`) или зафиксированный формат деплоя;
- добавить команды `build:*` в `package.json`.
- Прогресс:
- добавлен сборщик `scripts/build-artifacts.js`;
- формируются артефакты `dist/monitor.js`, `dist/api.js`, `dist/test-telegram.js`, `dist/index.html`;
- добавлены команды `npm run build`, `npm run start:dist:monitor`, `npm run start:dist:api`.
- Критерий завершения:
- сборка повторяемая и запускается на чистом окружении;
- артефакты документированы в `README.md`.
- Дата завершения: `2026-05-29`

### [x] Этап 5: Оркестрация, CI и эксплуатация
- Приоритет: `P2`
- Статус: `done`
- Цель: сделать устойчивый production-процесс для `monitor + api + dashboard`.
- Основные работы:
- добавить CI-пайплайн (`check`, тесты, сборка);
- оформить запуск сервисов через PM2/systemd;
- добавить эксплуатационные инструкции и runbook.
- Прогресс:
- добавлен CI pipeline `.github/workflows/ci.yml` (`npm run ci`);
- добавлен smoke-тест API `scripts/smoke-api.js`;
- добавлен PM2 ecosystem `ecosystem.config.cjs` для `monitor + api`;
- добавлены команды `pm2:start:all`, `pm2:restart:all`, `pm2:stop:all`, `pm2:delete:all`;
- добавлены Docker/Make команды для серверного запуска Telegram-чекалки: `make tg-up`, `make tg-logs`, `make tg-down`, `make tg-test`;
- добавлены shell-скрипты `docker/tg-up.sh`, `docker/tg-logs.sh`, `docker/tg-down.sh`, `docker/tg-test.sh`;
- добавлен runbook `docs/RUNBOOK.md`.
- Критерий завершения:
- полный цикл `check + build + run` автоматизирован;
- обновлена эксплуатационная документация.
- Дата завершения: `2026-05-29`
