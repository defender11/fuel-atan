const fs = require("node:fs/promises");
const path = require("node:path");

const INITIAL_ENV_KEYS = new Set(Object.keys(process.env));

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

function toBoolean(value, defaultValue) {
  if (value == null || value === "") {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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

async function main() {
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.base"));
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.local"), { override: true });

  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || "";
  const splitByChatBot = toBoolean(process.env.STATE_SPLIT_BY_CHAT_BOT, true);
  const stateFile = resolveStateFilePath(process.env.STATE_FILE || "./data/state.json", splitByChatBot, botToken, chatId);

  await fs.rm(stateFile, { force: true });
  console.log(JSON.stringify({ ok: true, removed: stateFile, splitByChatBot }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
