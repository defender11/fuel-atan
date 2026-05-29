const { FUELS, KNOWN_STATUSES, STATUS_LABELS, FUEL_LABELS } = require("./constants");

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

function validateStations(stations, runId, logFn) {
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
        logFn(runId, "warn", "Unknown fuel status", {
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
    logFn(runId, "warn", "Skipped invalid stations", { skipped });
  }
  return result;
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
  return `https://static-maps.yandex.ru/1.x/?l=map&lang=ru_RU&size=650,450&pt=${encodeURIComponent(points)}`;
}

function buildMapCaption(stations, config) {
  const cityInfo = config.cityFiltersOriginal.length > 0 ? config.cityFiltersOriginal.join(", ") : "все";
  const fuelsInfo = config.fuelTypes.map((fuel) => humanizeFuelName(fuel)).join(", ");
  const lines = [
    `⛽ <b>АЗС на карте:</b> ${stations.length}`,
    `🏙️ <b>Города:</b> ${escapeHtml(cityInfo)}`,
    `🛢️ <b>Топливо:</b> ${escapeHtml(fuelsInfo)}`
  ].filter(Boolean);
  return lines.join("\n");
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

module.exports = {
  STATUS_LABELS,
  stationMatchesCityFilter,
  validateStations,
  stateToSnapshotMap,
  detectEvents,
  groupEventsByStation,
  buildStaticMapUrl,
  buildMapCaption,
  buildBatchMessages
};
