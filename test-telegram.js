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

function mustGetEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram API error: HTTP ${response.status}; ${body}`);
  }
  return response.json();
}

async function main() {
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.base"));
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.local"), { override: true });

  const botToken = mustGetEnv("TELEGRAM_BOT_TOKEN");
  const chatId = mustGetEnv("TELEGRAM_CHAT_ID");

  const text = [
    "Fuel ATAN monitor: test message",
    `Time: ${new Date().toISOString()}`,
    "If you see this message, Telegram configuration works."
  ].join("\n");

  const result = await sendTelegramMessage(botToken, chatId, text);
  console.log(
    JSON.stringify({
      ok: true,
      message: "Test message sent",
      chatId,
      telegramMessageId: result?.result?.message_id ?? null
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      message: "Failed to send test message",
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
});
