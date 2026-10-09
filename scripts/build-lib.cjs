"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");

const root = path.resolve(__dirname, "..");
const buildRoot = path.join(root, ".build");
const pluginsRoot = path.join(buildRoot, "plugins");
const statePath = path.join(buildRoot, "build-state.json");
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "plugin-registry.json"), "utf8"));
const sharedInputs = ["scripts", "package.json", "package-lock.json", "tsconfig.json", "types", "schemas", "build_site.sh"];
// Release staging feeds tests, packages and installs; development adds inline maps.
const BUILD_MODES = ["release", "development"];
const BUILD_STATE_FORMAT = 2;
const BUILD_COMMANDS = { release: "npm run build", development: "npm run build:dev" };

function relativeFile(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || path.posix.isAbsolute(value) ||
      value.split("/").some(part => !part || part === "." || part === "..") || /^[a-z]:/i.test(value)) {
    throw new Error("Unsafe relative file: " + value);
  }
  return value;
}

function rejectLinks(filename, boundary = root) {
  const relative = path.relative(boundary, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Path escapes workspace: " + filename);
  let current = boundary;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("Symbolic links are not allowed in build paths: " + current);
    }
  }
}

function buildPath(...parts) {
  const filename = path.resolve(buildRoot, ...parts);
  const relative = path.relative(buildRoot, filename);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe build path: " + filename);
  rejectLinks(filename);
  return filename;
}

function removeBuildDirectory(name) {
  if (!["staging", "plugins", "test-modules"].includes(name)) throw new Error("Refusing build cleanup: " + name);
  fs.rmSync(buildPath(name), { recursive: true, force: true });
}

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  rejectLinks(directory);
  if (fs.statSync(directory).isFile()) return [directory];
  return fs.readdirSync(directory).sort().flatMap(name => walkFiles(path.join(directory, name)));
}

function pluginFor(directory) {
  const plugin = registry.find(value => value.directory === directory);
  if (!plugin) throw new Error("Unknown plugin directory: " + directory);
  return plugin;
}

function readManifest(plugin, directory = path.join(root, "plugins", plugin.directory)) {
  return YAML.parse(fs.readFileSync(path.join(directory, plugin.id + ".yml"), "utf8"));
}

function pluginInputs(plugin) {
  const base = path.join(root, "plugins", plugin.directory);
  // The bundle entry and generated files are outputs; schemas/ is a shared input.
  const outputs = new Set([plugin.entry, ...(plugin.generatedFiles || [])]);
  return [...new Set([
    ...plugin.files.filter(file => !outputs.has(file)).map(file => path.join(base, relativeFile(file))),
    ...walkFiles(path.join(base, "src")),
    ...sharedInputs.flatMap(file => walkFiles(path.join(root, file))),
  ])].sort();
}

function hashFiles(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    rejectLinks(file);
    hash.update(path.relative(root, file).split(path.sep).join("/") + "\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function inputFingerprint() {
  return hashFiles([...new Set(registry.flatMap(pluginInputs))].sort());
}

function sourceMetadata(plugin) {
  const inputs = pluginInputs(plugin);
  const revision = spawnSync("git", ["log", "-1", "--format=%h%n%aI", "--",
    "plugins/" + plugin.directory, ...sharedInputs], { cwd: root, encoding: "utf8" });
  const [commit = "local", date] = revision.status === 0 ? revision.stdout.trim().split(/\r?\n/) : [];
  return {
    commit: commit || "local",
    // The content suffix also accounts for local edits and shared build inputs.
    identity: (commit || "local") + "-" + hashFiles(inputs).slice(0, 12),
    date: date ? new Date(date).toISOString().slice(0, 19).replace("T", " ") : "1970-01-01 00:00:00",
  };
}

let checkedFingerprint;
function requireBuild(mode = "release") {
  if (!BUILD_MODES.includes(mode)) throw new Error("Unknown build mode: " + mode);
  try {
    if (fs.existsSync(path.join(buildRoot, "build.lock"))) throw new Error("build in progress");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (checkedFingerprint === undefined) checkedFingerprint = inputFingerprint();
    if (state.format !== BUILD_STATE_FORMAT || state.fingerprint !== checkedFingerprint) throw new Error("stale build inputs");
    if (state.mode !== mode) throw new Error("staging is a " + state.mode + " build; this check needs a " + mode + " build");
    for (const plugin of registry) {
      if (!fs.existsSync(path.join(pluginsRoot, plugin.directory, plugin.id + ".yml"))) throw new Error("missing staged manifest");
    }
    return state;
  } catch (error) {
    throw new Error("Missing or stale staged plugins. Run `" + BUILD_COMMANDS[mode] + "` before direct tests. (" + error.message + ")");
  }
}

module.exports = { root, buildRoot, pluginsRoot, statePath, registry, relativeFile, rejectLinks,
  buildPath, removeBuildDirectory, walkFiles, pluginFor, readManifest, pluginInputs,
  hashFiles, inputFingerprint, sourceMetadata, requireBuild, BUILD_MODES, BUILD_STATE_FORMAT };
