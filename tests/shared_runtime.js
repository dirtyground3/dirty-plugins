"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const { testModulePath } = require("./plugin_paths");

/** Supply actual pure hub features to tests that stub the surrounding runtime. */
function loadFeature(window, feature, globals = {}) {
  const filename = testModulePath("DirtyPlugins", feature.toLowerCase() + ".cjs");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { ...globals, window, module, exports: module.exports }, { filename });
  return feature === "Metadata" ? module.exports.metadata : module.exports;
}

function installJobHelpers(window) {
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  Object.assign(window.DirtyPlugins, loadFeature(window, "Jobs"));
}

function installMetadata(window) {
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  window.DirtyPlugins.settingsMetadata = loadFeature(window, "Metadata");
}

function installSaveController(window) {
  installMetadata(window);
  installJobHelpers(window);
  window.DirtyPlugins.createSaveController = loadFeature(window, "Save").createSaveController;
}

module.exports = { installSaveController, installJobHelpers, installMetadata, loadFeature };
