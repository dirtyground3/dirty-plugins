"use strict";
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../scripts/build-lib.cjs");

function sourcePath(plugin, file = "") {
  lib.pluginFor(plugin);
  if (file) lib.relativeFile(file);
  return path.join(lib.root, "plugins", plugin, file);
}

function runtimePath(plugin, file = "") {
  lib.pluginFor(plugin);
  lib.requireBuild();
  if (file) lib.relativeFile(file);
  const filename = path.join(lib.pluginsRoot, plugin, file);
  if (!fs.existsSync(filename)) throw new Error("Missing staged runtime file: " + filename + ". Run `npm run build`.");
  return filename;
}

function testModulePath(plugin, file) {
  const configuration = lib.pluginFor(plugin);
  lib.requireBuild();
  lib.relativeFile(file);
  if (!configuration.testModules.some(module => module.output === file)) throw new Error("Unregistered test module: " + file);
  return lib.buildPath("test-modules", plugin, file);
}

module.exports = { sourcePath, runtimePath, testModulePath };
