#!/usr/bin/env node
const __bundleSources = {"test-telegram.js":"const fs = require(\"node:fs/promises\");\nconst path = require(\"node:path\");\nconst INITIAL_ENV_KEYS = new Set(Object.keys(process.env));\n\nasync function loadDotEnvFile(filePath, options = {}) {\n  const { override = false } = options;\n  try {\n    const content = await fs.readFile(filePath, \"utf8\");\n    for (const rawLine of content.split(/\\r?\\n/)) {\n      const line = rawLine.trim();\n      if (!line || line.startsWith(\"#\")) {\n        continue;\n      }\n      const index = line.indexOf(\"=\");\n      if (index === -1) {\n        continue;\n      }\n      const key = line.slice(0, index).trim();\n      const value = line.slice(index + 1).trim();\n      if (override) {\n        if (!INITIAL_ENV_KEYS.has(key)) {\n          process.env[key] = value;\n        }\n      } else if (!(key in process.env)) {\n        process.env[key] = value;\n      }\n    }\n  } catch (error) {\n    if (error && error.code === \"ENOENT\") {\n      return;\n    }\n    throw error;\n  }\n}\n\nfunction mustGetEnv(name) {\n  const value = process.env[name];\n  if (!value) {\n    throw new Error(`Missing required env var: ${name}`);\n  }\n  return value;\n}\n\nasync function sendTelegramMessage(botToken, chatId, text) {\n  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;\n  const response = await fetch(url, {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({\n      chat_id: chatId,\n      text\n    })\n  });\n\n  if (!response.ok) {\n    const body = await response.text().catch(() => \"\");\n    throw new Error(`Telegram API error: HTTP ${response.status}; ${body}`);\n  }\n  return response.json();\n}\n\nasync function main() {\n  await loadDotEnvFile(path.resolve(process.cwd(), \".env.base\"));\n  await loadDotEnvFile(path.resolve(process.cwd(), \".env.local\"), { override: true });\n\n  const botToken = mustGetEnv(\"TELEGRAM_BOT_TOKEN\");\n  const chatId = mustGetEnv(\"TELEGRAM_CHAT_ID\");\n\n  const text = [\n    \"Fuel ATAN monitor: test message\",\n    `Time: ${new Date().toISOString()}`,\n    \"If you see this message, Telegram configuration works.\"\n  ].join(\"\\n\");\n\n  const result = await sendTelegramMessage(botToken, chatId, text);\n  console.log(\n    JSON.stringify({\n      ok: true,\n      message: \"Test message sent\",\n      chatId,\n      telegramMessageId: result?.result?.message_id ?? null\n    })\n  );\n}\n\nmain().catch((error) => {\n  console.error(\n    JSON.stringify({\n      ok: false,\n      message: \"Failed to send test message\",\n      error: error instanceof Error ? error.message : String(error)\n    })\n  );\n  process.exitCode = 1;\n});\n"};
const __bundleFactories = {};
for (const __id of Object.keys(__bundleSources)) {
  __bundleFactories[__id] = new Function("module", "exports", "require", "__filename", "__dirname", __bundleSources[__id]);
}
const __bundleCache = {};
function __normalize(parts) {
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}
function __resolve(fromId, specifier) {
  const baseDir = fromId.includes("/") ? fromId.slice(0, fromId.lastIndexOf("/")) : "";
  const combined = __normalize(baseDir ? [...baseDir.split("/"), ...specifier.split("/")] : specifier.split("/"));
  const candidates = [combined, combined + ".js", combined + ".cjs", combined + "/index.js", combined + "/index.cjs"];
  for (const candidate of candidates) {
    if (__bundleFactories[candidate]) return candidate;
  }
  throw new Error("Cannot resolve " + specifier + " from " + fromId);
}
function __bundleRequire(id) {
  if (__bundleCache[id]) return __bundleCache[id].exports;
  const factory = __bundleFactories[id];
  if (!factory) throw new Error("Module not found: " + id);
  const module = { exports: {} };
  __bundleCache[id] = module;
  const localRequire = (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return __bundleRequire(__resolve(id, specifier));
    }
    return require(specifier);
  };
  const dirname = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : ".";
  factory(module, module.exports, localRequire, id, dirname);
  return module.exports;
}
__bundleRequire("test-telegram.js");
