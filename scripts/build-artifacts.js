const fs = require("node:fs/promises");
const path = require("node:path");

const repoRoot = process.cwd();
const distDir = path.join(repoRoot, "dist");

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function asyncCandidateExists(filePath) {
  try {
    return fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);
  } catch (_) {
    return false;
  }
}

async function findExisting(candidates) {
  for (const candidate of candidates) {
    const exists = await asyncCandidateExists(candidate);
    if (exists) {
      return candidate;
    }
  }
  return null;
}

async function resolveLocalModuleAsync(fromFile, specifier) {
  const resolvedBase = path.resolve(path.dirname(fromFile), specifier);
  return findExisting([
    resolvedBase,
    `${resolvedBase}.js`,
    `${resolvedBase}.cjs`,
    path.join(resolvedBase, "index.js"),
    path.join(resolvedBase, "index.cjs")
  ]);
}

function parseRequireSpecifiers(sourceCode) {
  const specifiers = [];
  const requireRegex = /require\((["'])([^"']+)\1\)/g;
  let match = requireRegex.exec(sourceCode);
  while (match) {
    specifiers.push(match[2]);
    match = requireRegex.exec(sourceCode);
  }
  return specifiers;
}

async function collectModules(entryFile) {
  const modules = new Map();
  const queue = [path.resolve(repoRoot, entryFile)];

  while (queue.length > 0) {
    const current = queue.pop();
    const id = toPosix(path.relative(repoRoot, current));
    if (modules.has(id)) {
      continue;
    }
    const source = await fs.readFile(current, "utf8");
    modules.set(id, source);

    for (const specifier of parseRequireSpecifiers(source)) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        continue;
      }
      const localModule = await resolveLocalModuleAsync(current, specifier);
      if (!localModule) {
        throw new Error(`Unable to resolve module '${specifier}' from ${id}`);
      }
      queue.push(localModule);
    }
  }

  return modules;
}

function buildBundleSource(entryId, modules) {
  const moduleSources = {};
  for (const [id, source] of modules.entries()) {
    moduleSources[id] = source;
  }

  return `#!/usr/bin/env node
const __bundleSources = ${JSON.stringify(moduleSources)};
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
__bundleRequire(${JSON.stringify(entryId)});
`;
}

async function bundleEntry(entryFile, outFileName) {
  const entryId = toPosix(entryFile);
  const modules = await collectModules(entryFile);
  const source = buildBundleSource(entryId, modules);
  await fs.mkdir(distDir, { recursive: true });
  const outFile = path.join(distDir, outFileName);
  await fs.writeFile(outFile, source, "utf8");
  await fs.chmod(outFile, 0o755);
  return outFile;
}

async function buildDashboard() {
  const sourceFile = path.join(repoRoot, "apps/dashboard/index.html");
  const html = await fs.readFile(sourceFile, "utf8");
  const outFile = path.join(distDir, "index.html");
  await fs.mkdir(distDir, { recursive: true });
  await fs.writeFile(outFile, html, "utf8");
  return outFile;
}

async function main() {
  const monitorOut = await bundleEntry("index.js", "monitor.js");
  const apiOut = await bundleEntry("api.js", "api.js");
  const dashboardOut = await buildDashboard();

  console.log(
    JSON.stringify({
      ok: true,
      artifacts: {
        monitor: monitorOut,
        api: apiOut,
        dashboard: dashboardOut
      }
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
