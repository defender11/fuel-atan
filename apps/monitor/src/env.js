const fs = require("node:fs/promises");
const path = require("node:path");

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

function normalizeLowerArray(list) {
  return list.map((value) => value.toLowerCase());
}

function normalizeUpperArray(list) {
  return list.map((value) => value.toUpperCase());
}

async function loadProjectEnv() {
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.base"));
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.local"), { override: true });
}

module.exports = {
  mustGetEnv,
  toBoolean,
  toNumber,
  resolveStateFilePath,
  parseArrayEnv,
  normalizeLowerArray,
  normalizeUpperArray,
  loadProjectEnv
};
