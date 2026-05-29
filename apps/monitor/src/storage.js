const fs = require("node:fs/promises");
const path = require("node:path");

async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJsonFileSafe(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return fallback;
    }
    return fallback;
  }
}

async function writeJsonAtomic(filePath, objectValue) {
  await ensureDirectory(filePath);
  const tempFilePath = `${filePath}.tmp`;
  await fs.writeFile(tempFilePath, `${JSON.stringify(objectValue, null, 2)}\n`, "utf8");
  await fs.rename(tempFilePath, filePath);
}

module.exports = {
  readJsonFileSafe,
  writeJsonAtomic
};
