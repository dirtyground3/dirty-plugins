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
];
// Installs never contain source, tooling, tests or runtime data.
const FORBIDDEN_INSTALL_FILE =
  /(^|\/)(src|runtime|__pycache__|node_modules|tests)(\/|$)|\.sqlite|\.(pyc|pyo|bak|ts|tsx|map)$/i;

function pluginFor(directory) {
  const plugin = registry.find(value => value.directory === directory);
  if (!plugin) throw new Error("Unknown plugin directory: " + directory);
  return plugin;
}

function pluginDirectory(plugin) {
  return path.join(root, "plugins", plugin.directory);
}

function readManifest(plugin, directory = pluginDirectory(plugin)) {
  return YAML.parse(fs.readFileSync(path.join(directory, plugin.id + ".yml"), "utf8"));
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
  const inputs = [
    ...walkFiles(pluginDirectory(plugin)).filter(file => !/[\\/](runtime|__pycache__)[\\/]|\.py[co]$/.test(file)),
    ...sharedInputs.flatMap(file => walkFiles(path.join(root, file))),
  ].sort();
  const hash = crypto.createHash("sha256");
  for (const file of inputs)
    hash
      .update(path.relative(root, file).split(path.sep).join("/") + "\0")
      .update(fs.readFileSync(file))
      .update("\0");
  const revision = spawnSync(
    "git",
    ["log", "-1", "--format=%h%n%aI", "--", "plugins/" + plugin.directory, ...sharedInputs],
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
  readManifest,
  installFiles,
  compileOptions,
  sourceMetadata,
  requireBuild,
};
