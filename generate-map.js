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
  FUEL_STATUS_UNAVAILABLE: "Нет"
};
const INITIAL_ENV_KEYS = new Set(Object.keys(process.env));

function toBoolean(value, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseArrayEnv(value) {
  if (value == null || String(value).trim() === "") {
    return [];
  }
  const raw = String(value).trim();
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch (_) {
      return [];
    }
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeUpperArray(list) {
  return list.map((value) => value.toUpperCase());
}

function normalizeLowerArray(list) {
  return list.map((value) => value.toLowerCase());
}

function normalizeCityToken(value) {
  return value
    .toLowerCase()
    .replace(/^г\.\s*/u, "")
    .replace(/^город\s+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

async function loadDotEnvFile(filePath, options = {}) {
  const { override = false } = options;
  try {
    const content = await fs.readFile(filePath, "utf8");
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
        if (!INITIAL_ENV_KEYS.has(key)) {
          process.env[key] = value;
        }
      } else if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function sanitizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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
    return normalizedCityFilters.some((city) => stationSegments.includes(city));
  }
  const haystack = `${station.title} ${station.address}`.toLowerCase();
  return cityFiltersLower.some((city) => haystack.includes(city));
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

async function fetchStations(config) {
  if (config.useSampleResponse) {
    const sampleRaw = await fs.readFile(config.sampleFilePath, "utf8");
    const parsed = parseMarkdownJsonBlock(sampleRaw);
    return parsed?.gas_stations || [];
  }
  const response = await fetch(config.atanApiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(`ATAN API error: HTTP ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data?.gas_stations) ? data.gas_stations : [];
}

function normalizeStations(stations) {
  const normalized = [];
  for (const raw of stations) {
    const uuid = sanitizeString(raw?.uuid);
    if (!uuid) {
      continue;
    }
    const station = {
      uuid,
      id: sanitizeString(raw?.id),
      title: sanitizeString(raw?.title),
      address: sanitizeString(raw?.address),
      lat: Number(raw?.lat_lng?.lat),
      lng: Number(raw?.lat_lng?.lng),
      fuels: {}
    };
    if (!Number.isFinite(station.lat) || !Number.isFinite(station.lng)) {
      continue;
    }
    for (const fuel of FUELS) {
      const status = sanitizeString(raw?.[fuel]);
      station.fuels[fuel] = KNOWN_STATUSES.has(status) ? status : status || "UNKNOWN";
    }
    normalized.push(station);
  }
  return normalized;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function humanizeStatus(status) {
  return STATUS_LABELS[status] || status;
}

function makeSvg(selectedStations, config) {
  const width = 1600;
  const height = 1000;
  const mapX = 40;
  const mapY = 90;
  const mapW = 980;
  const mapH = 860;
  const panelX = 1050;
  const panelY = 90;
  const panelW = 510;
  const panelH = 860;

  const minLat = Math.min(...selectedStations.map((s) => s.lat));
  const maxLat = Math.max(...selectedStations.map((s) => s.lat));
  const minLng = Math.min(...selectedStations.map((s) => s.lng));
  const maxLng = Math.max(...selectedStations.map((s) => s.lng));
  const latPad = Math.max((maxLat - minLat) * 0.1, 0.02);
  const lngPad = Math.max((maxLng - minLng) * 0.1, 0.02);
  const latMin = minLat - latPad;
  const latMax = maxLat + latPad;
  const lngMin = minLng - lngPad;
  const lngMax = maxLng + lngPad;

  const project = (lat, lng) => {
    const x = mapX + ((lng - lngMin) / (lngMax - lngMin || 1)) * mapW;
    const y = mapY + (1 - (lat - latMin) / (latMax - latMin || 1)) * mapH;
    return { x, y };
  };

  const cityInfo = config.cityFilters.length > 0 ? config.cityFilters.join(", ") : "все";
  const fuelInfo = config.fuelTypes.join(", ");
  const statusInfo = Array.from(config.notifyTargetStatusesSet).map(humanizeStatus).join(", ");

  const grid = [];
  for (let i = 0; i <= 8; i += 1) {
    const gx = mapX + (mapW / 8) * i;
    const gy = mapY + (mapH / 8) * i;
    grid.push(`<line x1="${gx}" y1="${mapY}" x2="${gx}" y2="${mapY + mapH}" stroke="#d5e3ee" stroke-width="1"/>`);
    grid.push(`<line x1="${mapX}" y1="${gy}" x2="${mapX + mapW}" y2="${gy}" stroke="#d5e3ee" stroke-width="1"/>`);
  }

  const markers = [];
  selectedStations.forEach((station, idx) => {
    const p = project(station.lat, station.lng);
    markers.push(`<circle cx="${p.x}" cy="${p.y}" r="14" fill="#20b26b" stroke="#ffffff" stroke-width="3"/>`);
    markers.push(
      `<text x="${p.x}" y="${p.y + 5}" font-size="12" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700">${idx + 1}</text>`
    );
  });

  const lines = [];
  let cursorY = panelY + 22;
  selectedStations.forEach((station, idx) => {
    const fuelsText = station.matchedFuels
      .map((item) => `${item.fuel} (${humanizeStatus(item.status)})`)
      .join(", ");
    const row = `${idx + 1}. ${station.title} - ${fuelsText}`;
    const address = `   ${station.address}`;
    lines.push(
      `<text x="${panelX + 16}" y="${cursorY}" font-size="14" fill="#1d2b3a" font-family="Arial, sans-serif">${escapeXml(row)}</text>`
    );
    cursorY += 20;
    lines.push(
      `<text x="${panelX + 16}" y="${cursorY}" font-size="12" fill="#4a5a6a" font-family="Arial, sans-serif">${escapeXml(address)}</text>`
    );
    cursorY += 18;
    if (cursorY > panelY + panelH - 24) {
      lines.push(
        `<text x="${panelX + 16}" y="${cursorY}" font-size="14" fill="#c0392b" font-family="Arial, sans-serif">... список сокращен</text>`
      );
      return;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#f4f8fc"/>
  <text x="40" y="42" font-size="30" font-family="Arial, sans-serif" font-weight="700" fill="#12263a">ATAN карта наличия топлива</text>
  <text x="40" y="70" font-size="16" font-family="Arial, sans-serif" fill="#3c4f63">Города: ${escapeXml(cityInfo)} | Топливо: ${escapeXml(fuelInfo)} | Статусы: ${escapeXml(
    statusInfo
  )}</text>
  <rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" fill="#e9f2f9" stroke="#c4d5e4"/>
  ${grid.join("\n  ")}
  ${markers.join("\n  ")}
  <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" fill="#ffffff" stroke="#d5e3ee"/>
  <text x="${panelX + 16}" y="${panelY - 18}" font-size="18" font-family="Arial, sans-serif" font-weight="700" fill="#12263a">АЗС с бензином (${selectedStations.length})</text>
  ${lines.join("\n  ")}
</svg>`;
}

async function main() {
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.base"));
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.local"), { override: true });

  const config = {
    atanApiUrl: process.env.ATAN_API_URL || "https://api.fuel-status.atan.ru/gasstations.Edge/ListGasStationsForMap",
    useSampleResponse: toBoolean(process.env.USE_SAMPLE_RESPONSE, false),
    sampleFilePath: path.resolve(process.cwd(), process.env.SAMPLE_FILE_PATH || "./response.md"),
    fuelTypes: (() => {
      const raw = parseArrayEnv(process.env.FUEL_TYPES);
      return raw.length === 0 ? [...FUELS] : raw.filter((fuel) => FUELS.includes(fuel));
    })(),
    cityFilters: parseArrayEnv(process.env.CITY_FILTERS),
    cityFilterMode: (process.env.CITY_FILTER_MODE || "contains").toLowerCase() === "segment" ? "segment" : "contains",
    notifyTargetStatusesSet: (() => {
      const raw = normalizeUpperArray(parseArrayEnv(process.env.NOTIFY_TARGET_STATUSES));
      const list = raw.length === 0 ? ["FUEL_STATUS_IN_STOCK"] : raw;
      const set = new Set(list.filter((status) => KNOWN_STATUSES.has(status)));
      if (set.size === 0) {
        set.add("FUEL_STATUS_IN_STOCK");
      }
      return set;
    })(),
    outputFile: path.resolve(process.cwd(), process.env.MAP_OUTPUT_FILE || "./data/fuel-map.svg")
  };

  const stations = normalizeStations(await fetchStations(config));
  const cityFiltersLower = normalizeLowerArray(config.cityFilters);
  const filteredByCity = stations.filter((station) =>
    stationMatchesCityFilter(station, cityFiltersLower, config.cityFilterMode)
  );
  const selected = filteredByCity
    .map((station) => {
      const matchedFuels = config.fuelTypes
        .map((fuel) => ({ fuel, status: station.fuels[fuel] }))
        .filter((item) => config.notifyTargetStatusesSet.has(item.status));
      return { ...station, matchedFuels };
    })
    .filter((station) => station.matchedFuels.length > 0);

  if (selected.length === 0) {
    throw new Error("No stations match current filters for map generation.");
  }

  const svg = makeSvg(selected, config);
  await fs.mkdir(path.dirname(config.outputFile), { recursive: true });
  await fs.writeFile(config.outputFile, svg, "utf8");

  console.log(
    JSON.stringify({
      ok: true,
      outputFile: config.outputFile,
      stationsTotal: stations.length,
      stationsAfterCityFilter: filteredByCity.length,
      stationsWithTargetFuel: selected.length
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
});
