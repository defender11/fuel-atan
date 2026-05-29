const path = require("node:path");

const { FUELS, KNOWN_STATUSES } = require("./constants");
const {
  mustGetEnv,
  toBoolean,
  toNumber,
  resolveStateFilePath,
  parseArrayEnv,
  normalizeLowerArray,
  normalizeUpperArray,
  loadProjectEnv
} = require("./env");
const { makeRunId, nowIso, initFileLogging, flushFileLogs, log, logFatal } = require("./logger");
const { readJsonFileSafe, writeJsonAtomic } = require("./storage");
const {
  stationMatchesCityFilter,
  validateStations,
  stateToSnapshotMap,
  detectEvents,
  groupEventsByStation,
  buildStaticMapUrl,
  buildMapCaption,
  buildBatchMessages
} = require("./domain");
const { getStations, sendTelegramMessage, sendTelegramPhoto } = require("./integrations");

async function runCycle(config, stateRef) {
  const runId = makeRunId();
  const startedAt = Date.now();
  log(runId, "info", "Cycle started");

  try {
    const rawStations = await getStations(config, runId, log);
    const stations = validateStations(rawStations, runId, log);
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

async function bootstrap() {
  await loadProjectEnv();

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
      log(makeRunId(), "warn", "Previous cycle still running, skip tick");
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

async function runApp() {
  try {
    await bootstrap();
  } catch (error) {
    logFatal(error);
    process.exitCode = 1;
  } finally {
    await flushFileLogs();
  }
}

module.exports = {
  runApp
};
