const fs = require("node:fs/promises");
const path = require("node:path");

const FUELS = ["a92", "a95", "a95_ultra", "a100", "diesel", "diesel_ultra", "lpg"];
const KNOWN_STATUSES = new Set([
  "FUEL_STATUS_IN_STOCK",
  "FUEL_STATUS_LIMITED",
  "FUEL_STATUS_OUT_OF_STOCK",
  "FUEL_STATUS_UNAVAILABLE"
]);
const STATUS_LABELS = {
  FUEL_STATUS_IN_STOCK: "Есть",
  FUEL_STATUS_LIMITED: "Талоны",
  FUEL_STATUS_OUT_OF_STOCK: "Нет",
  FUEL_STATUS_UNAVAILABLE: "Нет",
  "N/A": "нет данных"
};
const FUEL_LABELS = {
  a92: "A-92",
  a95: "A-95",
  a95_ultra: "A-95 Ultra",
  a100: "A-100",
  diesel: "ДТ",
  diesel_ultra: "ДТ Ultra",
  lpg: "Газ"
};
const INITIAL_ENV_KEYS = new Set(Object.keys(process.env));

function loadDotEnvFile(filePath, options = {}) {
  const { override = false } = options;
  return fs
    .readFile(filePath, "utf8")
    .then((content) => {
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
          continue;
        }
        const index = line.indexOf("=");
        if (index === -1) {
          continue;
        }
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        if (override) {
          // Keep explicit shell env vars higher priority than file-based values.
          if (!INITIAL_ENV_KEYS.has(key)) {
            process.env[key] = value;
          }
        } else if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    })
    .catch((error) => {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    });
}

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function toBoolean(value, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function toNumber(value, defaultValue) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function sanitizeFilePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function extractBotId(botToken) {
  const token = String(botToken || "");
  const index = token.indexOf(":");
  if (index > 0) {
    return sanitizeFilePart(token.slice(0, index));
  }
  return "bot";
}

function resolveStateFilePath(baseStateFile, splitByChatBot, botToken, chatId) {
  const resolvedBase = path.resolve(process.cwd(), baseStateFile || "./data/state.json");
  if (!splitByChatBot) {
    return resolvedBase;
  }
  const parsed = path.parse(resolvedBase);
  const chatPart = sanitizeFilePart(chatId);
  const botPart = extractBotId(botToken);
  const fileName = `${chatPart}_${botPart}_state${parsed.ext || ".json"}`;
  return path.join(parsed.dir, fileName);
}

function parseArrayEnv(value) {
  if (value == null || String(value).trim() === "") {
    return [];
  }
  const raw = String(value)
    .replace(/\s+#.*$/u, "")
    .trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (_) {
      const noBrackets = raw.replace(/^\[/u, "").replace(/\]$/u, "");
      return noBrackets
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/gu, ""))
        .filter(Boolean);
    }
  }
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/gu, ""))
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function makeRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const fileLogState = {
  enabled: false,
  logDir: "",
  retentionDays: 2,
  nextCleanupAtMs: 0,
  writeChain: Promise.resolve()
};

function getDateStamp(date) {
  return date.toISOString().slice(0, 10);
}

async function cleanupOldLogs(logDir, retentionDays) {
  const entries = await fs.readdir(logDir, { withFileTypes: true }).catch((error) => {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const nowMs = Date.now();
  const retentionMs = Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  const deletions = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".log")) {
      continue;
    }
    const fullPath = path.join(logDir, entry.name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      continue;
    }
    if (nowMs - stat.mtimeMs > retentionMs) {
      deletions.push(fs.unlink(fullPath).catch(() => {}));
    }
  }

  await Promise.all(deletions);
}

async function initFileLogging(options) {
  const { enabled, logDir, retentionDays } = options;
  fileLogState.enabled = Boolean(enabled);
  fileLogState.logDir = path.resolve(process.cwd(), logDir || "./data/logs");
  fileLogState.retentionDays = Number.isFinite(retentionDays) ? Math.max(1, Math.floor(retentionDays)) : 2;
  fileLogState.nextCleanupAtMs = Date.now();
  fileLogState.writeChain = Promise.resolve();

  if (!fileLogState.enabled) {
    return;
  }

  await fs.mkdir(fileLogState.logDir, { recursive: true });
  await cleanupOldLogs(fileLogState.logDir, fileLogState.retentionDays);
  fileLogState.nextCleanupAtMs = Date.now() + 6 * 60 * 60 * 1000;
}

async function runLogCleanupIfDue() {
  if (Date.now() < fileLogState.nextCleanupAtMs) {
    return;
  }
  await cleanupOldLogs(fileLogState.logDir, fileLogState.retentionDays);
  fileLogState.nextCleanupAtMs = Date.now() + 6 * 60 * 60 * 1000;
}

function queueFileLogLine(line) {
  if (!fileLogState.enabled) {
    return;
  }
  const dateStamp = getDateStamp(new Date());
  const filePath = path.join(fileLogState.logDir, `${dateStamp}.log`);

  fileLogState.writeChain = fileLogState.writeChain
    .then(async () => {
      await runLogCleanupIfDue();
      await fs.appendFile(filePath, `${line}\n`, "utf8");
    })
    .catch((error) => {
      console.error(
        JSON.stringify({
          ts: nowIso(),
          level: "error",
          message: "File logging failed",
          extra: { error: error instanceof Error ? error.message : String(error), filePath }
        })
      );
    });
}

async function flushFileLogs() {
  await fileLogState.writeChain.catch(() => {});
}

function log(runId, level, message, extra) {
  const payload = {
    ts: nowIso(),
    runId,
    level,
    message
  };
  if (extra !== undefined) {
    payload.extra = extra;
  }
  const line = JSON.stringify(payload);
  console.log(line);
  queueFileLogLine(line);
}

async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFileSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    return fallback;
  }
}

async function writeJsonAtomic(filePath, objectValue) {
  await ensureDirectory(filePath);
  const tempFilePath = `${filePath}.tmp`;
  await fs.writeFile(tempFilePath, `${JSON.stringify(objectValue, null, 2)}\n`, "utf8");
  await fs.rename(tempFilePath, filePath);
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStation(rawStation) {
  if (!rawStation || typeof rawStation !== "object") {
    return null;
  }
  const uuid = sanitizeString(rawStation.uuid);
  if (!uuid) {
    return null;
  }

  const normalized = {
    id: sanitizeString(rawStation.id),
    uuid,
    title: sanitizeString(rawStation.title),
    address: sanitizeString(rawStation.address),
    lat_lng: {
      lat: Number(rawStation?.lat_lng?.lat),
      lng: Number(rawStation?.lat_lng?.lng)
    },
    fuels: {}
  };

  for (const fuel of FUELS) {
    const status = sanitizeString(rawStation[fuel]);
    normalized.fuels[fuel] = status;
  }
  return normalized;
}

function normalizeLowerArray(list) {
  return list.map((value) => value.toLowerCase());
}

function normalizeUpperArray(list) {
  return list.map((value) => value.toUpperCase());
}

function humanizeStatus(status) {
  if (!status) {
    return "неизвестно";
  }
  return STATUS_LABELS[status] || status;
}

function humanizeFuelName(fuel) {
  if (!fuel) {
    return "Топливо";
  }
  return FUEL_LABELS[fuel] || String(fuel).toUpperCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function buildLegendLine(notifyTargetStatusesSet) {
  const tokens = [];
  if (notifyTargetStatusesSet.has("FUEL_STATUS_IN_STOCK")) {
    tokens.push("🟢 Есть");
  }
  if (notifyTargetStatusesSet.has("FUEL_STATUS_LIMITED")) {
    tokens.push("🟠 Талоны");
  }
  if (
    notifyTargetStatusesSet.has("FUEL_STATUS_OUT_OF_STOCK") ||
    notifyTargetStatusesSet.has("FUEL_STATUS_UNAVAILABLE")
  ) {
    tokens.push("🔴 Нет");
  }
  if (tokens.length === 0) {
    return "";
  }
  return `Легенда: ${tokens.join(" | ")}`;
}

function normalizeCityToken(value) {
  return value
    .toLowerCase()
    .replace(/^г\.\s*/u, "")
    .replace(/^город\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function stationMatchesCityFilter(station, cityFiltersLower, cityFilterMode) {
  if (cityFiltersLower.length === 0) {
    return true;
  }

  if (cityFilterMode === "segment") {
    const stationSegments = `${station.title},${station.address}`
      .split(",")
      .map((segment) => normalizeCityToken(segment))
      .filter(Boolean);
    const normalizedCityFilters = cityFiltersLower.map((city) => normalizeCityToken(city)).filter(Boolean);
    return normalizedCityFilters.some((city) =>
      stationSegments.some((segment) => {
        if (segment === city) {
          return true;
        }
        if (!segment.startsWith(city)) {
          return false;
        }
        const nextChar = segment.charAt(city.length);
        return nextChar === "" || nextChar === " " || nextChar === "." || nextChar === ",";
      })
    );
  }

  const haystack = `${station.title} ${station.address}`.toLowerCase();
  return cityFiltersLower.some((city) => haystack.includes(city));
}

function validateStations(stations, runId) {
  const result = [];
  let skipped = 0;
  for (const rawStation of stations) {
    const station = normalizeStation(rawStation);
    if (!station) {
      skipped += 1;
      continue;
    }
    for (const fuel of FUELS) {
      const status = station.fuels[fuel];
      if (!KNOWN_STATUSES.has(status)) {
        log(runId, "warn", "Unknown fuel status", {
          stationUuid: station.uuid,
          stationTitle: station.title,
          fuel,
          status
        });
      }
    }
    result.push(station);
  }

  if (skipped > 0) {
    log(runId, "warn", "Skipped invalid stations", { skipped });
  }
  return result;
}

async function fetchWithTimeout(url, timeoutMs, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseMarkdownJsonBlock(markdownText) {
  const trimmed = markdownText.trim();
  if (!trimmed.startsWith("```json")) {
    return JSON.parse(trimmed);
  }
  const withoutStart = trimmed.replace(/^```json\s*/, "");
  const withoutEnd = withoutStart.replace(/\s*```$/, "");
  return JSON.parse(withoutEnd);
}

async function getStations(config, runId) {
  if (config.useSampleResponse) {
    const sampleRaw = await fs.readFile(config.sampleFilePath, "utf8");
    const parsed = parseMarkdownJsonBlock(sampleRaw);
    return parsed?.gas_stations || [];
  }

  const response = await fetchWithTimeout(config.atanApiUrl, config.requestTimeoutMs, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(`ATAN API error: HTTP ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data?.gas_stations)) {
    log(runId, "warn", "Response has no gas_stations array");
    return [];
  }
  return data.gas_stations;
}

function stateToSnapshotMap(snapshotArray) {
  const map = {};
  if (!Array.isArray(snapshotArray)) {
    return map;
  }
  for (const station of snapshotArray) {
    if (station && station.uuid) {
      map[station.uuid] = station;
    }
  }
  return map;
}

function isTransitionToTarget(previousStatus, currentStatus, notifyTargetStatusesSet) {
  return previousStatus !== currentStatus && notifyTargetStatusesSet.has(currentStatus);
}

function buildNotificationEvent(station, fuel, previousStatus, currentStatus) {
  return {
    key: `${station.uuid}:${fuel}`,
    stationUuid: station.uuid,
    stationTitle: station.title,
    stationAddress: station.address,
    stationLat: station?.lat_lng?.lat,
    stationLng: station?.lat_lng?.lng,
    fuel,
    previousStatus,
    currentStatus
  };
}

function detectEvents({
  previousSnapshotMap,
  currentStations,
  fuelTypes,
  notifyTargetStatusesSet,
  cooldownMs,
  notifiedAtMap,
  nowMs,
  initialNotify
}) {
  const events = [];
  const suppressed = [];

  for (const station of currentStations) {
    const previousStation = previousSnapshotMap[station.uuid];
    for (const fuel of fuelTypes) {
      const currentStatus = station.fuels[fuel];
      const previousStatus = previousStation?.fuels?.[fuel];

      let matched = false;
      if (previousStatus) {
        matched = isTransitionToTarget(previousStatus, currentStatus, notifyTargetStatusesSet);
      } else if (initialNotify && notifyTargetStatusesSet.has(currentStatus)) {
        matched = true;
      }
      if (!matched) {
        continue;
      }

      const event = buildNotificationEvent(station, fuel, previousStatus || "N/A", currentStatus);
      const lastNotifiedAt = Number(notifiedAtMap[event.key] || 0);
      if (nowMs - lastNotifiedAt < cooldownMs) {
        suppressed.push(event);
        continue;
      }
      events.push(event);
    }
  }

  return { events, suppressed };
}

function groupEventsByStation(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!grouped.has(event.stationUuid)) {
      grouped.set(event.stationUuid, {
        stationUuid: event.stationUuid,
        stationTitle: event.stationTitle,
        stationAddress: event.stationAddress,
        stationLat: event.stationLat,
        stationLng: event.stationLng,
        fuels: []
      });
    }
    grouped.get(event.stationUuid).fuels.push({
      fuel: event.fuel,
      previousStatus: event.previousStatus,
      currentStatus: event.currentStatus,
      key: event.key
    });
  }
  return [...grouped.values()];
}

function escapeUrlParam(value) {
  return encodeURIComponent(value);
}

function buildYandexMapsPointUrl(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }
  return `https://yandex.ru/maps/?ll=${lng},${lat}&z=16&pt=${lng},${lat},pm2gnm&l=map`;
}

function buildStaticMapUrl(stations) {
  const points = stations
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .slice(0, 80)
    .map((s, index) => `${s.lng},${s.lat},pm2gnm${index + 1}`)
    .join("~");
  return `https://static-maps.yandex.ru/1.x/?l=map&lang=ru_RU&size=650,450&pt=${escapeUrlParam(points)}`;
}

function buildMapCaption(stations, config, eventsCount) {
  const cityInfo = config.cityFiltersOriginal.length > 0 ? config.cityFiltersOriginal.join(", ") : "все";
  const fuelsInfo = config.fuelTypes.map((fuel) => humanizeFuelName(fuel)).join(", ");
  const lines = [
    `⛽ <b>АЗС на карте:</b> ${stations.length}`,
    `🏙️ <b>Города:</b> ${escapeHtml(cityInfo)}`,
    `🛢️ <b>Топливо:</b> ${escapeHtml(fuelsInfo)}`
  ].filter(Boolean);
  return lines.join("\n");
}

function chunkLines(lines, maxLength) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const line of lines) {
    const lineLength = line.length + 1;
    if (currentLength + lineLength > maxLength && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += lineLength;
  }
  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }
  return chunks;
}

function getTextLength(lines) {
  if (lines.length === 0) {
    return 0;
  }
  return lines.reduce((sum, line) => sum + line.length, 0) + (lines.length - 1);
}

function buildBatchMessages(events, config, options = {}) {
  const firstChunkMaxLength = Number(options.firstChunkMaxLength) || 3900;
  const otherChunkMaxLength = Number(options.otherChunkMaxLength) || 3900;
  const groupedStations = groupEventsByStation(events);
  const cityInfo = config.cityFiltersOriginal.length > 0 ? config.cityFiltersOriginal.join(", ") : "все";
  const fuelsInfo = config.fuelTypes.map((fuel) => humanizeFuelName(fuel)).join(", ");
  const baseHeader = [
    `⛽ <b>АЗС:</b> ${groupedStations.length}`,
    `🏙️ <b>Города:</b> ${escapeHtml(cityInfo)}`,
    `🛢️ <b>Топливо:</b> ${escapeHtml(fuelsInfo)}`,
    ""
  ];

  const stationBlocksWithKeys = groupedStations.map((station, index) => {
    const fuelNames = [...new Set(station.fuels.map((item) => humanizeFuelName(item.fuel)))];
    const fuelsText = fuelNames.join(", ");
    const yandexMapsUrl = buildYandexMapsPointUrl(station.stationLat, station.stationLng);
    const addressText = escapeHtml(station.stationAddress || "не указан");
    const addressLine = yandexMapsUrl
      ? `${index + 1}. Адрес: <a href="${escapeHtml(yandexMapsUrl)}">${addressText}</a>`
      : `${index + 1}. Адрес: ${addressText}`;
    return {
      lines: [
        addressLine,
        `• Топливо: ${escapeHtml(fuelsText)}`,
        ""
      ],
      eventKeys: station.fuels.map((item) => item.key)
    };
  });

  const messages = [];
  let currentLines = [...baseHeader];
  let currentKeys = [];
  let currentMaxLength = firstChunkMaxLength;

  for (const block of stationBlocksWithKeys) {
    const candidateLines = currentLines.concat(block.lines);
    if (getTextLength(candidateLines) > currentMaxLength && currentKeys.length > 0) {
      messages.push({
        text: currentLines.join("\n"),
        eventKeys: [...currentKeys]
      });
      currentLines = [];
      currentKeys = [];
      currentMaxLength = otherChunkMaxLength;
    }
    currentLines.push(...block.lines);
    currentKeys.push(...block.eventKeys);
  }

  if (currentKeys.length > 0) {
    messages.push({
      text: currentLines.join("\n"),
      eventKeys: [...currentKeys]
    });
  }

  if (messages.length > 1) {
    const total = messages.length;
    for (let i = 0; i < total; i += 1) {
      const partPrefix = `<i>Часть ${i + 1}/${total}</i>\n`;
      messages[i].text = `${partPrefix}${messages[i].text}`;
    }
  }

  return messages;
}

async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram API error: HTTP ${response.status}; ${body}`);
  }
}

async function sendTelegramPhoto(botToken, chatId, photoUrl, caption) {
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: "HTML"
    })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram API sendPhoto error: HTTP ${response.status}; ${body}`);
  }
}

async function runCycle(config, stateRef) {
  const runId = makeRunId();
  const startedAt = Date.now();
  log(runId, "info", "Cycle started");

  try {
    const rawStations = await getStations(config, runId);
    const stations = validateStations(rawStations, runId);
    const filteredStations = stations.filter((station) =>
      stationMatchesCityFilter(station, config.cityFiltersLower, config.cityFilterMode)
    );
    const nowMs = Date.now();

    const previousSnapshotMap = stateToSnapshotMap(stateRef.value.lastSnapshot);
    const hasBaseline = Object.keys(previousSnapshotMap).length > 0;

    if (!hasBaseline && !config.initialNotify) {
      stateRef.value.lastSnapshot = stations;
      await writeJsonAtomic(config.stateFile, stateRef.value);
      log(runId, "info", "Baseline initialized without notifications", {
        stations: stations.length,
        stationsAfterCityFilter: filteredStations.length,
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const { events, suppressed } = detectEvents({
      previousSnapshotMap,
      currentStations: filteredStations,
      fuelTypes: config.fuelTypes,
      notifyTargetStatusesSet: config.notifyTargetStatusesSet,
      cooldownMs: config.cooldownMs,
      notifiedAtMap: stateRef.value.notifiedAt,
      nowMs,
      initialNotify: !hasBaseline && config.initialNotify
    });

    let sent = 0;
    let sentMessages = 0;
    const groupedStations = groupEventsByStation(events).map((station) => {
      const source = filteredStations.find((s) => s.uuid === station.stationUuid);
      return {
        ...station,
        lat: source?.lat_lng?.lat,
        lng: source?.lat_lng?.lng
      };
    });

    const batchMessages =
      events.length > 0
        ? buildBatchMessages(events, config, {
            firstChunkMaxLength: config.mapAttachEnabled ? 900 : 3900,
            otherChunkMaxLength: 3900
          })
        : [];

    let startBatchIndex = 0;
    if (events.length > 0 && config.mapAttachEnabled) {
      const mapUrl = buildStaticMapUrl(groupedStations);
      const caption = batchMessages[0]?.text || buildMapCaption(groupedStations, config, events.length);
      try {
        await sendTelegramPhoto(config.telegramBotToken, config.telegramChatId, mapUrl, caption);
        sentMessages += 1;
        if (batchMessages[0]) {
          for (const eventKey of batchMessages[0].eventKeys) {
            stateRef.value.notifiedAt[eventKey] = nowMs;
            sent += 1;
          }
          startBatchIndex = 1;
        }
      } catch (error) {
        log(runId, "error", "Telegram map send failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    for (let i = startBatchIndex; i < batchMessages.length; i += 1) {
      const batch = batchMessages[i];
      try {
        await sendTelegramMessage(config.telegramBotToken, config.telegramChatId, batch.text);
        sentMessages += 1;
        for (const eventKey of batch.eventKeys) {
          stateRef.value.notifiedAt[eventKey] = nowMs;
          sent += 1;
        }
      } catch (error) {
        log(runId, "error", "Telegram send failed", {
          eventsInBatch: batch.eventKeys.length,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    stateRef.value.lastSnapshot = stations;
    await writeJsonAtomic(config.stateFile, stateRef.value);

    log(runId, "info", "Cycle completed", {
      stations: stations.length,
      stationsAfterCityFilter: filteredStations.length,
      trackedFuelTypes: config.fuelTypes.length,
      events: events.length,
      sent,
      sentMessages,
      suppressedByCooldown: suppressed.length,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    log(runId, "error", "Cycle failed", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    });
  }
}

async function main() {
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.base"));
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.local"), { override: true });

  const rawFuelTypes = parseArrayEnv(process.env.FUEL_TYPES);
  const fuelTypes = rawFuelTypes.length === 0 ? [...FUELS] : rawFuelTypes.filter((fuel) => FUELS.includes(fuel));
  const ignoredFuelTypes = rawFuelTypes.filter((fuel) => !FUELS.includes(fuel));
  const cityFilters = parseArrayEnv(process.env.CITY_FILTERS);
  const cityFilterMode = (process.env.CITY_FILTER_MODE || "contains").toLowerCase() === "segment" ? "segment" : "contains";
  const rawNotifyTargetStatuses = normalizeUpperArray(parseArrayEnv(process.env.NOTIFY_TARGET_STATUSES));
  const notifyTargetStatuses = rawNotifyTargetStatuses.length === 0 ? ["FUEL_STATUS_IN_STOCK"] : rawNotifyTargetStatuses;
  const knownStatusValues = Array.from(KNOWN_STATUSES);
  const notifyTargetStatusesSet = new Set(notifyTargetStatuses.filter((status) => KNOWN_STATUSES.has(status)));
  const ignoredNotifyTargetStatuses = notifyTargetStatuses.filter((status) => !KNOWN_STATUSES.has(status));
  const telegramBotToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const telegramChatId = mustGetEnv("TELEGRAM_CHAT_ID");
  const stateSplitByChatBot = toBoolean(process.env.STATE_SPLIT_BY_CHAT_BOT, true);
  const stateFile = resolveStateFilePath(process.env.STATE_FILE || "./data/state.json", stateSplitByChatBot, telegramBotToken, telegramChatId);
  if (notifyTargetStatusesSet.size === 0) {
    notifyTargetStatusesSet.add("FUEL_STATUS_IN_STOCK");
  }

  const config = {
    atanApiUrl: mustGetEnv("ATAN_API_URL"),
    pollIntervalMs: toNumber(process.env.POLL_INTERVAL_MS, 60_000),
    requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 10_000),
    telegramBotToken,
    telegramChatId,
    stateFile,
    stateSplitByChatBot,
    cooldownMs: toNumber(process.env.COOLDOWN_MINUTES, 30) * 60_000,
    initialNotify: toBoolean(process.env.INITIAL_NOTIFY, false),
    useSampleResponse: toBoolean(process.env.USE_SAMPLE_RESPONSE, false),
    sampleFilePath: path.resolve(process.cwd(), process.env.SAMPLE_FILE_PATH || "./response.md"),
    fuelTypes,
    cityFiltersOriginal: cityFilters,
    cityFiltersLower: normalizeLowerArray(cityFilters),
    cityFilterMode,
    notifyTargetStatusesSet,
    mapAttachEnabled: toBoolean(process.env.MAP_ATTACH_ENABLED, true),
    fileLoggingEnabled: toBoolean(process.env.FILE_LOGGING_ENABLED, true),
    logDir: process.env.LOG_DIR || "./data/logs",
    logRetentionDays: toNumber(process.env.LOG_RETENTION_DAYS, 2)
  };

  await initFileLogging({
    enabled: config.fileLoggingEnabled,
    logDir: config.logDir,
    retentionDays: config.logRetentionDays
  });

  const existingState = await readJsonFileSafe(config.stateFile, {});
  const stateRef = {
    value: {
      lastSnapshot: Array.isArray(existingState.lastSnapshot) ? existingState.lastSnapshot : [],
      notifiedAt: existingState.notifiedAt && typeof existingState.notifiedAt === "object" ? existingState.notifiedAt : {},
      initializedAt: existingState.initializedAt || nowIso()
    }
  };

  let running = false;
  const tick = async () => {
    if (running) {
      const runId = makeRunId();
      log(runId, "warn", "Previous cycle still running, skip tick");
      return;
    }
    running = true;
    try {
      await runCycle(config, stateRef);
    } finally {
      running = false;
    }
  };

  await tick();
  setInterval(tick, config.pollIntervalMs);

  log(makeRunId(), "info", "Scheduler started", {
    pollIntervalMs: config.pollIntervalMs,
    stateFile: config.stateFile,
    stateSplitByChatBot: config.stateSplitByChatBot,
    initialNotify: config.initialNotify,
    useSampleResponse: config.useSampleResponse,
    fuelTypes: config.fuelTypes,
    cityFilters,
    cityFilterMode: config.cityFilterMode,
    notifyTargetStatuses: Array.from(config.notifyTargetStatusesSet),
    mapAttachEnabled: config.mapAttachEnabled,
    ignoredFuelTypes,
    ignoredNotifyTargetStatuses,
    knownStatusValues,
    fileLoggingEnabled: config.fileLoggingEnabled,
    logDir: config.logDir,
    logRetentionDays: config.logRetentionDays
  });
}

main()
  .catch((error) => {
    const payload = {
      ts: nowIso(),
      level: "fatal",
      message: "App crashed",
      extra: { error: error instanceof Error ? error.message : String(error) }
    };
    const line = JSON.stringify(payload);
    console.error(line);
    queueFileLogLine(line);
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushFileLogs();
  });
