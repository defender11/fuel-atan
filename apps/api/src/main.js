const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const {
  loadProjectEnv,
  mustGetEnv,
  toBoolean,
  toNumber,
  parseArrayEnv,
  resolveStateFilePath,
  normalizeLowerArray,
  normalizeUpperArray
} = require("../../monitor/src/env");
const { readJsonFileSafe } = require("../../monitor/src/storage");
const { FUELS, KNOWN_STATUSES } = require("../../monitor/src/constants");
const { nowIso } = require("../../monitor/src/logger");

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload)}\n`);
}

function getApiConfigFromEnv() {
  const rawFuelTypes = parseArrayEnv(process.env.FUEL_TYPES);
  const fuelTypes = rawFuelTypes.length === 0 ? [...FUELS] : rawFuelTypes.filter((fuel) => FUELS.includes(fuel));
  const cityFilters = parseArrayEnv(process.env.CITY_FILTERS);
  const cityFilterMode = (process.env.CITY_FILTER_MODE || "contains").toLowerCase() === "segment" ? "segment" : "contains";
  const rawNotifyTargetStatuses = normalizeUpperArray(parseArrayEnv(process.env.NOTIFY_TARGET_STATUSES));
  const notifyTargetStatuses = rawNotifyTargetStatuses.length === 0 ? ["FUEL_STATUS_IN_STOCK"] : rawNotifyTargetStatuses;
  const notifyTargetStatusesSet = new Set(notifyTargetStatuses.filter((status) => KNOWN_STATUSES.has(status)));
  const telegramBotToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const telegramChatId = mustGetEnv("TELEGRAM_CHAT_ID");
  const stateSplitByChatBot = toBoolean(process.env.STATE_SPLIT_BY_CHAT_BOT, true);
  const stateFile = resolveStateFilePath(process.env.STATE_FILE || "./data/state.json", stateSplitByChatBot, telegramBotToken, telegramChatId);
  if (notifyTargetStatusesSet.size === 0) {
    notifyTargetStatusesSet.add("FUEL_STATUS_IN_STOCK");
  }

  return {
    stateFile,
    stateSplitByChatBot,
    cityFilters,
    cityFilterMode,
    fuelTypes,
    notifyTargetStatuses: Array.from(notifyTargetStatusesSet),
    logDir: path.resolve(process.cwd(), process.env.LOG_DIR || "./data/logs"),
    apiHost: process.env.API_HOST || "0.0.0.0",
    apiPort: toNumber(process.env.API_PORT, 4010),
    apiKey: process.env.API_KEY || "",
    dashboardFile: process.env.DASHBOARD_FILE || ""
  };
}

async function getRecentLogRecords(logDir, limit) {
  const entries = await fs.readdir(logDir, { withFileTypes: true }).catch((error) => {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 4);

  const records = [];
  for (const fileName of files) {
    const fullPath = path.join(logDir, fileName);
    const raw = await fs.readFile(fullPath, "utf8").catch(() => "");
    const lines = raw.split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        records.push(parsed);
      } catch (_) {
        continue;
      }
      if (records.length >= limit) {
        return records;
      }
    }
  }
  return records;
}

async function readDashboardHtml() {
  const candidates = [
    process.env.DASHBOARD_FILE || "",
    "apps/dashboard/index.html",
    "dist/index.html"
  ]
    .filter(Boolean)
    .map((value) => path.resolve(process.cwd(), value));

  for (const filePath of candidates) {
    const html = await fs.readFile(filePath, "utf8").catch(() => "");
    if (html) {
      return html;
    }
  }
  return "";
}

function checkApiKey(req, apiKey) {
  if (!apiKey) {
    return true;
  }
  const headerValue = req.headers["x-api-key"];
  return typeof headerValue === "string" && headerValue === apiKey;
}

async function createApiServer(config) {
  return http.createServer(async (req, res) => {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", "http://localhost");

    if (method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        service: "fuel-atan-api",
        ts: nowIso()
      });
      return;
    }

    if (method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      const html = await readDashboardHtml().catch(() => "");
      if (!html) {
        writeJson(res, 404, { ok: false, error: "Dashboard not found" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
      return;
    }

    if (!checkApiKey(req, config.apiKey)) {
      writeJson(res, 401, {
        ok: false,
        error: "Unauthorized"
      });
      return;
    }

    if (method === "GET" && url.pathname === "/snapshot/current") {
      const state = await readJsonFileSafe(config.stateFile, {});
      const snapshot = Array.isArray(state.lastSnapshot) ? state.lastSnapshot : [];
      writeJson(res, 200, {
        ok: true,
        ts: nowIso(),
        stateFile: config.stateFile,
        stations: snapshot.length,
        snapshot
      });
      return;
    }

    if (method === "GET" && url.pathname === "/events/recent") {
      const limit = Math.min(500, Math.max(1, toNumber(url.searchParams.get("limit"), 50)));
      const records = await getRecentLogRecords(config.logDir, limit);
      writeJson(res, 200, {
        ok: true,
        ts: nowIso(),
        count: records.length,
        records
      });
      return;
    }

    if (method === "GET" && url.pathname === "/config/public") {
      writeJson(res, 200, {
        ok: true,
        ts: nowIso(),
        config: {
          stateFile: config.stateFile,
          stateSplitByChatBot: config.stateSplitByChatBot,
          cityFilters: config.cityFilters,
          cityFilterMode: config.cityFilterMode,
          fuelTypes: config.fuelTypes,
          notifyTargetStatuses: config.notifyTargetStatuses,
          apiHost: config.apiHost,
          apiPort: config.apiPort
        }
      });
      return;
    }

    writeJson(res, 404, {
      ok: false,
      error: "Not found"
    });
  });
}

function withOverrides(config, overrides = {}) {
  return {
    ...config,
    ...overrides
  };
}

async function runApi(overrides = {}) {
  await loadProjectEnv();
  const config = withOverrides(getApiConfigFromEnv(), overrides);
  const server = await createApiServer(config);
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      const actualPort = address && typeof address === "object" ? address.port : config.apiPort;
      console.log(
        JSON.stringify({
          ts: nowIso(),
          level: "info",
          message: "API server started",
          extra: {
            host: config.apiHost,
            port: actualPort
          }
        })
      );
      resolve({ server, config: { ...config, apiPort: actualPort } });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.apiPort, config.apiHost);
  });
}

module.exports = {
  runApi
};
