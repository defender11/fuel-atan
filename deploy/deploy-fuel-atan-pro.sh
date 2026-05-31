#!/usr/bin/env bash
#
# ============================================================================
#  deploy-fuel-atan-pro.sh  —  "взрослый" самодостаточный деплой fuel-atan.
#
#  ИДЕЯ:
#    - Скрипт САМ генерирует Dockerfile + entrypoint.sh + git-watcher.sh
#      во временной папке (mktemp), собирает из них образ и удаляет временную
#      папку за собой. На хосте НЕ остаётся ни одного лишнего файла.
#    - Данные/код живут в Docker named volume (Docker сам им управляет),
#      а не в случайных папках хоста.
#    - Контейнер самовосстанавливается:
#         * tini (PID 1)            — сигналы + reaping зомби;
#         * pm2                     — поднимает упавший процесс приложения;
#         * --restart unless-stopped— поднимает упавший контейнер / после ребута;
#         * git-watcher             — раз в час тянет изменения из git и
#                                     делает pull -> build -> pm2 reload.
#
#  ЗАПУСК (на хосте):
#    chmod +x deploy-fuel-atan-pro.sh
#    TELEGRAM_BOT_TOKEN=123:ABC TELEGRAM_CHAT_ID=-100123 ./deploy-fuel-atan-pro.sh
#
#  Повторный запуск безопасен (идемпотентно): пересоберёт образ и пересоздаст
#  контейнер, том с данными/кодом при этом сохранится.
# ============================================================================

set -euo pipefail


# ----------------------------------------------------------------------------
#  КОНФИГ. Любую переменную можно переопределить из окружения.
# ----------------------------------------------------------------------------
IMAGE_NAME="${IMAGE_NAME:-fuel-atan-img}"             # имя собираемого образа
CONTAINER_NAME="${CONTAINER_NAME:-fuel-atan}"         # имя контейнера
VOLUME_NAME="${VOLUME_NAME:-fuel-atan-data}"          # имя named volume (код + data)
NODE_IMAGE="${NODE_IMAGE:-node:22}"                   # базовый образ
HOST_PORT="${HOST_PORT:-4010}"                        # порт на хосте
CONTAINER_PORT="${CONTAINER_PORT:-4010}"              # порт внутри (API проекта)
REPO_URL="${REPO_URL:-https://github.com/defender11/fuel-atan.git}"
GIT_BRANCH="${GIT_BRANCH:-master}"                    # отслеживаемая ветка
APP_SUBDIR="${APP_SUBDIR:-fuel-atan}"                 # папка клона внутри /app
GIT_POLL_SECONDS="${GIT_POLL_SECONDS:-3600}"          # интервал проверки git (сек), 3600 = 1 час

# Секреты Telegram (необязательно; пусто = заполнить вручную позже).
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"


# ----------------------------------------------------------------------------
#  Логгер с цветами.
# ----------------------------------------------------------------------------
C_GREEN=$'\033[0;32m'; C_BLUE=$'\033[0;34m'; C_YELLOW=$'\033[0;33m'
C_RED=$'\033[0;31m';   C_RESET=$'\033[0m'
log()  { echo "${C_BLUE}==>${C_RESET} $*"; }
ok()   { echo "${C_GREEN} OK${C_RESET} $*"; }
warn() { echo "${C_YELLOW}!!!${C_RESET} $*"; }
die()  { echo "${C_RED}ERR${C_RESET} $*" >&2; exit 1; }


# ----------------------------------------------------------------------------
#  Предусловия.
# ----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker не найден в PATH."
docker info >/dev/null 2>&1       || die "Нет доступа к docker-демону (нужен sudo / группа docker)."
ok "docker доступен."


# ----------------------------------------------------------------------------
#  Временный build-контекст. trap ... EXIT гарантирует удаление при ЛЮБОМ
#  выходе (успех, ошибка, Ctrl+C) — поэтому на хосте не остаётся мусора.
# ----------------------------------------------------------------------------
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
log "Временный build-контекст: $BUILD_DIR (будет удалён автоматически)"


# ============================================================================
#  ГЕНЕРАЦИЯ ФАЙЛОВ ОБРАЗА
#  Heredoc'и в кавычках (<<'EOF') пишут файлы как есть, без подстановки на
#  стороне deploy.sh. Конфиг прилетит в контейнер через docker run -e.
# ============================================================================

# --- Dockerfile (этот heredoc БЕЗ кавычек — подставляем ${NODE_IMAGE}) ------
cat > "$BUILD_DIR/Dockerfile" <<DOCKERFILE_EOF
FROM ${NODE_IMAGE}

# tini  — корректный init для PID 1 (ловит SIGTERM, хоронит зомби-процессы).
# htop  — мониторинг (по требованию).
# make  — для Makefile проекта (по требованию); git в node:22 уже есть.
RUN apt-get update \\
 && apt-get install -y --no-install-recommends tini htop make ca-certificates \\
 && rm -rf /var/lib/apt/lists/*

# pm2 ЗАПЕКАЕТСЯ в образ -> переживает пересоздание контейнера.
RUN npm install -g pm2

# Управляющие скрипты кладём в образ.
COPY entrypoint.sh   /usr/local/bin/entrypoint.sh
COPY git-watcher.sh  /usr/local/bin/git-watcher.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/git-watcher.sh

WORKDIR /app

# tini как PID 1, дальше — наш entrypoint.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
DOCKERFILE_EOF


# --- entrypoint.sh (выполняется ВНУТРИ контейнера при старте) ---------------
cat > "$BUILD_DIR/entrypoint.sh" <<'ENTRYPOINT_EOF'
#!/usr/bin/env bash
set -euo pipefail

# Конфиг приходит из окружения контейнера (docker run -e ...).
REPO_URL="${REPO_URL:-https://github.com/defender11/fuel-atan.git}"
GIT_BRANCH="${GIT_BRANCH:-master}"
APP_SUBDIR="${APP_SUBDIR:-fuel-atan}"
APP_DIR="/app/${APP_SUBDIR}"

log() { echo "[entrypoint $(date '+%H:%M:%S')] $*"; }

# --- Грациозная остановка по сигналу (docker stop -> tini -> сюда) ---
WATCHER_PID=""
graceful_shutdown() {
    log "Получен сигнал остановки — гашу процессы..."
    [ -n "$WATCHER_PID" ] && kill "$WATCHER_PID" 2>/dev/null || true
    pm2 kill || true          # грациозно останавливает приложения и pm2-демон
    exit 0
}
# trap ловит сигналы; пока стоим на `wait` ниже, trap гарантированно сработает.
trap graceful_shutdown SIGTERM SIGINT

# --- 1. Репозиторий: клон при первом старте, иначе используем существующий ---
if [ -d "${APP_DIR}/.git" ]; then
    log "Репозиторий уже на месте: ${APP_DIR}"
else
    log "Клонирую ${REPO_URL} (ветка ${GIT_BRANCH})"
    git clone --branch "${GIT_BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi
cd "${APP_DIR}"

# --- 2. Конфиг .env.local (dotenv-слой проекта) ---
[ -f .env.local ] || { log "Создаю .env.local из .env.base"; cp .env.base .env.local; }

# Если токены переданы в окружение — прописываем/обновляем их в .env.local.
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    grep -q '^TELEGRAM_BOT_TOKEN=' .env.local \
        && sed -i "s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}|" .env.local \
        || echo "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}" >> .env.local
fi
if [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    grep -q '^TELEGRAM_CHAT_ID=' .env.local \
        && sed -i "s|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}|" .env.local \
        || echo "TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}" >> .env.local
fi

# --- 3. Зависимости и сборка ---
log "npm install"
npm install --no-audit --no-fund
log "npm run build"
npm run build

# --- 4. Запуск приложения через pm2 (демон-режим, возвращает управление сразу) ---
log "pm2 start ecosystem.config.cjs"
pm2 start ecosystem.config.cjs
pm2 save || true

# --- 5. Фоновый git-watcher (НЕ под pm2, чтобы pm2 reload его не задел) ---
log "Запускаю git-watcher (интервал ${GIT_POLL_SECONDS:-3600}с)"
/usr/local/bin/git-watcher.sh &
WATCHER_PID=$!

# --- 6. Держим контейнер живым + стримим логи приложения в docker logs ---
# `wait` блокируется до завершения фоновых задач, НО прерывается сигналом ->
# поэтому graceful_shutdown отработает корректно при docker stop.
pm2 logs &
wait
ENTRYPOINT_EOF


# --- git-watcher.sh (почасовой авто-апдейтер, выполняется ВНУТРИ контейнера) -
cat > "$BUILD_DIR/git-watcher.sh" <<'WATCHER_EOF'
#!/usr/bin/env bash
# ВАЖНО: здесь НЕТ `set -e` — вотчер должен жить вечно и переживать любые сбои
# (нет сети, конфликт веток и т.п.), а не падать на первой же ошибке.

REPO_URL="${REPO_URL:-https://github.com/defender11/fuel-atan.git}"
GIT_BRANCH="${GIT_BRANCH:-master}"
APP_SUBDIR="${APP_SUBDIR:-fuel-atan}"
APP_DIR="/app/${APP_SUBDIR}"
POLL="${GIT_POLL_SECONDS:-3600}"     # раз в час по умолчанию

log() { echo "[git-watcher $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "Старт. dir=${APP_DIR}, branch=${GIT_BRANCH}, interval=${POLL}s"

while true; do
    sleep "$POLL"

    cd "$APP_DIR" 2>/dev/null || { log "Нет папки ${APP_DIR}, пропуск"; continue; }

    # Узнаём о состоянии удалённой ветки, НЕ трогая рабочее дерево.
    if ! git fetch --quiet origin "$GIT_BRANCH"; then
        log "git fetch не удался (сеть?), повтор через интервал"
        continue
    fi

    LOCAL_SHA="$(git rev-parse HEAD 2>/dev/null)"
    REMOTE_SHA="$(git rev-parse "origin/${GIT_BRANCH}" 2>/dev/null)"

    # Нет изменений -> ждём дальше.
    if [ -z "$REMOTE_SHA" ] || [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
        log "Изменений нет (${LOCAL_SHA:0:7})"
        continue
    fi

    log "Обновление: ${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7}"

    # Только fast-forward — чтобы не словить merge-конфликт в автомате.
    if ! git pull --ff-only origin "$GIT_BRANCH"; then
        log "git pull --ff-only не прошёл (расхождение веток?), пропуск"
        continue
    fi

    # Зависимости могли поменяться.
    if ! npm install --no-audit --no-fund; then
        log "npm install упал, перезапуск отменён"
        continue
    fi

    # Если сборка падает — НЕ перезапускаем, оставляем рабочую версию.
    if ! npm run build; then
        log "npm run build упал, оставляю прежнюю рабочую версию"
        continue
    fi

    # Zero-downtime перезапуск приложений. Вотчер не под pm2 -> себя не заденем.
    if pm2 reload all; then
        pm2 save 2>/dev/null || true
        log "Применено обновление: теперь ${REMOTE_SHA:0:7}"
    else
        log "pm2 reload не прошёл, пробую restart"
        pm2 restart all || true
    fi
done
WATCHER_EOF

ok "Файлы образа сгенерированы."


# ============================================================================
#  СБОРКА ОБРАЗА И ЗАПУСК КОНТЕЙНЕРА
# ============================================================================

log "Собираю образ '$IMAGE_NAME' (первый раз — дольше, дальше из кэша)..."
docker build -t "$IMAGE_NAME" "$BUILD_DIR"
ok "Образ собран."

# Том (идемпотентно: создаём только если его нет).
if ! docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    docker volume create "$VOLUME_NAME" >/dev/null
    ok "Создан том '$VOLUME_NAME'."
else
    ok "Том '$VOLUME_NAME' уже есть — данные сохранятся."
fi

# Пересоздание контейнера (идемпотентно).
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    warn "Контейнер '$CONTAINER_NAME' существует — пересоздаю (том не трогаю)."
    docker rm -f "$CONTAINER_NAME" >/dev/null
fi

log "Запускаю контейнер '$CONTAINER_NAME'..."
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "${HOST_PORT}:${CONTAINER_PORT}" \
    -v "${VOLUME_NAME}:/app" \
    -e REPO_URL="$REPO_URL" \
    -e GIT_BRANCH="$GIT_BRANCH" \
    -e APP_SUBDIR="$APP_SUBDIR" \
    -e GIT_POLL_SECONDS="$GIT_POLL_SECONDS" \
    -e TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
    -e TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
    "$IMAGE_NAME" >/dev/null
ok "Контейнер запущен."


# ============================================================================
#  ОТЧЁТ
# ============================================================================
echo
log "Статус контейнера:"
docker ps --filter "name=${CONTAINER_NAME}" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then
    warn "Токен/чат Telegram не заданы. Впиши их и перезапусти, например:"
    warn "  docker exec -it ${CONTAINER_NAME} bash -c 'cd /app/${APP_SUBDIR} && nano .env.local'"
    warn "  docker restart ${CONTAINER_NAME}"
fi

echo
ok "Готово!"
echo "  Дашборд:        http://<IP_СЕРВЕРА>:${HOST_PORT}/dashboard"
echo "  Логи (live):    docker logs -f ${CONTAINER_NAME}"
echo "  pm2 статус:     docker exec ${CONTAINER_NAME} pm2 status"
echo "  Логи апдейтера: docker logs ${CONTAINER_NAME} 2>&1 | grep git-watcher"
echo "  Зайти внутрь:   docker exec -it ${CONTAINER_NAME} bash"
echo "  Интервал git:   ${GIT_POLL_SECONDS}s"
