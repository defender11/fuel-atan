const fs = require("node:fs/promises");

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

async function getStations(config, runId, logFn) {
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
    logFn(runId, "warn", "Response has no gas_stations array");
    return [];
  }
  return data.gas_stations;
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

module.exports = {
  getStations,
  sendTelegramMessage,
  sendTelegramPhoto
};
