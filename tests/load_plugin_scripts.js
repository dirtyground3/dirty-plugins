"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { runtimePath } = require("./plugin_paths");
const { pluginFor, readManifest } = require("../scripts/build-lib.cjs");

function scriptPaths(pluginDirectory) {
  const directory = runtimePath(pluginDirectory);
  const manifest = readManifest(pluginFor(pluginDirectory), directory);
  if (!manifest.ui?.javascript?.length) throw new Error("Missing JavaScript list for " + pluginDirectory);
  return manifest.ui.javascript.map(name => runtimePath(pluginDirectory, name));
}

function loadPluginScripts(pluginDirectory, context) {
  if (pluginDirectory !== "DirtyPlugins" && context.window && context.window.DirtyPlugins && !context.window.DirtyPlugins.createSaveController) require("./shared_runtime").installSaveController(context.window);
  for (const filename of scriptPaths(pluginDirectory)) {
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }
}

function sourceFor(pluginDirectory) {
  return scriptPaths(pluginDirectory).map(filename => fs.readFileSync(filename, "utf8")).join("\n");
}

module.exports = { scriptPaths, loadPluginScripts, sourceFor };
