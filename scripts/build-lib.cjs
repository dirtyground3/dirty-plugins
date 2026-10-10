"use strict";

// Shared by the build, packaging scripts and tests: plugin registry, install files and compile options.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const buildRoot = path.join(root, ".build");
const pluginsRoot = path.join(buildRoot, "plugins");
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "plugin-registry.json"), "utf8"));
const sharedInputs = [
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "types",
  "schemas",
  "build_site.sh",
  "plugins/DirtyPlugins/src/shared",
];
const runtimeInput = /(^|\/)(runtime|__pycache__|backups?)(\/|$)|\.sqlite[^/]*$|\.(py[co]|bak|backup)$/i;
const historyExclusions = [
  "**/runtime/**",
  "**/__pycache__/**",
  "**/backup/**",
  "**/backups/**",
  "**/*.sqlite*",
  "**/*.pyc",
  "**/*.pyo",
  "**/*.bak",
  "**/*.backup",
].map(pattern => ":(icase,glob,exclude)" + pattern);
// Installs never contain source, tooling, tests or runtime data.
const FORBIDDEN_INSTALL_FILE =
  /(^|\/)(src|runtime|__pycache__|node_modules|tests)(\/|$)|\.sqlite|\.(pyc|pyo|bak|ts|tsx|map)$/i;

function pluginFor(directory) {
  const plugin = registry.find(value => value.directory === directory);
  if (!plugin) throw new Error("Unknown plugin directory: " + directory);
  return plugin;
}

function pluginDirectory(plugin) {
  return installPath(path.join(root, "plugins"), plugin.directory);
}

/** Reject manifest/registry paths before reading source or writing staging. */
function installPath(directory, file) {
  if (typeof file !== "string" || !file || file.includes("\0")) throw new Error("Invalid install path: " + file);
  const normalized = file.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(file) ||
    /^[a-z]:/i.test(file) ||
    normalized.split("/").includes("..")
  )
    throw new Error("Install paths must be relative without traversal: " + file);
  const base = path.resolve(directory),
    resolved = path.resolve(base, normalized);
  const relative = path.relative(base, resolved);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("Install path escapes its directory: " + file);
  return resolved;
}

/** Recover a promotion interrupted before/after staging was renamed. */
function renameBuildPath(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(source, destination);
      return;
    } catch (error) {
      if (attempt === 5 || !["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].includes(error.code)) throw error;
      // Windows scanners can briefly retain handles after the last bundle write.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

function recoverBuild(output) {
  const backup = output + ".previous";
  if (!fs.existsSync(backup)) return;
  if (fs.existsSync(output)) fs.rmSync(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else renameBuildPath(backup, output);
}

/** Retain the previous build until promotion succeeds; preserve it on restoration failure. */
function promoteBuild(staging, output) {
  recoverBuild(output);
  const backup = output + ".previous";
  const previous = fs.existsSync(output);
  if (previous) renameBuildPath(output, backup);
  try {
    renameBuildPath(staging, output);
  } catch (error) {
    if (previous)
      try {
        renameBuildPath(backup, output);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "Build promotion failed; previous output retained at " + backup,
        );
      }
    throw error;
  }
  if (previous) fs.rmSync(backup, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function readManifest(plugin, directory = pluginDirectory(plugin)) {
  return YAML.parse(fs.readFileSync(installPath(directory, plugin.id + ".yml"), "utf8"));
}

/** Install files: the manifest and its assets, same-directory Python, generated and listed extras, README and LICENSE. */
function installFiles(plugin, manifest) {
  const python = fs.readdirSync(pluginDirectory(plugin)).filter(name => name.endsWith(".py"));
  return [
    ...new Set([
      plugin.id + ".yml",
      ...((manifest.ui && manifest.ui.javascript) || []),
      ...((manifest.ui && manifest.ui.css) || []),
      ...python,
      ...(plugin.generatedFiles || []),
      ...(plugin.extraFiles || []),
      "README.md",
      "LICENSE",
    ]),
  ];
}

/** Shared esbuild options; the build adds its boundary plugin and output file. */
function compileOptions(plugin, entry, platform, mode) {
  const release = platform === "browser" && mode === "release";
  return {
    absWorkingDir: root,
    entryPoints: [path.join(pluginDirectory(plugin), entry)],
    bundle: true,
    platform,
    format: platform === "browser" ? "iife" : "cjs",
    target: "es2020",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    tsconfig: path.join(root, "tsconfig.json"),
    // Stash serves only the aggregated asset, so a map must be inline to resolve.
    sourcemap: release ? false : "inline",
    // Release bundles are minified without property mangling, so host, hub and
    // public names stay intact; keepNames preserves function/component names.
    minify: release,
    keepNames: release,
    legalComments: "inline",
    logLevel: "warning",
  };
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  if (fs.statSync(directory).isFile()) return [directory];
  return fs
    .readdirSync(directory)
    .sort()
    .flatMap(name => walkFiles(path.join(directory, name)));
}

/** Package identity: the last commit touching the plugin or shared inputs, plus a hash of their current contents. */
function sourceMetadata(plugin) {
  const inputs = Array.from(
    new Set([...walkFiles(pluginDirectory(plugin)), ...sharedInputs.flatMap(file => walkFiles(path.join(root, file)))]),
  )
    .filter(file => !runtimeInput.test(path.relative(root, file).split(path.sep).join("/")))
    .sort();
  const hash = crypto.createHash("sha256");
  for (const file of inputs)
    hash
      .update(path.relative(root, file).split(path.sep).join("/") + "\0")
      .update(fs.readFileSync(file))
      .update("\0");
  const revision = spawnSync(
    "git",
    ["log", "-1", "--format=%h%n%aI", "--", "plugins/" + plugin.directory, ...sharedInputs, ...historyExclusions],
    { cwd: root, encoding: "utf8" },
  );
  const [commit, date] = revision.status === 0 ? revision.stdout.trim().split(/\r?\n/) : [];
  return {
    identity: (commit || "local") + "-" + hash.digest("hex").slice(0, 12),
    date: date ? new Date(date).toISOString().slice(0, 19).replace("T", " ") : "1970-01-01 00:00:00",
  };
}

/** Tests and packaging read staging; a missing build fails with the command to run. */
function requireBuild() {
  for (const plugin of registry) {
    if (!fs.existsSync(path.join(pluginsRoot, plugin.directory, plugin.id + ".yml"))) {
      throw new Error("Missing staged plugins. Run `npm run build` first.");
    }
  }
}

module.exports = {
  root,
  buildRoot,
  pluginsRoot,
  registry,
  FORBIDDEN_INSTALL_FILE,
  pluginFor,
  pluginDirectory,
  installPath,
  recoverBuild,
  promoteBuild,
  readManifest,
  installFiles,
  compileOptions,
  sourceMetadata,
  requireBuild,
};
