const fs = require("node:fs/promises");
const path = require("node:path");

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

function logFatal(error) {
  const payload = {
    ts: nowIso(),
    level: "fatal",
    message: "App crashed",
    extra: { error: error instanceof Error ? error.message : String(error) }
  };
  const line = JSON.stringify(payload);
  console.error(line);
  queueFileLogLine(line);
}

module.exports = {
  nowIso,
  makeRunId,
  initFileLogging,
  flushFileLogs,
  log,
  logFatal
};
